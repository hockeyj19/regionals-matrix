import type { FightRow } from "@/lib/types";
import { propRowKey, propRowLabel, type PropRow } from "@/lib/propBet";

// Fighter-name matching identical in spirit to the board's own matching:
// full name first, surname-only fallback (unambiguous within one bout).
function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
function lastToken(s: string): string {
  const p = normName(s).split(" ").filter(Boolean);
  return p[p.length - 1] ?? "";
}
function isFighter(propFighter: string | null, cardName: string, otherName: string): boolean {
  if (!propFighter) return false;
  const pf = normName(propFighter);
  if (pf === normName(cardName)) return true;
  const pl = lastToken(propFighter);
  return pl !== "" && pl === lastToken(cardName) && pl !== lastToken(otherName);
}

// 5-round fights (main events / title bouts) get the deeper round lines and
// the wider default spread.
export function isFiveRound(fight: FightRow): boolean {
  return fight.is_main_event || /champ|title/i.test(fight.weight_class ?? "");
}

// A manually-priced row: label to show, storage key, and the live board price
// (if BetOnline has posted this exact outcome) for the CLV chip.
export type PresetPriceRow = { key: string; label: string; board: number | null };

// A manually-lined row with no price at all - just a line the user types,
// compared against the board's own line for the same outcome (if posted).
export type PresetDiffRow = { key: string; label: string; boardLine: number | null };

const ROUND_LINES_STANDARD = [1.5, 2.5];
const ROUND_LINES_FIVE = [1.5, 2.5, 3.5, 4.5];
const TAKEDOWN_PRESET_LINES = [0.5, 1.5, 2.5, 3.5];

export function pointSpreadDefaultLine(fiveRound: boolean): number {
  return fiveRound ? 5.5 : 3.5;
}

function findByLine(
  props: PropRow[],
  market: string,
  side: "over" | "under",
  line: number
): PropRow | undefined {
  return props.find(
    (p) => p.market === market && p.ou_side === side && Number(p.ou_line) === line
  );
}

// Total Rounds: fight-level, no fighter split. 1.5/2.5 always; 3.5/4.5 added
// on 5-round fights. BetOnline has never been seen to post a 0.5 line, so
// that case isn't handled.
export function buildTotalRoundsRows(props: PropRow[], fiveRound: boolean): PresetPriceRow[] {
  const lines = fiveRound ? ROUND_LINES_FIVE : ROUND_LINES_STANDARD;
  const rows: PresetPriceRow[] = [];
  for (const line of lines) {
    for (const side of ["over", "under"] as const) {
      const live = findByLine(props, "total", side, line);
      rows.push({
        key: `total|${side}|${line}`,
        label: `${side === "over" ? "Over" : "Under"} ${line}`,
        board: live ? live.odds : null,
      });
    }
  }
  return rows;
}

// Point Spread: one row per fighter at the default line (3.5 standard /
// 5.5 five-round), plus an extra pair of rows for any additional magnitude
// BetOnline actually posts. Favorite/underdog sign is read from the board
// when BetOnline has that fighter's spread priced; otherwise it falls back
// to the fight's own moneyline (lower price = favorite = lays the points).
export function buildPointSpreadRows(
  props: PropRow[],
  f1Name: string,
  f2Name: string,
  fiveRound: boolean,
  mlCur1: number | null,
  mlCur2: number | null
): PresetPriceRow[] {
  const defaultMag = pointSpreadDefaultLine(fiveRound);
  const liveMagnitudes = new Set<number>();
  for (const p of props) {
    if (p.market === "point_spread" && p.ou_line !== null) liveMagnitudes.add(Math.abs(p.ou_line));
  }
  const magnitudes = Array.from(new Set([defaultMag, ...liveMagnitudes])).sort((a, b) => a - b);

  const f1IsFavoriteGuess =
    mlCur1 !== null && mlCur2 !== null ? mlCur1 < mlCur2 : true; // default: fighter1 favored

  const rows: PresetPriceRow[] = [];
  for (const mag of magnitudes) {
    const sides: readonly [string, string, boolean][] = [
      [f1Name, f2Name, f1IsFavoriteGuess],
      [f2Name, f1Name, !f1IsFavoriteGuess],
    ];
    for (const [name, other, guessFav] of sides) {
      const live = props.find(
        (p) =>
          p.market === "point_spread" &&
          p.ou_line !== null &&
          Math.abs(p.ou_line) === mag &&
          isFighter(p.fighter, name, other)
      );
      const line = live ? (live.ou_line as number) : guessFav ? -mag : mag;
      rows.push({
        key: `point_spread|${name}|${mag}`,
        label: `${name} ${line >= 0 ? "+" : ""}${line}`,
        board: live ? live.odds : null,
      });
    }
  }
  return rows;
}

// Total Sig Strikes: per-fighter, line-only (no price - assumed pick'em per
// house rule). The user's own typed line is compared against BetOnline's
// line for the same fighter, when posted, as a plain strike-count difference.
export function buildSigStrikesRows(
  props: PropRow[],
  f1Name: string,
  f2Name: string
): { name: string; row: PresetDiffRow }[] {
  const out: { name: string; row: PresetDiffRow }[] = [];
  const pairs: readonly [string, string][] = [
    [f1Name, f2Name],
    [f2Name, f1Name],
  ];
  for (const [name, other] of pairs) {
    const live = props.find(
      (p) => p.market === "total_significant_strikes" && isFighter(p.fighter, name, other)
    );
    out.push({
      name,
      row: {
        key: `total_sig_strikes|${name}`,
        label: `${name} Total Sig Strikes`,
        boardLine: live ? live.ou_line : null,
      },
    });
  }
  return out;
}

// Total Takedowns: per-fighter, preset lines 0.5/1.5/2.5/3.5 always
// available; any line BetOnline actually posts above 3.5 is appended.
export function buildTotalTakedownsRows(
  props: PropRow[],
  f1Name: string,
  f2Name: string
): { name: string; rows: PresetPriceRow[] }[] {
  const out: { name: string; rows: PresetPriceRow[] }[] = [];
  const pairs: readonly [string, string][] = [
    [f1Name, f2Name],
    [f2Name, f1Name],
  ];
  for (const [name, other] of pairs) {
    const extra = Array.from(
      new Set(
        props
          .filter(
            (p) =>
              p.market === "total_takedowns" &&
              p.ou_line !== null &&
              p.ou_line > 3.5 &&
              isFighter(p.fighter, name, other)
          )
          .map((p) => p.ou_line as number)
      )
    ).sort((a, b) => a - b);
    const lines = [...TAKEDOWN_PRESET_LINES, ...extra];
    const rows: PresetPriceRow[] = [];
    for (const line of lines) {
      for (const side of ["over", "under"] as const) {
        const live = props.find(
          (p) =>
            p.market === "total_takedowns" &&
            p.ou_side === side &&
            Number(p.ou_line) === line &&
            isFighter(p.fighter, name, other)
        );
        rows.push({
          key: `total_takedowns|${name}|${side}|${line}`,
          label: `${side === "over" ? "Over" : "Under"} ${line}`,
          board: live ? live.odds : null,
        });
      }
    }
    out.push({ name, rows });
  }
  return out;
}

// Plain difference between the user's typed line and the board's line, for
// the Sig Strikes row - a strike count, not a percentage. Null if either
// side is missing/unparseable.
export function lineDiff(typed: string | undefined, boardLine: number | null): number | null {
  if (boardLine === null) return null;
  const t = (typed ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n - boardLine);
}

export function fmtLineDiff(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// Always-on core markets below. Each builds a synthetic PropRow for every
// outcome the market can have, using propRowKey()/propRowLabel() for the
// STORAGE key and label. The LIVE BOARD LOOKUP goes through isFighter()
// instead of an exact-string key match, since BetOnline's scraped fighter
// label isn't guaranteed byte-identical to the fight card's stored name.
// ---------------------------------------------------------------------------

function blankProp(over: Partial<PropRow>): PropRow {
  return {
    fight_key: "",
    market: "",
    fighter: null,
    method: null,
    round: null,
    ou_side: null,
    ou_line: null,
    odds: 0,
    outcome: null,
    ...over,
  };
}

function toPresetRow(synthetic: PropRow, liveProps: PropRow[], otherName: string | null): PresetPriceRow {
  const key = propRowKey(synthetic);
  const live = liveProps.find((p) => {
    if (p.market !== synthetic.market) return false;
    if ((p.method ?? null) !== synthetic.method) return false;
    if ((p.round ?? null) !== synthetic.round) return false;
    if ((p.ou_side ?? null) !== synthetic.ou_side) return false;
    if ((p.ou_line ?? null) !== synthetic.ou_line) return false;
    if (synthetic.fighter === null) return p.fighter === null;
    return isFighter(p.fighter, synthetic.fighter, otherName ?? "");
  });
  return { key, label: propRowLabel(synthetic), board: live ? live.odds : null };
}

const METHODS = ["ko_tko", "submission", "decision"] as const;
const METHOD_ROUND_METHODS = ["ko_tko", "submission"] as const; // decision can't land "in round N"

// Method of Victory: per fighter x 3 methods.
export function buildMethodOfVictoryRows(
  props: PropRow[],
  f1Name: string,
  f2Name: string
): PresetPriceRow[] {
  const rows: PresetPriceRow[] = [];
  const pairs: readonly [string, string][] = [
    [f1Name, f2Name],
    [f2Name, f1Name],
  ];
  for (const [name, other] of pairs) {
    for (const m of METHODS) {
      rows.push(toPresetRow(blankProp({ market: "method", fighter: name, method: m }), props, other));
    }
  }
  return rows;
}

// Round Betting: per fighter x round (3 rounds standard, 5 on main/title).
export function buildRoundBettingRows(
  props: PropRow[],
  f1Name: string,
  f2Name: string,
  fiveRound: boolean
): PresetPriceRow[] {
  const maxRound = fiveRound ? 5 : 3;
  const rows: PresetPriceRow[] = [];
  const pairs: readonly [string, string][] = [
    [f1Name, f2Name],
    [f2Name, f1Name],
  ];
  for (const [name, other] of pairs) {
    for (let r = 1; r <= maxRound; r++) {
      rows.push(toPresetRow(blankProp({ market: "round", fighter: name, round: r }), props, other));
    }
  }
  return rows;
}

// Method + Round: per fighter x round x {KO/TKO, Submission}.
export function buildMethodRoundRows(
  props: PropRow[],
  f1Name: string,
  f2Name: string,
  fiveRound: boolean
): PresetPriceRow[] {
  const maxRound = fiveRound ? 5 : 3;
  const rows: PresetPriceRow[] = [];
  const pairs: readonly [string, string][] = [
    [f1Name, f2Name],
    [f2Name, f1Name],
  ];
  for (const [name, other] of pairs) {
    for (let r = 1; r <= maxRound; r++) {
      for (const m of METHOD_ROUND_METHODS) {
        rows.push(
          toPresetRow(
            blankProp({ market: "method_round", fighter: name, method: m, round: r }),
            props,
            other
          )
        );
      }
    }
  }
  return rows;
}

// Most Significant Strikes Landed / Most Takedowns Landed: a straight
// head-to-head matchup, one row per fighter.
export function buildMostMatchupRows(
  props: PropRow[],
  f1Name: string,
  f2Name: string,
  market: "most_significant_strikes_landed" | "most_takedowns_landed"
): PresetPriceRow[] {
  const pairs: readonly [string, string][] = [
    [f1Name, f2Name],
    [f2Name, f1Name],
  ];
  return pairs.map(([name, other]) => toPresetRow(blankProp({ market, fighter: name }), props, other));
}

// ---------------------------------------------------------------------------
// The reverse direction, done right: given a REAL live board row (from the
// Odds page), return the user's own stored tape-note price for that same
// outcome. The earlier version rebuilt a key from BetOnline's raw row fields,
// which don't match the blank synthetic rows the Notes board saved under -
// so the two paths produced different keys and the lookup always missed.
//
// This version instead REBUILDS THE SAME ROWS THE NOTES BOARD BUILDS (via the
// exact builder functions above), then matches the board row to one of them
// by market/fighter/method/round/side/line - never by reconstructing a key
// from foreign fields. Save path and lookup path now share one source of
// truth, so they cannot drift apart. Total Sig Strikes is deliberately
// excluded: its stored value is a LINE, not a price.
// ---------------------------------------------------------------------------
export function noteForBoardRow(
  fight: FightRow,
  row: PropRow,
  fightData: Record<string, string> | undefined,
  ml: { cur1: number | null; cur2: number | null } | null,
  allProps: PropRow[]
): string | null {
  if (!fightData) return null;
  const f1 = fight.fighter1_name;
  const f2 = fight.fighter2_name;
  const fiveRound = isFiveRound(fight);

  // which fighter (by the card's own name) does this board row belong to?
  const whichFighter = (): string | null => {
    if (row.fighter === null) return null;
    if (isFighter(row.fighter, f1, f2)) return f1;
    if (isFighter(row.fighter, f2, f1)) return f2;
    return null;
  };

  let candidates: PresetPriceRow[] = [];
  switch (row.market) {
    case "total":
      candidates = buildTotalRoundsRows(allProps, fiveRound);
      break;
    case "point_spread":
      candidates = buildPointSpreadRows(allProps, f1, f2, fiveRound, ml?.cur1 ?? null, ml?.cur2 ?? null);
      break;
    case "total_takedowns": {
      const groups = buildTotalTakedownsRows(allProps, f1, f2);
      candidates = groups.flatMap((g) => g.rows);
      break;
    }
    case "method":
      candidates = buildMethodOfVictoryRows(allProps, f1, f2);
      break;
    case "round":
      candidates = buildRoundBettingRows(allProps, f1, f2, fiveRound);
      break;
    case "method_round":
      candidates = buildMethodRoundRows(allProps, f1, f2, fiveRound);
      break;
    case "most_significant_strikes_landed":
    case "most_takedowns_landed":
      candidates = buildMostMatchupRows(allProps, f1, f2, row.market);
      break;
    default:
      return null; // not a templated/priced market - nothing to color
  }

  // find the candidate whose OWN key we'd have built for this exact board row
  const name = whichFighter();
  const target = (() => {
    switch (row.market) {
      case "total":
        if (row.ou_side === null || row.ou_line === null) return null;
        return `total|${row.ou_side}|${row.ou_line}`;
      case "point_spread":
        if (name === null || row.ou_line === null) return null;
        return `point_spread|${name}|${Math.abs(row.ou_line)}`;
      case "total_takedowns":
        if (name === null || row.ou_side === null || row.ou_line === null) return null;
        return `total_takedowns|${name}|${row.ou_side}|${row.ou_line}`;
      case "method":
      case "round":
      case "method_round":
      case "most_significant_strikes_landed":
      case "most_takedowns_landed":
        if (name === null) return null;
        return propRowKey({ ...blankProp({}), market: row.market, fighter: name, method: row.method, round: row.round });
      default:
        return null;
    }
  })();
  if (target === null) return null;

  // confirm the target key is one the builder actually produced (guards
  // against a board row that has no matching template row), then read it
  const matched = candidates.find((c) => c.key === target);
  if (!matched) return null;
  return fightData[matched.key] ?? null;
}
