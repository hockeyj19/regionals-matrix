"use client";

import { useState } from "react";
import type { BetRow, EventRow, FightRow, NewBet } from "@/lib/types";
import { betProfit, bookLabel, eventStarted, fmtDate, fmtOdds, fmtUnits, sideBtn } from "@/lib/format";
import { TrashIcon } from "@/components/icons";
import { QuickBet } from "@/components/QuickBet";
import { ManualBet } from "@/components/ManualBet";
import { BETS_README, InfoButton, ReadMePanel } from "@/components/ReadMe";

export function BetTracker({
  bets,
  events,
  fights,
  onAdd,
  onSetResult,
  onDelete,
  onRequestDelete,
  onPublish,
}: {
  bets: BetRow[];
  events: EventRow[];
  fights: FightRow[];
  onAdd: (bet: NewBet) => Promise<string | null>;
  onSetResult: (id: string, result: string) => void;
  onDelete: (id: string) => void;
  onRequestDelete: (id: string, requested: boolean, reason?: string) => void;
  onPublish: (id: string) => void;
}) {
  const [scope, setScope] = useState<"verified" | "all">("verified");
  const [removalFor, setRemovalFor] = useState<string | null>(null);
  const [removalReason, setRemovalReason] = useState("");

  // A removal request without a reason gives the admin nothing to judge, so the
  // reason IS the request - the button only opens the box.
  function sendRemoval(id: string) {
    const why = removalReason.trim();
    if (!why) return;
    onRequestDelete(id, true, why);
    setRemovalFor(null);
    setRemovalReason("");
  }
  const [selEventId, setSelEventId] = useState("");
  const [selFightId, setSelFightId] = useState("");
  const [selEventId2, setSelEventId2] = useState("");
  const [selFightId2, setSelFightId2] = useState("");
  const [showInfo, setShowInfo] = useState(false);

  const selEvent = events.find((ev) => ev.id === selEventId) ?? null;
  const selFight = fights.find((f) => f.id === selFightId) ?? null;
  const selEvent2 = events.find((ev) => ev.id === selEventId2) ?? null;
  const selFight2 = fights.find((f) => f.id === selFightId2) ?? null;

  // "verified" = structured bets tied to a fight (auto-graded); "all" adds manual ones
  const scoped = scope === "verified" ? bets.filter((b) => b.bet_type !== "other") : bets;
  const settled = scoped.filter((b) => b.result !== "pending");
  const wins = settled.filter((b) => b.result === "win").length;
  const losses = settled.filter((b) => b.result === "loss").length;
  const pushes = settled.filter((b) => b.result === "push").length;
  const staked = settled.reduce((s, b) => s + Number(b.stake), 0);
  const profit = settled.reduce((s, b) => s + betProfit(b), 0);
  const roi = staked > 0 ? (profit / staked) * 100 : 0;
  // bankroll curve: cumulative units across settled bets in fight order
  const chron = [...settled].sort((a, b) =>
    (a.event_date ?? a.placed_at).localeCompare(b.event_date ?? b.placed_at)
  );
  let running = 0;
  const cumulative = chron.map((b) => (running += betProfit(b)));

  const clvBets = scoped.filter((b) => b.clv !== null);
  const avgClv = clvBets.length
    ? clvBets.reduce((s, b) => s + Number(b.clv), 0) / clvBets.length
    : null;
  const beatRate = clvBets.length
    ? (clvBets.filter((b) => Number(b.clv) > 0).length / clvBets.length) * 100
    : null;

  const profitTone = profit >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <InfoButton open={showInfo} onClick={() => setShowInfo((v) => !v)} />
        <div className="flex gap-1">
          <button onClick={() => setScope("verified")} className={sideBtn(scope === "verified")}>
            Verified
          </button>
          <button onClick={() => setScope("all")} className={sideBtn(scope === "all")}>
            All bets
          </button>
        </div>
      </div>
      {showInfo && <ReadMePanel paragraphs={BETS_README} />}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Record</p>
          <p className="text-lg font-bold">{wins}-{losses}-{pushes}</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Avg stake</p>
          <p className="text-lg font-bold">
            {settled.length ? Math.round((staked / settled.length) * 100) / 100 : 0}u
          </p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Profit</p>
          <p className={`text-lg font-bold ${profitTone}`}>{fmtUnits(profit)}</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide">ROI</p>
          <p className={`text-lg font-bold ${profitTone}`}>
            {roi >= 0 ? "+" : ""}{roi.toFixed(1)}%
          </p>
        </div>
        {avgClv !== null && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Avg CLV</p>
            <p className={`text-lg font-bold ${avgClv >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {avgClv >= 0 ? "+" : ""}{avgClv.toFixed(2)}
            </p>
          </div>
        )}
        {beatRate !== null && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Beat close</p>
            <p className="text-lg font-bold">{beatRate.toFixed(0)}%</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1">
          Bankroll
        </p>
        <BankrollCurve values={cumulative} />
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
        <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">
          Verified bet
        </p>
        <p className="text-[11px] text-neutral-600">
          Tied to a fight on the board and auto-graded from results.
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            value={selEventId}
            onChange={(e) => {
              setSelEventId(e.target.value);
              setSelFightId("");
            }}
            className="flex-1 min-w-0 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          >
            <option value="">Pick an event</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.org} — {ev.event_name}
              </option>
            ))}
          </select>
          <select
            value={selFightId}
            onChange={(e) => setSelFightId(e.target.value)}
            disabled={!selEventId}
            className="flex-1 min-w-0 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
          >
            <option value="">Pick a fight</option>
            {fights
              .filter((f) => f.event_id === selEventId)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.fighter1_name} vs {f.fighter2_name}
                </option>
              ))}
          </select>
        </div>
        {selEvent && selFight && (
          <QuickBet
            key={selFight.id}
            fight={selFight}
            eventLabel={`${selEvent.org} — ${selEvent.event_name}`}
            eventDate={selEvent.event_date}
            eventTime={selEvent.event_time}
            eventSourceUrl={selEvent.source_url}
            onAdd={onAdd}
            embedded
          />
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
        <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">
          Unverified bet (you grade it)
        </p>
        <p className="text-[11px] text-neutral-600">
          Pick the fight, then log it at your own book and number - you grade this one.
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            value={selEventId2}
            onChange={(e) => {
              setSelEventId2(e.target.value);
              setSelFightId2("");
            }}
            className="flex-1 min-w-0 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          >
            <option value="">Pick an event</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.org} — {ev.event_name}
              </option>
            ))}
          </select>
          <select
            value={selFightId2}
            onChange={(e) => setSelFightId2(e.target.value)}
            disabled={!selEventId2}
            className="flex-1 min-w-0 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
          >
            <option value="">Pick a fight</option>
            {fights
              .filter((f) => f.event_id === selEventId2)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.fighter1_name} vs {f.fighter2_name}
                </option>
              ))}
          </select>
        </div>
        {selEvent2 && selFight2 && (
          <ManualBet
            key={selFight2.id}
            fight={selFight2}
            eventLabel={`${selEvent2.org} — ${selEvent2.event_name}`}
            eventDate={selEvent2.event_date}
            eventTime={selEvent2.event_time}
            eventSourceUrl={selEvent2.source_url}
            onAdd={onAdd}
          />
        )}
      </div>

      {bets.length === 0 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
              How a verified bet lives
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { t: "1 · Log it", d: "Pick the fight above, enter your price and stake." },
                { t: "2 · It locks", d: "At start time: no edits, no deletes, pick goes public." },
                { t: "3 · It grades", d: "The scrape settles it from official results - final." },
                { t: "4 · It counts", d: "Profile, leaderboard, CLV - all automatic." },
              ].map((s) => (
                <div
                  key={s.t}
                  className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-2"
                >
                  <p className="text-[11px] font-semibold text-neutral-300">{s.t}</p>
                  <p className="text-[11px] text-neutral-600 mt-0.5">{s.d}</p>
                </div>
              ))}
            </div>
          </div>

          <div
            aria-hidden
            className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 px-3 py-2 select-none"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm truncate text-neutral-500">
                  Your first pick <span className="text-neutral-600">-150 · 1u</span>{" "}
                  <span className="text-[10px] uppercase tracking-wide text-emerald-600/70 border border-emerald-900/50 rounded px-1">
                    verified
                  </span>
                </p>
                <p className="text-[11px] text-neutral-700 truncate">
                  BetOnline.ag · UFC — the card you have circled · Saturday night
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-700">
                  make public
                </span>
              </div>
            </div>
            <p className="text-[11px] text-neutral-700 mt-1">
              example - your real rows land here, from the form above or the + Log bet
              button on any fight card
            </p>
          </div>
        </div>
      )}

      {/* Live picks only - what's public, and what's still yours alone. Graded
          history now lives on the Profile, where it can be sliced by window. */}
      {bets
        .filter((b) => b.result === "pending")
        .map((b) => {
        const p = betProfit(b);
        const verified = b.bet_type !== "other";
        const started = eventStarted(b.event_start);
        const autoFinal = b.settled_by === "auto";
        // Verified bets are NEVER user-gradeable - their results come only
        // from the auto-grader (or an admin). Anything else would make
        // verified records forgeable, which defeats the platform's core claim.
        const canGrade = !verified;
        // only unverified bets are user-deletable; verified ones go through a
        // removal request (pre-start clears on the next scrape, post-start
        // needs an admin decision) so records can't be quietly curated
        const canDelete = !verified;
        const needsManual =
          b.result === "pending" && !!b.grade_note && /settle manually/i.test(b.grade_note);
        // pre-start picks can be shared to the public profile early; only
        // leaderboard-eligible bets (logged before start) qualify
        const canPublish =
          verified && !started && !b.published_at &&
          !!b.event_start && b.placed_at < b.event_start;
        return (
          <div key={b.id} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {b.selection}{" "}
                  <span className="text-emerald-400">
                    {fmtOdds(b.odds)} · {Number(b.stake)}u
                  </span>
                  {b.bet_type !== "other" && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-500">
                      verified
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-neutral-600 truncate">
                  {b.book ? `${bookLabel(b.book)} · ` : ""}
                  {b.event_context ? `${b.event_context} · ` : ""}
                  {fmtDate(b.event_date ?? b.placed_at)}
                </p>
                {b.grade_note && (
                  <p
                    className={`text-[11px] italic truncate ${
                      needsManual ? "text-amber-400" : "text-neutral-500"
                    }`}
                  >
                    {b.grade_note}
                  </p>
                )}
                {b.bet_type !== "other" &&
                  (!b.event_start || b.placed_at >= b.event_start) && (
                    <p className="text-[11px] text-amber-500/80">
                      Not leaderboard-eligible (no pre-start timestamp)
                    </p>
                  )}
                {b.price_check === "above_market" && b.market_best !== null && (
                  <p className="text-[11px] text-amber-500/80">
                    Above board when logged (best {fmtOdds(b.market_best)}
                    {b.market_book ? ` @ ${b.market_book}` : ""})
                  </p>
                )}
                {b.clv !== null && b.close_odds !== null && (
                  <p className="text-[11px] text-neutral-500">
                    Closed {fmtOdds(b.close_odds)} · CLV{" "}
                    <span className={Number(b.clv) >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {Number(b.clv) >= 0 ? "+" : ""}
                      {Number(b.clv).toFixed(2)}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {b.result !== "pending" && (
                  <span className={`text-xs mr-1 ${p >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtUnits(p)}
                  </span>
                )}
                {autoFinal && (
                  <span
                    title="Settled automatically from official results - final"
                    className="text-[10px] uppercase tracking-wide text-emerald-500 border border-emerald-900 rounded px-1.5 py-0.5"
                  >
                    auto ✓
                  </span>
                )}
                {canGrade && (
                <>
                <button
                  onClick={() => onSetResult(b.id, b.result === "win" ? "pending" : "win")}
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                    b.result === "win"
                      ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                      : "border-neutral-700 text-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  W
                </button>
                <button
                  onClick={() => onSetResult(b.id, b.result === "loss" ? "pending" : "loss")}
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                    b.result === "loss"
                      ? "border-red-500 bg-red-600/20 text-red-300"
                      : "border-neutral-700 text-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  L
                </button>
                <button
                  onClick={() => onSetResult(b.id, b.result === "push" ? "pending" : "push")}
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                    b.result === "push"
                      ? "border-amber-500 bg-amber-600/20 text-amber-300"
                      : "border-neutral-700 text-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  P
                </button>
                </>
                )}
                {canPublish && (
                  <button
                    onClick={() => onPublish(b.id)}
                    title="Show this pick on your public profile now instead of at event start. This can't be undone - shared picks stay shared."
                    className="rounded border border-sky-500/50 px-1.5 py-0.5 text-[11px] text-sky-300 hover:bg-neutral-900"
                  >
                    make public
                  </button>
                )}
                {verified && !started && b.published_at && (
                  <span
                    title="Visible on your public profile before the event"
                    className="text-[10px] uppercase tracking-wide text-sky-300 border border-sky-500/40 rounded px-1.5 py-0.5"
                  >
                    public
                  </span>
                )}
                {verified && !b.delete_requested_at && (
                  <button
                    onClick={() => {
                      setRemovalFor(removalFor === b.id ? null : b.id);
                      setRemovalReason("");
                    }}
                    title="Ask an admin to remove this bet - you'll be asked why"
                    className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-500 hover:text-red-400 hover:bg-neutral-900"
                  >
                    request removal
                  </button>
                )}
                {verified && b.delete_requested_at && (
                  <button
                    onClick={() => onRequestDelete(b.id, false)}
                    title="Removal requested - click to cancel the request"
                    className="rounded border border-amber-700 px-1.5 py-0.5 text-[11px] text-amber-400 hover:bg-neutral-900"
                  >
                    requested · cancel
                  </button>
                )}
                {removalFor === b.id && (
                  <div className="mt-1 flex w-full gap-2">
                    <input
                      value={removalReason}
                      onChange={(e) => setRemovalReason(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") sendRemoval(b.id);
                        if (e.key === "Escape") setRemovalFor(null);
                      }}
                      autoFocus
                      maxLength={160}
                      placeholder="Why? (e.g. wrong fighter, fat-fingered the stake)"
                      className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs outline-none focus:border-red-500"
                    />
                    <button
                      onClick={() => sendRemoval(b.id)}
                      disabled={!removalReason.trim()}
                      className="rounded-md border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Send
                    </button>
                    <button
                      onClick={() => setRemovalFor(null)}
                      className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {canDelete && (
                  <button
                    onClick={() => onDelete(b.id)}
                    title="Delete bet"
                    className="shrink-0 rounded-md p-1.5 text-neutral-500 hover:text-red-400 hover:bg-neutral-800"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BankrollCurve({ values }: { values: number[] }) {
  const pts = [0, ...values];
  const min = Math.min(0, ...pts);
  const max = Math.max(0, ...pts);
  const span = max - min || 1;
  const W = 100;
  const H = 32;
  const x = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * W : 0);
  const y = (v: number) => H - ((v - min) / span) * H;
  const d = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
    .join(" ");
  const color = pts[pts.length - 1] >= 0 ? "#34d399" : "#f87171";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-24">
      <line
        x1="0"
        y1={y(0)}
        x2={W}
        y2={y(0)}
        stroke="#404040"
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
