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
