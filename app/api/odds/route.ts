import { NextResponse } from "next/server";

// The whole route response is cached for 15 minutes, so log-time checks
// cost at most a few feed credits per day no matter how many bets are logged.
export const revalidate = 900;

const FEED_URL = "https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds";

export async function GET() {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    return NextResponse.json({ events: [], error: "no_key" });
  }
  try {
    const url = `${FEED_URL}?apiKey=${key}&regions=us,us2,eu&markets=h2h&oddsFormat=american`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ events: [], error: `feed_${res.status}` });
    }
    const data = (await res.json()) as unknown;
    const events = (Array.isArray(data) ? data : []).map((e: any) => ({
      id: e.id,
      commence: e.commence_time,
      f1: e.home_team,
      f2: e.away_team,
      books: (e.bookmakers ?? []).map((b: any) => ({
        key: b.key,
        title: b.title,
        prices: Object.fromEntries(
          (b.markets?.[0]?.outcomes ?? []).map((o: any) => [o.name, o.price])
        ),
      })),
    }));
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [], error: "fetch_failed" });
  }
}
