"use client";

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { fmtOdds, parseOddsInput } from "@/lib/format";

/**
 * Line-movement chart for one fighter's BetOnline moneyline, drawn from the
 * bots' ledger. The monitors write change-only, so every stored point is a real
 * inflection - a step chart between them is exact, not interpolated. Scrub the
 * line with a finger or mouse to read the exact price and time at any point.
 */

type Pt = { t: number; v: number };

function impliedProb(o: number): number {
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LineHistoryModal({
  fightKey,
  side,
  fighterName,
  notePrice,
  onClose,
}: {
  fightKey: string;
  side: 1 | 2;
  fighterName: string;
  notePrice: string | null;
  onClose: () => void;
}) {
  const [pts, setPts] = useState<Pt[] | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("bol_line_history")
      .select("*")
      .eq("fight_key", fightKey)
      .order("captured_at", { ascending: true })
      .then(({ data }) => {
        if (!alive) return;
        const col = side === 1 ? "fighter1_odds" : "fighter2_odds";
        const rows = data ?? [];
        const raw: Pt[] = rows
          .map((r) => ({
            t: new Date((r as { captured_at: string }).captured_at).getTime(),
            v: (r as Record<string, number | null>)[col],
          }))
          .filter((p): p is Pt => typeof p.v === "number");
        setPts(raw);
      });
    return () => {
      alive = false;
    };
  }, [fightKey, side]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">{fighterName}</h3>
            <p className="text-[11px] text-neutral-500">BetOnline</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-900"
          >
            close
          </button>
        </div>

        {pts === null && <p className="text-sm text-neutral-500">Reading the ledger…</p>}

        {pts !== null && pts.length === 0 && (
          <p className="text-sm text-neutral-500">No recorded price for this fighter yet.</p>
        )}

        {pts !== null && pts.length > 0 && <Chart pts={pts} notePrice={notePrice} />}
      </div>
    </div>
  );
}

function Chart({ pts, notePrice }: { pts: Pt[]; notePrice: string | null }) {
  const [hover, setHover] = useState<{ x: number; t: number; v: number } | null>(null);

  const open = pts[0].v;
  const cur = pts[pts.length - 1].v;
  const vals = pts.map((p) => p.v);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const impliedCur = impliedProb(cur);
  // "Notes": how the current price compares to the user's own tape-note price,
  // in implied-probability points. Positive = the current price is better value
  // than what they noted (pays more); negative = worse. Blank without a note.
  const noteOdds = parseOddsInput(notePrice);
  const noteDiff = noteOdds === null ? null : (impliedProb(noteOdds) - impliedCur) * 100;

  // layout
  const W = 460;
  const H = 180;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const tSpan = t1 - t0 || 1;
  const vMin = lo;
  const vMax = hi;
  const vSpan = vMax - vMin || 1;
  const x = (t: number) => padL + ((t - t0) / tSpan) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - vMin) / vSpan) * (H - padT - padB);

  // step-after path (value holds until the next change, then jumps)
  let d = `M ${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` H ${x(pts[i].t).toFixed(1)} V ${y(pts[i].v).toFixed(1)}`;
  }
  d += ` H ${(W - padR).toFixed(1)}`;

  const GREEN = "#34d399";

  // horizontal reference lines at evenly-spaced levels across the range
  const gridN = vSpan < 2 ? 1 : 4;
  const grids = Array.from({ length: gridN }, (_, i) =>
    gridN === 1 ? vMin : vMin + (vSpan * i) / (gridN - 1)
  );

  function scrub(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const clamped = Math.max(padL, Math.min(W - padR, px));
    const t = t0 + ((clamped - padL) / (W - padL - padR)) * tSpan;
    // value + time of the change active at this position (step-held)
    let v = pts[0].v;
    let tp = pts[0].t;
    for (const p of pts) {
      if (p.t <= t) {
        v = p.v;
        tp = p.t;
      } else break;
    }
    setHover({ x: clamped, t: tp, v });
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="Open" value={fmtOdds(open)} />
        <Stat label="Current" value={fmtOdds(cur)} tone="text-emerald-400" />
        <Stat label="Implied" value={`${(impliedCur * 100).toFixed(1)}%`} small />
        <Stat
          label="Notes"
          value={noteDiff === null ? "—" : `${noteDiff > 0 ? "+" : ""}${noteDiff.toFixed(1)}%`}
          tone={
            noteDiff === null || Math.abs(noteDiff) < 0.05
              ? ""
              : noteDiff > 0
              ? "text-emerald-400"
              : "text-red-400"
          }
          small
        />
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none"
          onPointerDown={scrub}
          onPointerMove={scrub}
          onPointerUp={() => setHover(null)}
          onPointerLeave={() => setHover(null)}
        >
          {/* horizontal reference lines */}
          {grids.map((gv, i) => (
            <g key={i}>
              <line
                x1={padL}
                y1={y(gv)}
                x2={W - padR}
                y2={y(gv)}
                stroke="#262626"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
              <text x={4} y={y(gv) + 3} fill="#737373" fontSize="9">
                {fmtOdds(Math.round(gv / 5) * 5)}
              </text>
            </g>
          ))}
          {/* the movement line - always green */}
          <path d={d} fill="none" stroke={GREEN} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {/* endpoint dot */}
          <circle cx={W - padR} cy={y(cur)} r="2.5" fill={GREEN} />
          {/* scrub guide */}
          {hover && (
            <>
              <line
                x1={hover.x}
                y1={padT}
                x2={hover.x}
                y2={H - padB}
                stroke="#525252"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={hover.x} cy={y(hover.v)} r="3" fill="#ffffff" stroke={GREEN} strokeWidth="1.5" />
            </>
          )}
          {/* x labels */}
          <text x={padL} y={H - 6} fill="#737373" fontSize="9">
            {fmtTime(t0)}
          </text>
          <text x={W - padR} y={H - 6} fill="#737373" fontSize="9" textAnchor="end">
            {fmtTime(t1)}
          </text>
        </svg>

        {hover && (
          <div
            className="absolute top-0 -translate-x-1/2 pointer-events-none"
            style={{ left: `${(hover.x / W) * 100}%` }}
          >
            <div className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[11px] whitespace-nowrap shadow">
              <span className="font-semibold text-emerald-300">{fmtOdds(hover.v)}</span>
              <span className="text-neutral-400"> · {fmtDateTime(hover.t)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "",
  small = false,
}: {
  label: string;
  value: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
      <p className="text-[10px] text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className={`font-semibold ${small ? "text-xs" : "text-sm"} ${tone}`}>{value}</p>
    </div>
  );
}
