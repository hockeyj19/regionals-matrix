"use client";

import { useState } from "react";
import type { BetRow } from "@/lib/types";
import { betProfit, bookLabel, fmtDate, fmtOdds, fmtUnits, sideBtn } from "@/lib/format";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      className={`text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function searchMatch(b: { selection: string; event_context: string | null }, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (b.selection ?? "").toLowerCase().includes(s) ||
    (b.event_context ?? "").toLowerCase().includes(s);
}

function typeMatch(b: { bet_type: string | null }, f: string): boolean {
  if (f === "all") return true;
  if (f === "ml") return b.bet_type === "moneyline";
  if (f === "totals") return b.bet_type === "over" || b.bet_type === "under";
  return b.bet_type === f;
}

// Every settled or live verified pick, searchable - the full record behind
// the headline stats above it. Starts collapsed; lives at the bottom of Bets.
export function PicksHistoryPanel({ bets }: { bets: BetRow[] }) {
  const [pickOpen, setPickOpen] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [histFilter, setHistFilter] = useState<
    "all" | "ml" | "totals" | "method" | "round" | "method_round"
  >("all");
  const [nowTs] = useState(() => Date.now());

  // your settled/in-progress verified picks, newest first (upcoming excluded)
  const pickHistory = bets
    .filter(
      (b) =>
        b.bet_type !== "other" &&
        !(b.event_start && new Date(b.event_start).getTime() > nowTs)
    )
    .sort((a, b) => (b.placed_at ?? "").localeCompare(a.placed_at ?? ""));

  return (
    <div
      onClick={() => setPickOpen((v) => !v)}
      className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 cursor-pointer"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">
            Picks history
          </span>
          <Chevron open={pickOpen} />
        </div>
        {pickOpen && (
          <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
            {(
              [
                ["all", "All"],
                ["ml", "ML"],
                ["totals", "Totals"],
                ["method", "Methods"],
                ["round", "Rounds"],
                ["method_round", "Methods/Rounds"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setHistFilter(key)}
                className={sideBtn(histFilter === key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {pickOpen && (
      <div className="space-y-2 mt-3 cursor-auto" onClick={(e) => e.stopPropagation()}>
        <input
          value={pickSearch}
          onChange={(e) => setPickSearch(e.target.value)}
          placeholder="Search picks…"
          className="w-full rounded-md bg-neutral-800/60 border border-neutral-800 px-3 py-1.5 text-xs text-neutral-200 outline-none focus:border-emerald-500 placeholder:text-neutral-600"
        />
        {pickHistory.filter((b) => typeMatch(b, histFilter) && searchMatch(b, pickSearch)).length === 0 && (
          <p className="text-xs text-neutral-600">
            {pickHistory.length === 0
              ? "No settled picks yet - they land here after each event."
              : "No picks in this market."}
          </p>
        )}
        {pickHistory
          .filter((b) => typeMatch(b, histFilter) && searchMatch(b, pickSearch))
          .slice(0, 100)
          .map((b) => (
            <div key={b.id} className="border-b border-neutral-900 pb-1 last:border-0">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{b.selection}</span>
                <span
                  className={`shrink-0 ${
                    b.result === "win"
                      ? "text-emerald-400"
                      : b.result === "loss"
                      ? "text-red-400"
                      : b.result === "push"
                      ? "text-amber-400"
                      : "text-neutral-500"
                  }`}
                >
                  {b.result === "pending" ? "live" : b.result}
                </span>
              </div>
              <div className="flex items-baseline gap-1 text-[11px] min-w-0">
                <span className="shrink-0 text-neutral-500">
                  {fmtOdds(b.odds)} · {Number(b.stake)}u
                  {b.clv !== null && (
                    <>
                      {" · CLV "}
                      <span className={Number(b.clv) >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {Number(b.clv) >= 0 ? "+" : ""}
                        {Number(b.clv).toFixed(1)}
                      </span>
                    </>
                  )}
                  {b.result !== "pending" && (
                    <>
                      {" · "}
                      <span className={betProfit(b) >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {fmtUnits(betProfit(b))}
                      </span>
                    </>
                  )}
                </span>
                <span className="truncate text-neutral-600">
                  {b.book ? `${bookLabel(b.book)} · ` : ""}
                  {b.event_context ? `${b.event_context} · ` : ""}
                  {fmtDate(b.event_date ?? b.placed_at)}
                </span>
              </div>
            </div>
          ))}
        {pickHistory.filter((b) => typeMatch(b, histFilter) && searchMatch(b, pickSearch)).length > 100 && (
          <p className="text-[11px] text-neutral-600">Showing the latest 100.</p>
        )}
      </div>
      )}
    </div>
  );
}
