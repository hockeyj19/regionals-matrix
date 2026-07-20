"use client";

import { useState } from "react";
import { betProfit, fmtUnits, sideBtn } from "@/lib/format";

// The betting summary from the Bets page - record, ROI, CLV, profit, stake,
// beat-close, and a bankroll curve - as a self-contained block so the Profile
// can show the same thing. Takes whatever bets it's handed and filters them by
// the verified/all toggle itself.
type StatBet = {
  result: string;
  stake: number;
  odds: number;
  clv: number | null;
  bet_type: string | null;
  event_date: string | null;
  placed_at: string;
};

function Card({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
      <p className="text-[11px] text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export function BetStats({ bets }: { bets: StatBet[] }) {
  const [scope, setScope] = useState<"verified" | "all">("verified");

  // "verified" = structured bets tied to a fight (auto-graded); "all" adds manual ones
  const scoped = scope === "verified" ? bets.filter((b) => b.bet_type !== "other") : bets;
  const settled = scoped.filter((b) => b.result !== "pending");
  const wins = settled.filter((b) => b.result === "win").length;
  const losses = settled.filter((b) => b.result === "loss").length;
  const pushes = settled.filter((b) => b.result === "push").length;
  const staked = settled.reduce((s, b) => s + Number(b.stake), 0);
  const profit = settled.reduce((s, b) => s + betProfit(b), 0);
  const roi = staked > 0 ? (profit / staked) * 100 : 0;

  // bankroll curve: cumulative units across settled bets, in fight order
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
    <div className="space-y-4">
      <div className="flex justify-end gap-1">
        <button onClick={() => setScope("verified")} className={sideBtn(scope === "verified")}>
          Verified
        </button>
        <button onClick={() => setScope("all")} className={sideBtn(scope === "all")}>
          All bets
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card label="Record" value={`${wins}-${losses}-${pushes}`} />
        <Card label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} tone={profitTone} />
        {avgClv !== null && (
          <Card
            label="Avg CLV"
            value={`${avgClv >= 0 ? "+" : ""}${avgClv.toFixed(2)}`}
            tone={avgClv >= 0 ? "text-emerald-400" : "text-red-400"}
          />
        )}
        <Card label="Profit" value={fmtUnits(profit)} tone={profitTone} />
        <Card
          label="Avg stake"
          value={`${settled.length ? Math.round((staked / settled.length) * 100) / 100 : 0}u`}
        />
        {beatRate !== null && <Card label="Beat close" value={`${beatRate.toFixed(0)}%`} />}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1">
          Bankroll
        </p>
        <BankrollCurve values={cumulative} />
      </div>
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
