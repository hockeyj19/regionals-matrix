// Odds-feed helpers: normalize the board from /api/odds and check a claimed
// moneyline price against it. Pure functions, safe on the client.

export type FeedBook = { key: string; title: string; prices: Record<string, number> };
export type FeedEvent = { id: string; commence: string; f1: string; f2: string; books: FeedBook[] };

export type PriceCheck = {
  price_check: "verified" | "above_market" | "no_data";
  market_best: number | null;
  market_book: string | null;
};

export function normName(n: string): string {
  return (n ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastToken(n: string): string {
  const parts = normName(n).split(" ");
  return parts[parts.length - 1] ?? "";
}

// find the feed event for our two fighters (order-insensitive, accent-safe;
// falls back to matching both surnames)
export function matchFeedFight(events: FeedEvent[], a: string, b: string): FeedEvent | null {
  const na = normName(a);
  const nb = normName(b);
  const exact = events.find((e) => {
    const e1 = normName(e.f1);
    const e2 = normName(e.f2);
    return (e1 === na && e2 === nb) || (e1 === nb && e2 === na);
  });
  if (exact) return exact;
  const la = lastToken(a);
  const lb = lastToken(b);
  if (!la || !lb) return null;
  return (
    events.find((e) => {
      const l1 = lastToken(e.f1);
      const l2 = lastToken(e.f2);
      return (l1 === la && l2 === lb) || (l1 === lb && l2 === la);
    }) ?? null
  );
}

// the fighter's moneyline at every book, best price first
// (american odds compare directly: a numerically higher price pays more)
export function pricesFor(ev: FeedEvent, fighter: string): { book: string; price: number }[] {
  const target = normName(fighter);
  const lt = lastToken(fighter);
  const out: { book: string; price: number }[] = [];
  for (const b of ev.books) {
    for (const [name, price] of Object.entries(b.prices)) {
      if (normName(name) === target || lastToken(name) === lt) {
        out.push({ book: b.title, price: Number(price) });
        break;
      }
    }
  }
  return out.sort((x, y) => y.price - x.price);
}

export function checkPrice(
  events: FeedEvent[],
  f1: string,
  f2: string,
  side: string,
  claimed: number
): PriceCheck {
  const ev = matchFeedFight(events, f1, f2);
  if (!ev) return { price_check: "no_data", market_best: null, market_book: null };
  const prices = pricesFor(ev, side);
  if (prices.length === 0) return { price_check: "no_data", market_best: null, market_book: null };
  const best = prices[0];
  return {
    price_check: claimed <= best.price ? "verified" : "above_market",
    market_best: best.price,
    market_book: best.book,
  };
}

// --- Closing Line Value ---
// American odds -> implied probability (vig included; fine for CLV deltas).
export function impliedProb(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

// CLV in percentage points of implied probability. Positive = you got a
// better number than the close (beat the market). Uses probability space so
// +120 -> +140 and -140 -> -120 are measured on the same scale.
export function clvPct(yourOdds: number, closeOdds: number): number {
  return (impliedProb(closeOdds) - impliedProb(yourOdds)) * 100;
}

// "Beat the close" = your price paid more than the closing price.
export function beatClose(yourOdds: number, closeOdds: number): boolean {
  return impliedProb(yourOdds) < impliedProb(closeOdds);
}
