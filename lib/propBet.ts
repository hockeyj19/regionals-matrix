import { sameFighter } from "@/lib/board";
import { eventStartISO } from "@/lib/format";
import type { EventRow, FightRow, NewBet } from "@/lib/types";

/**
 * One row from the live BetOnline props sheet (bol_current_props) or a
 * historical snapshot of one (bol_prop_snapshots) - both share this exact
 * shape, which is also what identifies a prop bet's wager identity.
 */
export type PropRow = {
  fight_key: string;
  market: string;
  fighter: string | null;
  method: string | null;
  round: number | null;
  ou_side: string | null;
  ou_line: number | null;
  odds: number;
  outcome: string | null;
};

export function propTitleCase(mk: string): string {
  return mk.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function propLastToken(name: string): string {
  const norm = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const parts = norm.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function resolvePropFighterId(p: PropRow, f: FightRow): string | null {
  if (!p.fighter) return f.fighter1_id ?? f.fighter2_id; // fight-level bout locator
  if (sameFighter(p.fighter, f.fighter1_name)) return f.fighter1_id;
  if (sameFighter(p.fighter, f.fighter2_name)) return f.fighter2_id;
  // BetOnline often labels a prop row by surname alone (e.g. "Rakic"), which
  // sameFighter's full-name rule can miss. Within one known bout that surname
  // is unambiguous - a card never books the same surname twice - so fall back
  // to a last-token compare instead of leaving it to the default guess.
  const pLast = propLastToken(p.fighter);
  const f1Last = propLastToken(f.fighter1_name);
  const f2Last = propLastToken(f.fighter2_name);
  if (pLast && pLast === f1Last && pLast !== f2Last) return f.fighter1_id;
  if (pLast && pLast === f2Last && pLast !== f1Last) return f.fighter2_id;
  return f.fighter1_id ?? f.fighter2_id;
}

export function buildPropSelection(p: PropRow, f1Name: string, f2Name: string): string {
  const methodLabel =
    p.method === "ko_tko" ? "KO/TKO" : p.method === "submission" ? "Submission" : "Decision";
  if (p.market === "method") return `${p.fighter ?? ""} by ${methodLabel}`.trim();
  if (p.market === "round") return `${p.fighter ?? ""} in R${p.round}`.trim();
  if (p.market === "method_round")
    return `${p.fighter ?? ""} by ${methodLabel} in R${p.round}`.trim();
  const title = propTitleCase(p.market);
  if (p.market === "total" && p.ou_side)
    return `${p.ou_side === "over" ? "Over" : "Under"} ${p.ou_line ?? ""} — ${f1Name} vs ${f2Name}`;
  if (p.ou_side) {
    const who = p.fighter ?? `${f1Name} vs ${f2Name}`;
    return `${who} ${p.ou_side === "over" ? "Over" : "Under"}${
      p.ou_line !== null ? ` ${p.ou_line}` : ""
    } — ${title}`;
  }
  if (p.fighter) return `${p.fighter} — ${p.outcome ?? title}`;
  return p.outcome ?? title;
}

// bet_type/prop_method/prop_round/ou_line follow the exact same convention
// QuickBet writes: core totals carry over/under as bet_type itself; every
// other market keeps its own market key as bet_type, with over/under (for
// stat props that are themselves O/U) riding in prop_method instead.
export function propToBetShape(
  p: PropRow,
  f: FightRow,
  ev: EventRow
): Omit<NewBet, "odds" | "stake"> {
  let bet_type: string = p.market;
  let prop_method: string | null = null;
  let prop_round: number | null = null;
  let ou_line: number | null = null;

  if (p.market === "method") {
    prop_method = p.method;
  } else if (p.market === "round") {
    prop_round = p.round;
  } else if (p.market === "method_round") {
    prop_method = p.method;
    prop_round = p.round;
  } else if (p.market === "total" && p.ou_side) {
    bet_type = p.ou_side; // "over" | "under"
    ou_line = p.ou_line;
  } else if (p.ou_side) {
    prop_method = p.ou_side; // "over" | "under" - the market itself stays bet_type
    ou_line = p.ou_line;
  } else if (p.ou_line !== null) {
    ou_line = p.ou_line; // a line without an O/U tag, e.g. Point Spread
  }

  return {
    selection: buildPropSelection(p, f.fighter1_name, f.fighter2_name),
    event_context: `${ev.org} — ${ev.event_name}`,
    event_date: ev.event_date,
    event_start: eventStartISO(ev.event_date, ev.event_time),
    book: "BetOnline.ag",
    price_check: null,
    market_best: null,
    market_book: null,
    market_checked_at: null,
    close_odds: null,
    clv: null,
    fighter_id: resolvePropFighterId(p, f),
    bet_type,
    prop_method,
    prop_round,
    ou_line,
    event_source_url: ev.source_url,
  };
}

// BetOnline's own running order on their fight page - both the props panel
// and the bet slip present markets in this sequence, so the board reads the
// way the book does. Anything new BetOnline ships lands after these.
export const MARKET_ORDER: string[] = [
  // BetOnline leads with the fight-titled specials block, and carries the
  // game total up with the main lines - so both sit at the top here.
  "specials",
  "total",
  "goes_the_distance",
  "method",
  "round",
  "method_round",
  "win_inside_distance_goes_distance_no_action",
  "point_spread",
  "fighter_wins_inside_distance",
  "how_will_fight_end",
  "double_chance",
  "fight_goes_to_split_or_majority_decision",
  "decision_method_of_victory",
  "most_significant_strikes_landed",
  "most_takedowns_landed",
  "total_significant_strikes",
  "total_takedowns",
  "scorecard_winner_or_finish",
  "fight_to_start",
];

export function marketRank(mk: string): number {
  const i = MARKET_ORDER.indexOf(mk);
  return i === -1 ? MARKET_ORDER.length : i;
}

// markets that render as one shared section regardless of fighter (moneyline-
// shaped, or an outright over/under) rather than split into a section per
// fighter or per round
export const CORE_MARKETS = new Set(["method", "round", "method_round", "total"]);

function impliedProbLocal(o: number): number {
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}

// the label BetOnline effectively shows for one row - reused verbatim from
// the props panel so a row reads identically wherever it's displayed
export function propRowLabel(p: PropRow): string {
  const fallback = (): string => {
    const bits: string[] = [];
    if (p.fighter) bits.push(p.fighter);
    if (p.ou_side) bits.push(`${p.ou_side === "over" ? "Over" : "Under"} ${p.ou_line ?? ""}`);
    if (p.method)
      bits.push(
        p.method === "ko_tko" ? "KO/TKO" : p.method === "submission" ? "Submission" : "Decision"
      );
    if (p.round !== null) bits.push(`R${p.round}`);
    return bits.join(" ") || "—";
  };
  // a zero line is a placeholder from a stale capture, never a real total
  const ln = p.ou_line !== null && p.ou_line !== 0 ? p.ou_line : null;
  if (p.ou_side) return `${p.ou_side === "over" ? "Over" : "Under"}${ln !== null ? ` ${ln}` : ""}`;
  const base = p.outcome ?? fallback();
  if (ln !== null && !String(base).includes(String(ln)))
    return `${base} ${ln > 0 ? "+" : ""}${ln}`;
  return base;
}

export type PropSection = { title: string; rows: PropRow[] };

// Groups a fight's live prop rows into the same sections, titles, and sort
// order BetOnline's own page uses - the single source of truth both the Odds
// board's props sheet and the Notes price matrix build from, so a market
// never reads two different ways in two different places.
export function buildPropSections(propList: PropRow[], fightKey: string): PropSection[] {
  const rows = propList.filter((p) => p.fight_key === fightKey);
  const yesNoRank = (p: PropRow): number => {
    const o = (p.outcome ?? "").trim().toLowerCase();
    return o === "yes" ? 0 : o === "no" ? 1 : -1;
  };
  const rowSort = (a: PropRow, b: PropRow): number => {
    if (a.ou_side && b.ou_side) {
      const la = a.ou_line ?? 0;
      const lb = b.ou_line ?? 0;
      if (la !== lb) return la - lb;
      return a.ou_side === "over" ? -1 : 1;
    }
    const ra = yesNoRank(a);
    const rb = yesNoRank(b);
    if (ra >= 0 && rb >= 0 && ra !== rb) return ra - rb;
    return impliedProbLocal(b.odds) - impliedProbLocal(a.odds);
  };
  const secs: PropSection[] = [];
  const add = (title: string, rs: PropRow[]) => {
    if (rs.length) secs.push({ title, rows: rs.slice().sort(rowSort) });
  };
  const CORE_TITLES: Record<string, string> = {
    method: "Method of Victory",
    round: "Round Betting",
    method_round: "Method + Round",
    total: "Total Rounds",
  };
  const present = [...new Set(rows.map((p) => p.market))].sort(
    (a, b) => marketRank(a) - marketRank(b) || a.localeCompare(b)
  );
  for (const mk of present) {
    const mrows = rows.filter((p) => p.market === mk);
    const t = CORE_TITLES[mk] ?? propTitleCase(mk);
    if (CORE_MARKETS.has(mk)) {
      add(t, mrows);
    } else if (mrows.some((p) => p.ou_side)) {
      for (const f of [...new Set(mrows.map((p) => p.fighter ?? ""))])
        add(f ? `${f} ${t}` : t, mrows.filter((p) => (p.fighter ?? "") === f));
    } else {
      const rds = [...new Set(mrows.filter((p) => p.round !== null).map((p) => p.round as number))].sort(
        (a, b) => a - b
      );
      if (rds.length) for (const r of rds) add(`Round ${r} ${t}`, mrows.filter((p) => p.round === r));
      else add(t, mrows);
    }
  }
  return secs;
}

// A stable, unique key for one exact prop outcome - the same identity tuple
// the stake-cap trigger and Consensus Bot use, so a Notes-matrix cell always
// points at the one specific board row it was typed against, even across two
// markets that share a fighter/round/method in different combinations.
//
// Outcome-list markets (Goes The Distance, How Will Fight End, Double Chance,
// Fight To Start, Win Inside Distance/Goes Distance/No Action, and similar)
// carry no fighter/method/round/ou_side/ou_line at all - every outcome would
// otherwise collapse onto the same key. A slugified outcome is appended only
// in that all-empty case, so every market that already disambiguates via the
// other fields keeps its exact existing key untouched.
export function propRowKey(p: PropRow): string {
  const base: (string | number)[] = [
    p.market,
    p.fighter ?? "",
    p.method ?? "",
    p.round ?? "",
    p.ou_side ?? "",
    p.ou_line ?? "",
  ];
  const allEmpty = base.slice(1).every((v) => v === "");
  if (allEmpty && p.outcome) {
    return [...base, slugOutcome(p.outcome)].join("|");
  }
  return base.join("|");
}

function slugOutcome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
