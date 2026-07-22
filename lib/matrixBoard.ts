import { americanToImplied } from "@/lib/format";
import { parseOddsInput } from "@/lib/format";

/**
 * Connects the Notes matrix to the BetOnline board. Each matrix cell is the
 * price the USER BELIEVES IS FAIR for that market - not a price they found
 * elsewhere. The chip reports whether betting that market at the board's
 * real, live price would be good or bad value relative to that belief:
 * positive = the board's price implies a LOWER win probability than the
 * user's own fair-value price, so backing it at the board's number is good
 * value; negative = the board is asking the user to pay for a HIGHER
 * probability than they themselves believe is fair, so it's a bad bet at
 * the board's real price even though the fighter may well be a big
 * favorite. This is a value-betting signal, not "did you beat the market" -
 * it is unrelated to the platform's real/live CLV, which compares a bet
 * actually locked in against the eventual close.
 */

export type MatrixBoardPrice = {
  // current BetOnline price for one matrix cell, per fighter side
  f1: number | null;
  f2: number | null;
};

// one live BetOnline prop row (subset of bol_current_props we need here)
export type BoardProp = {
  fight_key: string;
  market: string;
  fighter: string | null;
  method: string | null;
  round: number | null;
  ou_side: string | null;
  ou_line: number | null;
  odds: number;
};

// one live BetOnline moneyline row (from bol_board), already matched to a fight
export type BoardML = { cur1: number | null; cur2: number | null };

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
function lastTok(s: string): string {
  const p = norm(s).split(" ").filter(Boolean);
  return p[p.length - 1] ?? "";
}

// does a BetOnline prop row's fighter label refer to this fight-card fighter?
// full-name first, surname-only fallback (unambiguous within one bout).
function propIsFighter(propFighter: string | null, cardName: string, otherName: string): boolean {
  if (!propFighter) return false;
  const pf = norm(propFighter);
  const cn = norm(cardName);
  if (pf === cn) return true;
  const pl = lastTok(propFighter);
  return pl !== "" && pl === lastTok(cardName) && pl !== lastTok(otherName);
}

// Each matrix market key -> how to find its two board prices (f1 side, f2 side)
// among this fight's BetOnline prop rows (or moneyline). Returns null for a
// side when the board doesn't post it, or for markets BetOnline doesn't carry.
export function boardPriceForMarket(
  marketKey: string,
  ml: BoardML | null,
  props: BoardProp[],
  f1Name: string,
  f2Name: string
): MatrixBoardPrice {
  const side = (name: string, other: string, pred: (p: BoardProp) => boolean): number | null => {
    const r = props.find((p) => pred(p) && propIsFighter(p.fighter, name, other));
    return r ? r.odds : null;
  };
  const fightLevel = (pred: (p: BoardProp) => boolean): number | null => {
    const r = props.find(pred);
    return r ? r.odds : null;
  };

  switch (marketKey) {
    case "ml":
      return { f1: ml?.cur1 ?? null, f2: ml?.cur2 ?? null };

    case "win_tko":
      return {
        f1: side(f1Name, f2Name, (p) => p.market === "method" && p.method === "ko_tko"),
        f2: side(f2Name, f1Name, (p) => p.market === "method" && p.method === "ko_tko"),
      };
    case "win_sub":
      return {
        f1: side(f1Name, f2Name, (p) => p.market === "method" && p.method === "submission"),
        f2: side(f2Name, f1Name, (p) => p.market === "method" && p.method === "submission"),
      };
    case "win_dec":
      return {
        f1: side(f1Name, f2Name, (p) => p.market === "method" && p.method === "decision"),
        f2: side(f2Name, f1Name, (p) => p.market === "method" && p.method === "decision"),
      };

    // fight-rounds totals: NOT fighter-specific. Left box = over, right = under.
    case "ou_rds_15":
    case "ou_rds_25":
    case "ou_rds_35":
    case "ou_rds_45": {
      const line = { ou_rds_15: 1.5, ou_rds_25: 2.5, ou_rds_35: 3.5, ou_rds_45: 4.5 }[marketKey]!;
      return {
        f1: fightLevel((p) => p.market === "total" && p.ou_side === "over" && Number(p.ou_line) === line),
        f2: fightLevel((p) => p.market === "total" && p.ou_side === "under" && Number(p.ou_line) === line),
      };
    }

    case "most_sig_strikes":
      return {
        f1: side(f1Name, f2Name, (p) => p.market === "most_significant_strikes_landed"),
        f2: side(f2Name, f1Name, (p) => p.market === "most_significant_strikes_landed"),
      };
    case "most_takedowns":
      return {
        f1: side(f1Name, f2Name, (p) => p.market === "most_takedowns_landed"),
        f2: side(f2Name, f1Name, (p) => p.market === "most_takedowns_landed"),
      };

    // takedown totals: per-fighter. Left box = that fighter's OVER at the line,
    // right box = that fighter's UNDER at the line.
    case "over_05_td":
    case "over_15_td": {
      const line = marketKey === "over_05_td" ? 0.5 : 1.5;
      return {
        f1: side(
          f1Name,
          f2Name,
          (p) => p.market === "total_takedowns" && p.ou_side === "over" && Number(p.ou_line) === line
        ),
        f2: side(
          f2Name,
          f1Name,
          (p) => p.market === "total_takedowns" && p.ou_side === "under" && Number(p.ou_line) === line
        ),
      };
    }

    // "Finish Only" = BetOnline's Win Inside Distance / Goes Distance / No Action
    case "itd_only":
      return {
        f1: side(f1Name, f2Name, (p) => p.market === "win_inside_distance_goes_distance_no_action"),
        f2: side(f2Name, f1Name, (p) => p.market === "win_inside_distance_goes_distance_no_action"),
      };

    // markets BetOnline doesn't post -> always dash
    case "dec_only":
    case "sub_only":
    default:
      return { f1: null, f2: null };
  }
}

// CLV of a typed cell against the board, in %. Positive = beat the board.
// Returns null if the cell is empty/unparseable or the board lacks the price.
export function cellClv(typed: string | undefined, board: number | null): number | null {
  if (board === null) return null;
  const yours = parseOddsInput(typed ?? "");
  if (yours === null) return null;
  // positive = the board's real price is asking for less win probability
  // than the user's own fair-value price implies - good value to bet at
  // the board's number. Negative = the board wants MORE win probability
  // than the user believes is fair - bad value even on a big favorite.
  return (americanToImplied(yours) - americanToImplied(board)) * 100;
}
