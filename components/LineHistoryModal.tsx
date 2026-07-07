"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { fmtAmerican, freshness } from "@/lib/board";

/**
 * Line-movement chart for one fighter's BetOnline moneyline, drawn from the
 * bots' ledger. The monitors write change-only, so every stored point is a
 * real inflection - a step chart between them is exact, not interpolated.
 * History reaches back to when the ledger came online and deepens daily.
 */

type Pt = { t: number; v: number };

function impliedProb(o: number): number {
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function LineHistoryModal({
  fightKey,
  side,
  fighterName,
  onClose,
}: {
  fightKey: string;
  side: 1 | 2;
  fighterName: string;
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
        const raw: Pt[] = (data ?? [])
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
            <p className="text-[11px] text-neutral-500">
              BetOnline moneyline · line movement
            </p>
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
          <p className="text-sm text-neutral-500">
            No recorded price for this fighter yet.
          </p>
        )}

        {pts !== null && pts.length > 0 && <Chart pts={pts} />}
      </div>
    </div>
  );
}

function Chart({ pts }: { pts: Pt[] }) {
  const open = pts[0].v;
  const cur = pts[pts.length - 1].v;
  const vals = pts.map((p) => p.v);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const probShift = impliedProb(cur) - impliedProb(open);

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
  // extend the current level to the right edge
  d += ` H ${(W - padR).toFixed(1)}`;

  const line = cur < open ? "#34d399" : cur > open ? "#f87171" : "#a3a3a3";
  const single = pts.length < 2;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="Open" value={fmtAmerican(open)} />
        <Stat
          label="Current"
          value={fmtAmerican(cur)}
          tone={cur < open ? "text-emerald-400" : cur > open ? "text-red-400" : ""}
        />
        <Stat label="Range" value={`${fmtAmerican(lo)} / ${fmtAmerican(hi)}`} small />
        <Stat
          label="Prob shift"
          value={`${probShift >= 0 ? "+" : ""}${Math.round(probShift * 100)} pts`}
          tone={probShift > 0 ? "text-emerald-400" : probShift < 0 ? "text-red-400" : ""}
        />
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* y guides: open and current levels */}
        <line
          x1={padL}
          y1={y(open)}
          x2={W - padR}
          y2={y(open)}
          stroke="#404040"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
        <text x={4} y={y(open) + 3} fill="#737373" fontSize="9">
          {fmtAmerican(open)}
        </text>
        {cur !== open && (
          <>
            <text x={4} y={y(cur) + 3} fill="#a3a3a3" fontSize="9">
              {fmtAmerican(cur)}
            </text>
          </>
        )}
        {/* the movement line */}
        <path d={d} fill="none" stroke={line} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {/* endpoint dot */}
        <circle cx={W - padR} cy={y(cur)} r="2.5" fill={line} />
        {/* x labels */}
        <text x={padL} y={H - 6} fill="#737373" fontSize="9">
          {fmtTime(t0)}
        </text>
        <text x={W - padR} y={H - 6} fill="#737373" fontSize="9" textAnchor="end">
          {fmtTime(t1)}
        </text>
      </svg>

      <p className="text-[11px] text-neutral-600">
        {single
          ? "The line has held since it opened — no movement recorded yet."
          : `${pts.length} recorded moves. Last change ${freshness(new Date(t1).toISOString())}.`}{" "}
        History runs from when the monitors came online and grows daily.
      </p>
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
