import { supabase } from "@/lib/supabaseClient";
import { normName } from "@/lib/odds";

/**
 * Reads the live BetOnline moneyline for a fight from the bots' ledger
 * (the `bol_current_lines` view - one current price per fight, service
 * history kept private). Used to pre-fill and lock the price on a verified
 * moneyline so a user accepts the board rather than typing a claim: the
 * morning scrape then independently confirms it against the same ledger at
 * the server-stamped log time, so "market ✓" can never be forged.
 *
 * Fighter matching mirrors the scraper's Python matcher (exact, surname +
 * first initial, or token subset) so the app and the verifier always agree
 * on who is who across BetOnline vs gidstats spellings.
 */

type LineRow = {
  fighter1: string;
  fighter2: string;
  fighter1_odds: number | null;
  fighter2_odds: number | null;
  captured_at: string;
  opened_at?: string | null; // first time the bots saw this fight's line
};

export type FightBoard = {
  side1: number | null; // board price for the fight's fighter1
  side2: number | null; // board price for the fight's fighter2
  capturedAt: string;
  openedAt: string | null; // when BetOnline first posted this moneyline
} | null;

// Cross-source fighter identity bridge. Every tier below assumes a
// fighter's SURNAME survives across sources; when a fighter signs under
// a new competition name, every tier fails at once and the board can't
// place BetOnline's price on the card fight. Declared pairs bridge that.
// Names are compared in normName() form.
// MIRROR: fighter_aliases.py in the scraper carries the identical list
// for the morning verifier - a pair added here must land there in the
// same deploy, or the board shows a price the verifier can't confirm.
// First entry: Anna Crutchfield signed with the UFC as Anna Melisano
// (July 2026) - BetOnline boards Melisano; gidstats still lists
// Crutchfield.
const FIGHTER_ALIASES: ReadonlyArray<readonly [string, string]> = [
  // (card-source spelling, BetOnline board spelling)
  ["anna crutchfield", "anna melisano"], // signed UFC under a new name (Jul 2026)
  ["ezra elliott", "erza elliot"], // BetOnline typo, UFC OKC (Jul 2026)
  ["zaur gadzhiev", "zaur gadhiev"], // BetOnline transliteration, ACA (Jul 2026)
  ["lewis mcgrillen evans", "lewis mcgrillen"], // BetOnline drops the compound, PFL
];

function aliasMatch(na: string, nb: string): boolean {
  for (const [a, b] of FIGHTER_ALIASES) {
    if ((na === a && nb === b) || (na === b && nb === a)) return true;
  }
  return false;
}

// normName() and the token split are pure, and the board matcher calls them
// on the same few hundred names over and over: every fight is tested against
// every distinct bout, in both orderings. Memoising the two turned the Notes
// page's price-matching pass from 6.5s of blocked main thread into 142ms with
// byte-identical output (proven by fixture, both directions).
// The cached token arrays are shared - READ ONLY, never mutate one.
const normCache = new Map<string, string>();
function nrm(n: string): string {
  let v = normCache.get(n);
  if (v === undefined) {
    if (normCache.size > 5000) normCache.clear(); // bounded, never a leak
    v = normName(n);
    normCache.set(n, v);
  }
  return v;
}

const tokCache = new Map<string, string[]>();
function tokensOf(normalized: string): string[] {
  let v = tokCache.get(normalized);
  if (v === undefined) {
    if (tokCache.size > 5000) tokCache.clear();
    v = normalized.split(" ").filter(Boolean);
    tokCache.set(normalized, v);
  }
  return v;
}

// Supabase caps every PostgREST request at 1,000 rows and TRUNCATES
// SILENTLY past the cap. Fight week pushed bol_current_props over it and
// every fight_key alphabetically past the cutoff (RJ Harris...,
// Stewart Nicoll...) vanished from the rail with no error anywhere.
// Whole-view reads must page - and must ORDER, because unordered range
// pagination is not stable across requests.
const PAGE_ROWS = 1000;
const MAX_PAGES = 20; // 20k-row circuit breaker against a runaway view
const PAGE_WAVE = 4; // concurrent page reads per wave
const FRESH_MS = 20_000; // rows younger than this skip the network entirely
// Bump the version any time a board view's column shape changes, or a
// returning browser will hydrate old-shaped rows into new-shaped renderers.
const LS_PREFIX = "tapenotes:board:v1:";

type Cached = { rows: unknown[]; at: number };
const memCache = new Map<string, Cached>();
const inflight = new Map<string, Promise<unknown[] | null>>();
// last known row count per view - lets a refetch fire exactly the right
// number of pages in ONE concurrent round trip instead of discovering the
// size page by page
const lastCount = new Map<string, number>();

function readStored(view: string): unknown[] | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(LS_PREFIX + view);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: unknown[] };
    return Array.isArray(parsed.rows) && parsed.rows.length ? parsed.rows : null;
  } catch {
    return null; // corrupt/blocked storage must never take the board down
  }
}

function writeStored(view: string, rows: unknown[]): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_PREFIX + view, JSON.stringify({ rows, at: Date.now() }));
  } catch {
    // quota or private mode - the app just loses instant-paint, nothing else
  }
}

async function fetchPage<T>(
  view: string,
  orderCol: string,
  page: number
): Promise<T[] | null> {
  const from = page * PAGE_ROWS;
  const { data, error } = await supabase
    .from(view)
    .select("*")
    .order(orderCol, { ascending: true })
    .range(from, from + PAGE_ROWS - 1);
  if (error) {
    console.error(`[board] ${view} page ${page} read failed:`, error.message);
    return null;
  }
  return (data ?? []) as T[];
}

// One full network read of a view. The first wave is sized from the view's
// last known row count (or 4 blind pages on a first-ever read), so a view
// of any size up to 4k rows completes in a single concurrent round trip.
// Rows must stay CONTIGUOUS: wave results are consumed in page order and
// everything after the first short or failed page is discarded, so a
// mid-wave failure can never leave a silent gap.
async function fetchFresh<T>(view: string, orderCol: string): Promise<T[] | null> {
  const known = lastCount.get(view);
  const firstWave = Math.min(
    MAX_PAGES,
    Math.max(1, known !== undefined ? Math.ceil(known / PAGE_ROWS) : PAGE_WAVE)
  );
  const out: T[] = [];
  let base = 0;
  let wave = firstWave;
  while (base < MAX_PAGES) {
    const count = Math.min(wave, MAX_PAGES - base);
    const pages = await Promise.all(
      Array.from({ length: count }, (_, i) => fetchPage<T>(view, orderCol, base + i))
    );
    for (const pageRows of pages) {
      if (pageRows === null) {
        // partial board beats a blank one, but never fail in silence
        return out.length ? out : null;
      }
      out.push(...pageRows);
      if (pageRows.length < PAGE_ROWS) return out;
    }
    base += count;
    wave = PAGE_WAVE;
  }
  return out;
}

/**
 * Cached board reads. Three layers, all failure-soft:
 *  - rows fetched < 20s ago return instantly with no network at all, so
 *    hopping between the Odds and Notes tabs never re-downloads the board
 *  - older rows (memory or the last visit's localStorage copy) return
 *    instantly for paint while a background refresh runs; fresh rows land
 *    via onRefresh so the caller can swap them into state
 *  - concurrent calls for the same view share one in-flight request, so
 *    Matrix and OddsBoard mounting together fetch each board once
 * The verified-bet price path (fetchFightProps / fetchFightBoard) does NOT
 * go through this cache - a locked price is always read live.
 */
export async function fetchAllRows<T>(
  view: string,
  orderCol: string,
  onRefresh?: (rows: T[]) => void
): Promise<T[] | null> {
  const mem = memCache.get(view);
  if (mem && Date.now() - mem.at < FRESH_MS) return mem.rows as T[];

  const refresh = (): Promise<T[] | null> => {
    let p = inflight.get(view) as Promise<T[] | null> | undefined;
    if (!p) {
      p = fetchFresh<T>(view, orderCol)
        .then((rows) => {
          if (rows) {
            memCache.set(view, { rows, at: Date.now() });
            lastCount.set(view, rows.length);
            writeStored(view, rows);
          }
          return rows;
        })
        .finally(() => inflight.delete(view));
      inflight.set(view, p);
    }
    return p;
  };

  const stale = (mem?.rows as T[] | undefined) ?? (readStored(view) as T[] | null);
  if (stale && stale.length) {
    if (!lastCount.has(view)) lastCount.set(view, stale.length);
    const p = refresh();
    if (onRefresh) p.then((rows) => rows && onRefresh(rows));
    return stale; // paint now - fresh rows follow through onRefresh
  }
  return refresh(); // first-ever read: nothing to paint, wait for the network
}

// Surname prefilter tokens for a set of fighters - the TS twin of the
// scraper's _alias_surname_tokens: every fighter's surname plus every
// declared alias surname, so a server-side ilike can never miss a
// renamed (or book-typo'd) fighter. Tokens come out of normName(), so
// they are [a-z0-9 ] only - safe inside a PostgREST or() string.
export function surnameTokens(...names: string[]): string[] {
  const toks = new Set<string>();
  for (const name of names) {
    const nn = nrm(name);
    if (!nn) continue;
    const forms = new Set([nn]);
    for (const [a, b] of FIGHTER_ALIASES) {
      if (nn === a) forms.add(b);
      else if (nn === b) forms.add(a);
    }
    for (const f of forms) {
      const parts = tokensOf(f);
      if (parts.length) toks.add(parts[parts.length - 1]);
    }
  }
  return [...toks];
}

function samePerson(a: string, b: string): boolean {
  const na = nrm(a);
  const nb = nrm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (aliasMatch(na, nb)) return true; // declared identity - new surname
  const ta = tokensOf(na);
  const tb = tokensOf(nb);
  if (!ta.length || !tb.length) return false;
  if (ta[ta.length - 1] === tb[tb.length - 1] && ta[0][0] === tb[0][0]) return true;
  if (ta.length >= 2 && tb.length >= 2) {
    const sa = new Set(ta);
    const sb = new Set(tb);
    const aSubB = ta.every((t) => sb.has(t));
    const bSubA = tb.every((t) => sa.has(t));
    if (aSubB || bSubA) return true;
  }
  return false;
}

function exactName(a: string, b: string): boolean {
  return nrm(a) === nrm(b) && !!nrm(a);
}

function surnameEq(a: string, b: string): boolean {
  const ta = tokensOf(nrm(a));
  const tb = tokensOf(nrm(b));
  return ta.length > 0 && tb.length > 0 && ta[ta.length - 1] === tb[tb.length - 1];
}

// A bout matches when both fighters match by the standard rule, OR when one
// fighter matches unambiguously and the other shares a surname. The relaxed
// tier resolves nickname aliases ("King Green" on BetOnline vs "Bobby Green"
// on the card): a card never books the same two surnames twice, so a strong
// match on one side plus a shared surname on the other identifies the bout.
export function boutMatch(rA: string, rB: string, tA: string, tB: string): boolean {
  if (samePerson(rA, tA) && samePerson(rB, tB)) return true;
  if (samePerson(rA, tA) && surnameEq(rB, tB)) return true;
  if (samePerson(rB, tB) && surnameEq(rA, tA)) return true;
  if (exactName(rA, tA) && surnameEq(rB, tB)) return true;
  if (exactName(rB, tB) && surnameEq(rA, tA)) return true;
  return false;
}

export function sameFighter(a: string, b: string): boolean {
  return samePerson(a, b);
}

export type PropLine = {
  market: string; // method | round | method_round | total
  fighter: string | null;
  method: string | null;
  round: number | null;
  ou_side: string | null;
  ou_line: number | null;
  odds: number;
  outcome: string | null; // BetOnline's own outcome text, e.g. "Over 42.5 Strikes"
  openedAt: string | null; // when BetOnline first posted this exact outcome
};

// current BetOnline prop prices for a fight, from the bots' prop ledger
export async function fetchFightProps(f1: string, f2: string): Promise<PropLine[] | null> {
  // alias-aware surname prefilter, matched precisely below - the same
  // design as the scraper's verifier. Also sidesteps the 1,000-row cap:
  // QuickBet only ever needs this one fight's rows.
  const toks = surnameTokens(f1, f2);
  if (!toks.length) return null;
  const flt = toks.map((t) => `fight_key.ilike.%${t}%`).join(",");
  const { data, error } = await supabase.from("bol_current_props").select("*").or(flt);
  if (error || !data) return null;
  const out: PropLine[] = [];
  for (const row of data as (PropLine & { fight_key: string; opened_at?: string | null })[]) {
    const parts = String(row.fight_key).split(" vs ");
    if (parts.length !== 2) continue;
    const [ra, rb] = parts;
    if (boutMatch(ra, rb, f1, f2) || boutMatch(rb, ra, f1, f2)) {
      out.push({
        market: row.market, fighter: row.fighter, method: row.method,
        round: row.round, ou_side: row.ou_side, ou_line: row.ou_line,
        odds: row.odds, outcome: row.outcome ?? null,
        openedAt: row.opened_at ?? null,
      });
    }
  }
  return out;
}

// the full board line for a specific prop selection (price + when it opened),
// or null if the board lacks it
export function matchPropLine(
  props: PropLine[],
  betType: string,
  fighterName: string,
  method: string,
  round: string,
  ouSide: string,
  ouLine: number | null,
  outcome: string | null = null
): PropLine | null {
  if (betType === "totals") {
    const hit = props.find(
      (p) =>
        p.market === "total" &&
        p.ou_side === ouSide &&
        ouLine !== null &&
        p.ou_line !== null &&
        Math.abs(p.ou_line - ouLine) < 1e-6
    );
    return hit ?? null;
  }
  if (betType !== "method" && betType !== "round" && betType !== "method_round") {
    // v2 stat markets (parser slugs): matchup, O/U, and round-scoped shapes
    const hit = props.find((p) => {
      if (p.market !== betType) return false;
      // exact-outcome selection (specials): BetOnline's outcome text is the key
      if (outcome) return p.outcome === outcome;
      if (p.ou_side) {
        if (p.ou_side !== ouSide) return false;
        // Line-less O/U markets: BetOnline posts SS/TD totals with no numeric
        // line in its payload, so the ledger stores ou_line null. Null on both
        // sides IS the match; mismatched nullity is not; numeric lines compare.
        if (ouLine === null || p.ou_line === null) {
          if (ouLine !== null || p.ou_line !== null) return false;
        } else if (Math.abs(p.ou_line - ouLine) > 1e-6) return false;
        if (p.fighter && !sameFighter(p.fighter, fighterName)) return false;
      } else {
        if (!p.fighter || !sameFighter(p.fighter, fighterName)) return false;
      }
      if (round) {
        if (String(p.round) !== String(round)) return false;
      } else if (p.round !== null) {
        return false;
      }
      return true;
    });
    return hit ?? null;
  }
  const hit = props.find((p) => {
    if (p.market !== betType) return false;
    if (!p.fighter || !sameFighter(p.fighter, fighterName)) return false;
    if ((betType === "method" || betType === "method_round") && p.method !== method)
      return false;
    if ((betType === "round" || betType === "method_round") && String(p.round) !== String(round))
      return false;
    return true;
  });
  return hit ?? null;
}

// price-only view of matchPropLine, kept for existing callers
export function matchPropOdds(
  props: PropLine[],
  betType: string,
  fighterName: string,
  method: string,
  round: string,
  ouSide: string,
  ouLine: number | null
): number | null {
  const hit = matchPropLine(props, betType, fighterName, method, round, ouSide, ouLine);
  return hit ? hit.odds : null;
}

// the board's total-rounds line for a fight (usually one, e.g. 2.5)
export function boardTotalLine(props: PropLine[]): number | null {
  const t = props.find((p) => p.market === "total" && p.ou_line !== null);
  return t ? t.ou_line : null;
}

// every total-rounds line BetOnline offers for a fight, the most pick'em
// (over closest to even money) first - for the log-bet line picker
export function boardTotalLines(props: PropLine[]): number[] {
  const overByLine = new Map<number, number | null>();
  for (const p of props) {
    if (p.market !== "total" || p.ou_line === null) continue;
    if (p.ou_side === "over") overByLine.set(p.ou_line, p.odds);
    else if (!overByLine.has(p.ou_line)) overByLine.set(p.ou_line, null);
  }
  const prob = (o: number) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
  return [...overByLine.entries()]
    .sort((a, b) => {
      const da = a[1] === null ? 1 : Math.abs(prob(a[1]) - 0.5);
      const db = b[1] === null ? 1 : Math.abs(prob(b[1]) - 0.5);
      return da - db;
    })
    .map((e) => e[0]);
}

export async function fetchFightBoard(f1: string, f2: string): Promise<FightBoard> {
  // same prefilter + truncation guard as fetchFightProps
  const toks = surnameTokens(f1, f2);
  if (!toks.length) return null;
  const flt = toks
    .flatMap((t) => [`fighter1.ilike.%${t}%`, `fighter2.ilike.%${t}%`])
    .join(",");
  const { data, error } = await supabase.from("bol_current_lines").select("*").or(flt);
  if (error || !data) return null;
  for (const row of data as LineRow[]) {
    const forward = boutMatch(row.fighter1, row.fighter2, f1, f2);
    const swapped = boutMatch(row.fighter2, row.fighter1, f1, f2);
    if (!forward && !swapped) continue;
    return {
      side1: forward ? row.fighter1_odds : row.fighter2_odds,
      side2: forward ? row.fighter2_odds : row.fighter1_odds,
      capturedAt: row.captured_at,
      openedAt: row.opened_at ?? null,
    };
  }
  return null;
}

// "-150" / "+130" from a numeric American price
export function fmtAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// "3m ago" / "2h ago" - the board breathes, so show how fresh the line is
export function freshness(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}
