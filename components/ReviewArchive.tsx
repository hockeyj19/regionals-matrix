"use client";

import { useState } from "react";
import type { MatrixData, ReviewRow } from "@/lib/types";
import { MATRIX_MARKETS, displayTypedOdds } from "@/lib/format";

export function ReviewArchive({ rows }: { rows: ReviewRow[] }) {
  const [q, setQ] = useState("");
  const [openMx, setOpenMx] = useState<Record<string, boolean>>({});

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (!needle) return true;
    const hay = `${r.fighter1_name ?? ""} ${r.fighter2_name ?? ""} ${r.event_name ?? ""} ${
      r.org ?? ""
    }`.toLowerCase();
    return hay.includes(needle);
  });

  // group fights by event, newest first (rows arrive sorted by event_date desc)
  const groups: { key: string; name: string; date: string; fights: ReviewRow[] }[] = [];
  const idx: Record<string, number> = {};
  filtered.forEach((r) => {
    const key = `${r.event_name}|${r.event_date}`;
    if (idx[key] === undefined) {
      idx[key] = groups.length;
      groups.push({ key, name: r.event_name ?? "", date: r.event_date ?? "", fights: [] });
    }
    groups[idx[key]].fights.push(r);
  });

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-3">
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
        Review archive
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search fighters, events"
        className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
      />
      {rows.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nothing archived yet. Fights you priced or filled a matrix for are stored here with
          their results after each scrape.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.key} className="space-y-2">
          <p className="text-xs text-neutral-500">
            <span className="text-neutral-400 font-semibold">{g.name}</span>
            {g.date ? ` · ${g.date}` : ""}
          </p>
          {g.fights.map((r) => {
            const decided = r.winner_name || r.f1_result;
            const tail = [
              r.method,
              r.result_round ? `R${r.result_round}` : null,
              r.result_time,
            ]
              .filter(Boolean)
              .join(" ");
            const hasMx =
              !!r.matrix &&
              Object.values(r.matrix).some((m) =>
                Object.values(m).some((v) => (v ?? "").trim() !== "")
              );
            return (
              <div
                key={r.id}
                className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    <span className={r.f1_result === "win" ? "text-emerald-400 font-medium" : ""}>
                      {r.fighter1_name}
                    </span>
                    {r.price1 ? <span className="text-neutral-500"> {displayTypedOdds(r.price1)}</span> : null}
                    <span className="text-neutral-600"> vs </span>
                    <span className={r.f1_result === "loss" ? "text-emerald-400 font-medium" : ""}>
                      {r.fighter2_name}
                    </span>
                    {r.price2 ? <span className="text-neutral-500"> {displayTypedOdds(r.price2)}</span> : null}
                  </span>
                  {hasMx && (
                    <button
                      onClick={() => setOpenMx((p) => ({ ...p, [r.id]: !p[r.id] }))}
                      className="text-[11px] text-neutral-500 hover:text-neutral-300 shrink-0"
                    >
                      {openMx[r.id] ? "Hide matrix" : "Matrix"}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-neutral-500">
                  {decided
                    ? r.winner_name
                      ? `${r.winner_name} won${tail ? ` · ${tail}` : ""}`
                      : `${r.f1_result === "draw" ? "Draw" : "No contest"}${tail ? ` · ${tail}` : ""}`
                    : "Result not captured yet"}
                  {r.weight_class ? ` · ${r.weight_class}` : ""}
                </p>
                {openMx[r.id] && r.matrix && (
                  <ReviewMatrix
                    f1={r.fighter1_name ?? ""}
                    f2={r.fighter2_name ?? ""}
                    data={r.matrix}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ReviewMatrix({ f1, f2, data }: { f1: string; f2: string; data: MatrixData }) {
  const cell = "text-xs text-neutral-300 text-center px-1 py-0.5";
  return (
    <div className="rounded-md border border-neutral-800 overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[4rem_1fr_11rem_1fr_4rem] gap-1 items-center px-2 py-1 border-b border-neutral-800">
          <span className="text-[10px] text-neutral-500 uppercase text-center">Odds+</span>
          <span className="text-[11px] font-semibold text-neutral-300 text-center truncate">{f1}</span>
          <span />
          <span className="text-[11px] font-semibold text-neutral-300 text-center truncate">{f2}</span>
          <span className="text-[10px] text-neutral-500 uppercase text-center">Odds+</span>
        </div>
        <div className="divide-y divide-neutral-800/70">
          {MATRIX_MARKETS.map(([key, label]) => {
            const row = data[key] ?? {};
            const any = ["f1o", "f1v", "f2v", "f2o"].some((k) => (row[k] ?? "").trim() !== "");
            if (!any) return null;
            return (
              <div
                key={key}
                className="grid grid-cols-[4rem_1fr_11rem_1fr_4rem] gap-1 items-center px-2 py-0.5"
              >
                <span className={cell}>{row.f1o ?? ""}</span>
                <span className={cell}>{row.f1v ?? ""}</span>
                <span className="text-[11px] font-semibold text-amber-400/90 text-center px-1">
                  {label}
                </span>
                <span className={cell}>{row.f2v ?? ""}</span>
                <span className={cell}>{row.f2o ?? ""}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
