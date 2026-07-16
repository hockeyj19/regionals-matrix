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

function samePerson(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (aliasMatch(na, nb)) return true; // declared identity - new surname
  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
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
  return normName(a) === normName(b) && !!normName(a);
}

function surnameEq(a: string, b: string): boolean {
  const ta = normName(a).split(" ").filter(Boolean);
  const tb = normName(b).split(" ").filter(Boolean);
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
  const { data, error } = await supabase.from("bol_current_props").select("*");
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
        if (ouLine === null || p.ou_line === null || Math.abs(p.ou_line - ouLine) > 1e-6)
          return false;
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
  const { data, error } = await supabase.from("bol_current_lines").select("*");
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
