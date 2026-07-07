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
};

export type FightBoard = {
  side1: number | null; // board price for the fight's fighter1
  side2: number | null; // board price for the fight's fighter2
  capturedAt: string;
} | null;

function samePerson(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
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
function boutMatch(rA: string, rB: string, tA: string, tB: string): boolean {
  if (samePerson(rA, tA) && samePerson(rB, tB)) return true;
  if (samePerson(rA, tA) && surnameEq(rB, tB)) return true;
  if (samePerson(rB, tB) && surnameEq(rA, tA)) return true;
  if (exactName(rA, tA) && surnameEq(rB, tB)) return true;
  if (exactName(rB, tB) && surnameEq(rA, tA)) return true;
  return false;
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
