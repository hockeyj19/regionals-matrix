import type { EventRow } from "@/lib/types";

// "2026-06-26" -> "Friday, June 26th"
// Convert "7:00 PM ET" -> minutes since midnight, for sorting. No time sorts last.
export function timeToMinutes(t: string | null): number {
  if (!t) return 99999;
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 99999;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const pm = m[3].toUpperCase() === "PM";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return h * 60 + min;
}

// Sort events by date, then by start time within the same date.
export function sortEvents(rows: EventRow[]): EventRow[] {
  return [...rows].sort((a, b) => {
    const da = a.event_date ?? "";
    const db = b.event_date ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return timeToMinutes(a.event_time) - timeToMinutes(b.event_time);
  });
}
export function formatEventDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = dt.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const suffix =
    d % 10 === 1 && d !== 11 ? "st" :
    d % 10 === 2 && d !== 12 ? "nd" :
    d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${weekday}, ${month} ${d}${suffix}`;
}

// Build the "Friday, June 26th, 9:00 AM ET · Location" line.
export function formatEventMeta(ev: EventRow): string {
  const parts: string[] = [];
  const date = formatEventDate(ev.event_date);
  if (date) parts.push(date);
  if (ev.event_time) parts[parts.length - 1] = `${parts[parts.length - 1]}, ${ev.event_time}`;
  const left = parts.join("");
  return ev.location ? `${left} · ${ev.location}` : left;
}

// Link a fighter name to a Tapology search for that fighter.
export function tapologyUrl(name: string): string {
  return `https://www.tapology.com/search?term=${encodeURIComponent(name)}&mainSearchFilter=fighters`;
}

// Has this bet's event started? Null start = never locks (unverified bets).
export function eventStarted(eventStart: string | null): boolean {
  return !!eventStart && new Date(eventStart).getTime() <= Date.now();
}

// American-odds profit (in units) for a settled bet; pending/push = 0.
// Structural so it works on both BetRow and PublicBet.
export function betProfit(b: { result: string; stake: number; odds: number }): number {
  if (b.result === "win")
    return Number(b.stake) * (b.odds > 0 ? b.odds / 100 : 100 / Math.abs(b.odds));
  if (b.result === "loss") return -Number(b.stake);
  return 0;
}

// ---------------------------------------------------------------------------
// Odds format: the app stores AMERICAN odds everywhere (ints in bets, canonical
// "+150"/"-230" strings in tape notes). Users may TYPE either American or
// decimal, and may choose which format the app DISPLAYS. Detection rule:
//   explicit +/- sign            -> American (whole number, |odds| >= 100)
//   unsigned and >= 100          -> American ("150" means +150)
//   unsigned and 1 < value < 100 -> decimal  ("2.50" -> +150, "1.91" -> -110)
// Anything else (0, 1, "-50", "+2.5") is not a valid price -> null.
// ---------------------------------------------------------------------------

export type OddsMode = "american" | "decimal";
const ODDS_MODE_KEY = "odds_mode";
let oddsMode: OddsMode | null = null; // lazy: resolved on first client read

export function getOddsMode(): OddsMode {
  if (oddsMode === null) {
    oddsMode = "american";
    if (typeof window !== "undefined") {
      try {
        const v = window.localStorage.getItem(ODDS_MODE_KEY);
        if (v === "decimal" || v === "american") oddsMode = v;
      } catch {
        /* storage unavailable: stay american */
      }
    }
  }
  return oddsMode;
}

export function setOddsMode(m: OddsMode): void {
  oddsMode = m;
  try {
    window.localStorage.setItem(ODDS_MODE_KEY, m);
  } catch {
    /* per-tab only if storage unavailable */
  }
}

export function americanToDecimal(a: number): number {
  return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
}

export function decimalToAmerican(d: number): number {
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}

// Universal input parser: American or decimal in, American int out (null if invalid).
export function parseOddsInput(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.trim().replace(/\s+/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n === 0) return null;
  if (/^[+-]/.test(t)) {
    // explicit sign = American; must be whole and at least +/-100
    if (!Number.isInteger(n) || Math.abs(n) < 100) return null;
    return n;
  }
  if (n >= 100) return Math.round(n); // "150" = +150
  if (n <= 1) return null; // decimal odds must pay something
  return decimalToAmerican(n);
}

// Display a stored/typed price string in the user's chosen format.
// Unparseable text falls back to what they wrote.
export function displayTypedOdds(s: string | null | undefined): string {
  const a = parseOddsInput(s);
  return a === null ? (s ?? "").trim() : fmtOdds(a);
}

// Canonicalize a typed price to an American string ("+150"/"-230") for storage,
// so decimal entries in tape notes are stored in the same language as the rest
// of the app. Unparseable text is stored as typed.
export function normalizeTypedOdds(s: string): string {
  const a = parseOddsInput(s);
  return a === null ? s.trim() : a > 0 ? `+${a}` : `${a}`;
}

// Format an American price for display, honoring the user's chosen odds format.
export function fmtOdds(o: number): string {
  if (getOddsMode() === "decimal") return americanToDecimal(o).toFixed(2);
  return o > 0 ? `+${o}` : `${o}`;
}

export function fmtUnits(u: number): string {
  const r = Math.round(u * 100) / 100;
  return `${r > 0 ? "+" : ""}${r}u`;
}

export function fmtDate(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// validate odds (American or decimal) + units inputs; returns parsed values
// (odds always American int) or an error string
export function parseBetInputs(odds: string, stake: string): { odds: number; stake: number } | string {
  const o = parseOddsInput(odds);
  const s = parseFloat(stake);
  if (o === null) return "Odds must be American (-150, +130) or decimal (1.67, 2.30).";
  if (isNaN(s) || s <= 0) return "Units must be a positive number.";
  return { odds: o, stake: s };
}

export function sideBtn(active: boolean): string {
  return `rounded-md border px-2 py-1 text-xs truncate ${
    active
      ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
      : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
  }`;
}

export const matrixCell =
  "w-full rounded bg-neutral-800 border border-neutral-700 px-1 py-0.5 text-xs text-center outline-none focus:border-emerald-500";

export type MatrixMarket = { key: string; label: string; fiveRoundOnly?: boolean };

// The Notes matrix, grouped for spacing between sections. The deeper round
// over/unders (3.5, 4.5) only apply to 5-round fights. Keys are kept stable so
// existing cell data survives the relabel; "wins_itd" and "no_dec" were dropped
// and simply stop rendering (their rows aren't lost, just no longer shown).
export const MATRIX_GROUPS: MatrixMarket[][] = [
  [{ key: "ml", label: "ML" }],
  [
    { key: "win_tko", label: "Tko" },
    { key: "win_sub", label: "Sub" },
    { key: "win_dec", label: "Dec" },
  ],
  [
    { key: "ou_rds_15", label: "o/u 1.5" },
    { key: "ou_rds_25", label: "o/u 2.5" },
    { key: "ou_rds_35", label: "o/u 3.5", fiveRoundOnly: true },
    { key: "ou_rds_45", label: "o/u 4.5", fiveRoundOnly: true },
  ],
  [
    { key: "most_sig_strikes", label: "Most SS" },
    { key: "most_takedowns", label: "Most TDs" },
    { key: "over_05_td", label: "0.5 TDs" },
    { key: "over_15_td", label: "1.5 TDs" },
  ],
  [
    { key: "itd_only", label: "Finish Only" },
    { key: "dec_only", label: "Dec Only" },
    { key: "sub_only", label: "Sub Only" },
  ],
];

// flat [key, label] list, kept for anything that still reads the old shape
export const MATRIX_MARKETS: [string, string][] = MATRIX_GROUPS.flat().map(
  (m) => [m.key, m.label] as [string, string]
);

// Event start as an ISO timestamp from the scraped date + "H:MM AM/PM ET" time.
// ET offset is approximated by month (Apr-Oct daylight time); no listed time
// falls back to end-of-day ET, which is lenient by design.
export function eventStartISO(eventDate: string | null, eventTime: string | null): string | null {
  if (!eventDate) return null;
  let hh = 23;
  let mm = 59;
  const m = (eventTime ?? "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m) {
    hh = parseInt(m[1], 10) % 12;
    if (m[3].toUpperCase() === "PM") hh += 12;
    mm = parseInt(m[2], 10);
  }
  const mo = Number(eventDate.split("-")[1]);
  const offset = mo >= 4 && mo <= 10 ? "-04:00" : "-05:00";
  const d = new Date(
    `${eventDate}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${offset}`
  );
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export const SHARP_BOOKS = ["BetOnline.ag"];
export const SOFT_BOOKS = ["Bet365", "DraftKings", "FanDuel", "BetMGM", "Caesars", "BetRivers", "Bovada"];
export const BOOKS = [
  "BetOnline.ag",
  "Bet365",
  "DraftKings",
  "FanDuel",
  "BetMGM",
  "Caesars",
  "BetRivers",
  "Bovada",
];

export function bookLabel(b: string): string {
  return b === "BetOnline.ag" ? "BetOnline" : b;
}

export function bookTier(book: string | null): "sharp" | "soft" | null {
  if (!book) return null;
  if (SHARP_BOOKS.includes(book)) return "sharp";
  if (SOFT_BOOKS.includes(book)) return "soft";
  return null;
}
