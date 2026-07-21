import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicProfile } from "@/lib/publicProfile";
import { betProfit, bookLabel, fmtDate, fmtOdds, fmtUnits } from "@/lib/format";

/**
 * A tipster's public record - readable by anyone, no account needed.
 *
 * This is the page a verified pick travels on: send the link and the receiver
 * sees the record, the closing-line edge, every settled pick, and the price
 * each was struck at. The numbers are computed from the same public bets listed
 * below them, so the headline can never drift from the evidence.
 */

export const dynamic = "force-dynamic"; // a record is only worth linking if it's current

type Props = { params: Promise<{ username: string }> };

function recordLine(p: { wins: number; losses: number; pushes: number }) {
  return `${p.wins}-${p.losses}-${p.pushes}`;
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const p = await getPublicProfile(username);
  if (!p) return { title: "Not found — Tape Notes" };
  // Deliberately no openGraph/twitter fields here: a profile link should act
  // like a normal link - open straight to the page, not unfurl a preview card
  // in Discord/Twitter/iMessage. `title` alone only affects the browser tab.
  return { title: `${p.username} — Tape Notes` };
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  const p = await getPublicProfile(username);
  if (!p) notFound();

  const settledPicks = p.picks.filter((b) => b.result !== "pending");
  const pendingPicks = p.picks.filter((b) => b.result === "pending");
  const unitTone =
    p.units > 0 ? "text-emerald-400" : p.units < 0 ? "text-red-400" : "text-neutral-300";
  const clvTone =
    p.clv === null ? "text-neutral-500" : p.clv >= 0 ? "text-emerald-400" : "text-red-400";

  // bankroll curve: cumulative units across settled picks, oldest first, drawn
  // as a static sparkline (server-rendered SVG - no client code)
  const chron = [...settledPicks].sort((a, b) => {
    const ta = new Date(a.event_date ?? a.placed_at).getTime();
    const tb = new Date(b.event_date ?? b.placed_at).getTime();
    return ta - tb;
  });
  let run = 0;
  const curve: number[] = [0, ...chron.map((b) => (run += betProfit(b)))];
  const showCurve = curve.length > 2;
  let curvePoints = "";
  let curveUp = true;
  if (showCurve) {
    const min = Math.min(...curve);
    const max = Math.max(...curve);
    const range = max - min || 1;
    const W = 600;
    const H = 48;
    curvePoints = curve
      .map((v, i) => {
        const x = (i / (curve.length - 1)) * W;
        const y = H - ((v - min) / range) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    curveUp = curve[curve.length - 1] >= 0;
  }

  const stat = (label: string, value: string, tone = "text-neutral-100") => (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );

  const pick = (b: (typeof p.picks)[number]) => {
    const profit = betProfit(b);
    const tone =
      b.result === "win"
        ? "text-emerald-400"
        : b.result === "loss"
        ? "text-red-400"
        : b.result === "push"
        ? "text-neutral-400"
        : "text-sky-300";
    return (
      <li
        key={b.id}
        className="flex items-start justify-between gap-3 border-t border-neutral-800/80 py-2"
      >
        <div className="min-w-0">
          <p className="text-sm text-neutral-100">
            {b.selection}{" "}
            <span className="text-emerald-400">
              {fmtOdds(b.odds)} · {Number(b.stake)}u
            </span>
            {b.clv !== null && b.clv !== undefined && (
              <span
                className={`ml-1 text-[11px] ${
                  Number(b.clv) >= 0 ? "text-emerald-500/80" : "text-red-500/80"
                }`}
              >
                · CLV {Number(b.clv) >= 0 ? "+" : ""}
                {Number(b.clv).toFixed(1)}
              </span>
            )}
          </p>
          <p className="text-[11px] text-neutral-500 truncate">
            {[
              b.book ? bookLabel(b.book) : null,
              b.event_context,
              b.event_date ? fmtDate(b.event_date) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            {b.price_check === "verified" && (
              <span className="ml-1 uppercase tracking-wide text-emerald-500">· verified</span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-xs font-medium ${tone}`}>{b.result}</p>
          {b.result !== "pending" && b.result !== "push" && (
            <p className={`text-[11px] tabular-nums ${tone}`}>{fmtUnits(profit)}</p>
          )}
        </div>
      </li>
    );
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto w-full max-w-2xl p-4 space-y-4">
        {/* who */}
        <header className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center gap-3">
            {p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.avatarUrl}
                alt=""
                className="h-14 w-14 rounded-full object-cover border border-neutral-700"
              />
            ) : (
              <div className="h-14 w-14 rounded-full border border-neutral-700 bg-neutral-800" />
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold truncate">{p.username}</h1>
              <p className="text-[11px] text-neutral-500">
                {p.verified > 0
                  ? `${p.verified} pick${p.verified === 1 ? "" : "s"} price-verified against the sharp board`
                  : "Verified picks, priced off the sharp board"}
              </p>
            </div>
          </div>
          {p.bio && <p className="mt-3 text-sm text-neutral-300 whitespace-pre-wrap">{p.bio}</p>}
        </header>

        {/* the record - the four numbers that define a sharp tipster */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stat("Record", recordLine(p))}
          {stat("Units", fmtUnits(p.units), unitTone)}
          {stat("ROI", p.roi === null ? "—" : pct(p.roi), p.roi === null ? "text-neutral-500" : unitTone)}
          {stat("CLV", p.clv === null ? "—" : pct(p.clv), clvTone)}
        </section>

        {/* bankroll over time - visual proof the record is real */}
        {showCurve && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] uppercase tracking-wide text-neutral-500">Bankroll</p>
              <p className="text-[10px] text-neutral-600">{settledPicks.length} settled</p>
            </div>
            <svg
              viewBox="0 0 600 48"
              preserveAspectRatio="none"
              className="mt-1 h-12 w-full"
              aria-hidden="true"
            >
              <polyline
                points={curvePoints}
                fill="none"
                stroke={curveUp ? "#10b981" : "#f87171"}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </svg>
          </section>
        )}

        {/* the evidence */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Settled picks
          </h2>
          {settledPicks.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">
              No settled picks yet — the record starts once a logged pick grades.
            </p>
          ) : (
            <ul className="mt-1">{settledPicks.map(pick)}</ul>
          )}
        </section>

        {pendingPicks.length > 0 && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Open picks ({pendingPicks.length})
            </h2>
            <ul className="mt-1">{pendingPicks.map(pick)}</ul>
          </section>
        )}

        {/* what "verified" actually means - the whole point of the page */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            How this is verified
          </h2>
          <p className="mt-2 text-xs text-neutral-400 leading-relaxed">
            Every pick is logged at the price BetOnline was actually showing at the moment it
            was struck — the platform reads the book&apos;s own line feed continuously, so the
            odds on a pick can&apos;t be invented after the fact. Stakes are capped at the
            book&apos;s real limits, new markets can&apos;t be bet for their first 30 minutes,
            and results are graded automatically from official statistics. CLV compares the
            price struck to the closing line on that same board. Picks appear here once their
            event begins, and they can never be edited or quietly deleted.
          </p>
        </section>

        <footer className="pb-6 text-center">
          <a
            href="/"
            className="text-xs text-neutral-500 hover:text-emerald-400 transition-colors"
          >
            Tape Notes
          </a>
        </footer>
      </div>
    </main>
  );
}
