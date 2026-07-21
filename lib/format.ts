export type MatrixMarket = {
  key: string;
  label: string;
  fiveRoundOnly?: boolean;
  // Board-line markets: the line itself is entered by hand in the center column.
  hasLine?: boolean;
  // Pre-filled line for standard fights (e.g. Point Spread -> "3.5").
  defaultLine?: string;
  // On 5-round fights (main events / title bouts) drop the default and leave
  // the line blank for manual entry.
  lineFiveRoundManual?: boolean;
};

// The Notes matrix, grouped for spacing between sections. Keys are kept stable
// so existing cell data survives the relabel. The fixed o/u 1.5-4.5 round rows
// were retired in favor of the single fillable "Total Rds" row below, which
// carries its own hand-entered line instead of four locked ones. The board-line
// group mirrors BetOnline's own prop board; each carries a hand-filled line.
// Specials are intentionally left off the matrix.
export const MATRIX_GROUPS: MatrixMarket[][] = [
  [{ key: "ml", label: "ML" }],
  [
    { key: "win_tko", label: "Tko" },
    { key: "win_sub", label: "Sub" },
    { key: "win_dec", label: "Dec" },
  ],
  [
    { key: "most_sig_strikes", label: "Most SS" },
    { key: "most_takedowns", label: "Most TDs" },
    { key: "over_05_td", label: "0.5 TDs" },
    { key: "over_15_td", label: "1.5 TDs" },
  ],
  [
    { key: "total_rounds", label: "Total Rds", hasLine: true },
    { key: "point_spread", label: "Spread", hasLine: true, defaultLine: "3.5", lineFiveRoundManual: true },
    { key: "total_sig_strikes", label: "Total SS", hasLine: true },
    { key: "total_takedowns", label: "Total TDs", hasLine: true },
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
