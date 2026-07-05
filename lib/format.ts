import type { BetRow, EventRow } from "@/lib/types";

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

// American-odds profit (in units) for a settled bet; pending/push = 0
export function betProfit(b: BetRow): number {
  if (b.result === "win")
    return Number(b.stake) * (b.odds > 0 ? b.odds / 100 : 100 / Math.abs(b.odds));
  if (b.result === "loss") return -Number(b.stake);
  return 0;
}

export function fmtOdds(o: number): string {
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

// validate American odds + units inputs; returns parsed values or an error string
export function parseBetInputs(odds: string, stake: string): { odds: number; stake: number } | string {
  const o = parseInt(odds, 10);
  const s = parseFloat(stake);
  if (isNaN(o) || Math.abs(o) < 100) return "Odds must be American, e.g. -150 or +130.";
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

export const MATRIX_MARKETS: [string, string][] = [
  ["win_tko", "Win by TKO"],
  ["win_sub", "Win by Sub"],
  ["win_dec", "Win by Dec"],
  ["ml", "ML"],
  ["wins_itd", "Wins ITD"],
  ["no_dec", "No Dec / Goes Dec"],
  ["itd_only", "ITD Only"],
  ["dec_only", "Dec Only"],
  ["sub_only", "Sub Only"],
  ["most_sig_strikes", "Most Significant Strikes"],
  ["most_takedowns", "Most Takedowns"],
  ["over_05_td", "Over 0.5 Takedowns"],
  ["over_15_td", "Over 1.5 Takedowns"],
];

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

export const SHARP_BOOKS = ["BetOnline.ag", "Pinnacle", "Polymarket", "Kalshi"];
export const SOFT_BOOKS = ["Bet365", "DraftKings", "FanDuel", "BetMGM", "Caesars", "BetRivers", "Bovada"];
export const BOOKS = [
  "BetOnline.ag",
  "Pinnacle",
  "Bet365",
  "DraftKings",
  "FanDuel",
  "BetMGM",
  "Caesars",
  "BetRivers",
  "Bovada",
  "Polymarket",
  "Kalshi",
];

export function bookTier(book: string | null): "sharp" | "soft" | null {
  if (!book) return null;
  if (SHARP_BOOKS.includes(book)) return "sharp";
  if (SOFT_BOOKS.includes(book)) return "soft";
  return null;
}
