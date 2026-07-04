"use client";

import { useState } from "react";
import type { BetRow, EventRow, FightRow, NewBet, ReviewRow } from "@/lib/types";
import { betProfit, fmtDate, fmtOdds, fmtUnits, parseBetInputs, sideBtn } from "@/lib/format";
import { TrashIcon } from "@/components/icons";
import { QuickBet } from "@/components/QuickBet";
import { ReviewArchive } from "@/components/ReviewArchive";
import { BETS_README, InfoButton, ReadMePanel } from "@/components/ReadMe";

export function BetTracker({
  bets,
  reviews,
  events,
  fights,
  onAdd,
  onSetResult,
  onDelete,
}: {
  bets: BetRow[];
  reviews: ReviewRow[];
  events: EventRow[];
  fights: FightRow[];
  onAdd: (bet: NewBet) => void;
  onSetResult: (id: string, result: string) => void;
  onDelete: (id: string) => void;
}) {
  const [selection, setSelection] = useState("");
  const [context, setContext] = useState("");
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"verified" | "all">("verified");
  const [selEventId, setSelEventId] = useState("");
  const [selFightId, setSelFightId] = useState("");
  const [showInfo, setShowInfo] = useState(false);

  const selEvent = events.find((ev) => ev.id === selEventId) ?? null;
  const selFight = fights.find((f) => f.id === selFightId) ?? null;

  // "verified" = structured bets tied to a fight (auto-graded); "all" adds manual ones
  const scoped = scope === "verified" ? bets.filter((b) => b.bet_type !== "other") : bets;
  const settled = scoped.filter((b) => b.result !== "pending");
  const wins = settled.filter((b) => b.result === "win").length;
  const losses = settled.filter((b) => b.result === "loss").length;
  const pushes = settled.filter((b) => b.result === "push").length;
  const staked = settled.reduce((s, b) => s + Number(b.stake), 0);
  const profit = settled.reduce((s, b) => s + betProfit(b), 0);
  const roi = staked > 0 ? (profit / staked) * 100 : 0;
  const pendingCount = scoped.length - settled.length;

  // ROI over time: month buckets by event date (falls back to when placed)
  const months: Record<string, { staked: number; profit: number; n: number }> = {};
  settled.forEach((b) => {
    const key = (b.event_date ?? b.placed_at).slice(0, 7);
    if (!months[key]) months[key] = { staked: 0, profit: 0, n: 0 };
    months[key].staked += Number(b.stake);
    months[key].profit += betProfit(b);
    months[key].n += 1;
  });
  const monthKeys = Object.keys(months).sort();

  // bankroll curve: cumulative units across settled bets in fight order
  const chron = [...settled].sort((a, b) =>
    (a.event_date ?? a.placed_at).localeCompare(b.event_date ?? b.placed_at)
  );
  let running = 0;
  const cumulative = chron.map((b) => (running += betProfit(b)));

  // results by organization (from the event context on each bet)
  const orgs: Record<
    string,
    { n: number; w: number; l: number; p: number; staked: number; profit: number }
  > = {};
  settled.forEach((b) => {
    const key = (b.event_context ?? "").split(" — ")[0].trim() || "Other";
    if (!orgs[key]) orgs[key] = { n: 0, w: 0, l: 0, p: 0, staked: 0, profit: 0 };
    const o = orgs[key];
    o.n += 1;
    if (b.result === "win") o.w += 1;
    else if (b.result === "loss") o.l += 1;
    else o.p += 1;
    o.staked += Number(b.stake);
    o.profit += betProfit(b);
  });
  const orgKeys = Object.keys(orgs).sort((a, b) => orgs[b].n - orgs[a].n);

  function submit() {
    if (!selection.trim()) {
      setError("Enter what the bet is on.");
      return;
    }
    const parsed = parseBetInputs(odds, stake);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    onAdd({
      selection: selection.trim(),
      event_context: context.trim() || null,
      event_date: null,
      event_start: null,
      fighter_id: null,
      book: null,
      bet_type: "other",
      prop_method: null,
      prop_round: null,
      ou_line: null,
      event_source_url: null,
      odds: parsed.odds,
      stake: parsed.stake,
    });
    setSelection("");
    setContext("");
    setOdds("");
    setStake("");
    setError("");
  }

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
      </div>
      {pendingCount > 0 && (
        <p className="text-xs text-neutral-500">
          {pendingCount} pending bet{pendingCount === 1 ? "" : "s"} not counted above.
        </p>
      )}

      {settled.length >= 2 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
              Bankroll
            </p>
            <span className={`text-xs ${profitTone}`}>{fmtUnits(profit)}</span>
          </div>
          <BankrollCurve values={cumulative} />
        </div>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
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
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
          Unverified bet (you grade it)
        </p>
        <input
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          placeholder="Selection (e.g. McGregor ML, over 2.5 rounds)"
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
        />
        <div className="flex gap-2">
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Event (optional)"
            className="flex-1 min-w-0 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <input
            value={odds}
            onChange={(e) => setOdds(e.target.value)}
            placeholder="Odds (-150)"
            className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <input
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            placeholder="Units"
            className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={submit}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-sm font-medium"
          >
            Add
          </button>
        </div>
        {error && <p className="text-xs text-amber-400">{error}</p>}
      </div>

      <ReviewArchive rows={reviews} />

      {monthKeys.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
            ROI by month
          </p>
          <div className="space-y-1">
            {monthKeys.map((m) => {
              const v = months[m];
              const mroi = v.staked > 0 ? (v.profit / v.staked) * 100 : 0;
              return (
                <div key={m} className="flex items-center justify-between text-xs gap-2">
                  <span className="text-neutral-400 w-16 shrink-0">{m}</span>
                  <span className="text-neutral-600 flex-1 text-center">
                    {v.n} bet{v.n === 1 ? "" : "s"} · {Math.round(v.staked * 100) / 100}u
                  </span>
                  <span className={v.profit >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {fmtUnits(v.profit)} ({mroi >= 0 ? "+" : ""}{mroi.toFixed(1)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {orgKeys.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
            Results by org
          </p>
          <div className="space-y-1">
            {orgKeys.map((k) => {
              const o = orgs[k];
              const oroi = o.staked > 0 ? (o.profit / o.staked) * 100 : 0;
              return (
                <div key={k} className="flex items-center justify-between text-xs gap-2">
                  <span className="text-neutral-400 truncate">{k}</span>
                  <span className="text-neutral-600 shrink-0">
                    {o.w}-{o.l}-{o.p}
                  </span>
                  <span className={`shrink-0 ${o.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtUnits(o.profit)} ({oroi >= 0 ? "+" : ""}{oroi.toFixed(1)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bets.length === 0 && (
        <p className="text-neutral-500">
          No bets logged yet. Add one above, or use the + Log bet button on any fight card.
        </p>
      )}

      {bets.map((b) => {
        const p = betProfit(b);
        return (
          <div key={b.id} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {b.selection}{" "}
                  <span className="text-neutral-500">
                    {fmtOdds(b.odds)} · {Number(b.stake)}u
                  </span>
                  {b.bet_type !== "other" && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-500">
                      verified
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-neutral-600 truncate">
                  {b.book ? `${b.book} · ` : ""}
                  {b.event_context ? `${b.event_context} · ` : ""}
                  {fmtDate(b.event_date ?? b.placed_at)}
                </p>
                {b.grade_note && (
                  <p className="text-[11px] text-neutral-500 italic truncate">{b.grade_note}</p>
                )}
                {b.bet_type !== "other" &&
                  (!b.event_start || b.placed_at >= b.event_start) && (
                    <p className="text-[11px] text-amber-500/80">
                      Not leaderboard-eligible (no pre-start timestamp)
                    </p>
                  )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {b.result !== "pending" && (
                  <span className={`text-xs mr-1 ${p >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtUnits(p)}
                  </span>
                )}
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
                <button
                  onClick={() => onDelete(b.id)}
                  title="Delete bet"
                  className="shrink-0 rounded-md p-1.5 text-neutral-500 hover:text-red-400 hover:bg-neutral-800"
                >
                  <TrashIcon />
                </button>
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
