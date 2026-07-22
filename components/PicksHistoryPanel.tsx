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

type MarketFilter = "all" | "ml" | "prop";
type VerifyFilter = "all" | "verified" | "unverified";

// Market bucket: moneyline vs. everything else structured (totals, method,
// round, method_round, and every other verified prop market key). Unverified
// ("other") bets have no structured bet_type to bucket by - their market
// lives inside the free-typed selection text - so they only ever show under
// "All"; the separate Verified/Unverified row is the correct way to isolate
// them instead.
function marketMatch(b: { bet_type: string | null }, f: MarketFilter): boolean {
  if (f === "all") return true;
  if (b.bet_type === "other") return false;
  if (f === "ml") return b.bet_type === "moneyline";
  return b.bet_type !== "moneyline";
}

function verifyMatch(b: { bet_type: string | null }, f: VerifyFilter): boolean {
  if (f === "all") return true;
  if (f === "verified") return b.bet_type !== "other";
  return b.bet_type === "other";
}

// One block per event, each block's own picks newest-logged-first. A bet
// with no event_context/event_date (a Manual entry left blank) gets its own
// "No event" block rather than silently merging into someone else's.
type EventGroup = { key: string; label: string; date: string | null; bets: BetRow[] };

function groupByEvent(list: BetRow[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const b of list) {
    const label = b.event_context ?? "No event";
    const date = b.event_date ?? null;
    const key = `${label}|||${date ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, label, date, bets: [] };
      groups.set(key, g);
    }
    g.bets.push(b);
  }
  // events newest-first; a group with no date falls to the back, tie-broken
  // by whichever pick in it was logged most recently
  const newestPlaced = (g: EventGroup) =>
    g.bets.reduce((max, b) => (b.placed_at > max ? b.placed_at : max), "");
  return Array.from(groups.values()).sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return b.date.localeCompare(a.date);
    }
    return newestPlaced(b).localeCompare(newestPlaced(a));
  });
}

// Every settled or live pick, searchable - the full record behind the
// headline stats above it. Starts collapsed; lives at the bottom of Bets.
export function PicksHistoryPanel({ bets }: { bets: BetRow[] }) {
  const [pickOpen, setPickOpen] = useState(true);
  const [pickSearch, setPickSearch] = useState("");
  const [histFilter, setHistFilter] = useState<MarketFilter>("all");
  const [verifyFilter, setVerifyFilter] = useState<VerifyFilter>("all");
  const [nowTs] = useState(() => Date.now());

  // your settled/in-progress picks, newest-logged-first (upcoming excluded)
  const pickHistory = bets
    .filter((b) => !(b.event_start && new Date(b.event_start).getTime() > nowTs))
    .sort((a, b) => (b.placed_at ?? "").localeCompare(a.placed_at ?? ""));

  const filtered = pickHistory.filter(
    (b) => marketMatch(b, histFilter) && verifyMatch(b, verifyFilter) && searchMatch(b, pickSearch)
  );
  const shown = filtered.slice(0, 100);
  const groups = groupByEvent(shown);

  return (
    <div
      onClick={() => setPickOpen((v) => !v)}
      className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 cursor-pointer"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">
          Picks history
        </span>
        <Chevron open={pickOpen} />
      </div>
      {pickOpen && (
      <div className="space-y-2 mt-3 cursor-auto" onClick={(e) => e.stopPropagation()}>
        <input
          value={pickSearch}
          onChange={(e) => setPickSearch(e.target.value)}
          placeholder="Search picks…"
          className="w-full rounded-md bg-neutral-800/60 border border-neutral-800 px-3 py-1.5 text-xs text-neutral-200 outline-none focus:border-emerald-500 placeholder:text-neutral-600"
        />
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["all", "All"],
              ["verified", "Verified"],
              ["unverified", "Unverified"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setVerifyFilter(key)}
              className={sideBtn(verifyFilter === key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["all", "All"],
              ["ml", "MLs"],
              ["prop", "Props"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} onClick={() => setHistFilter(key)} className={sideBtn(histFilter === key)}>
              {label}
            </button>
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="text-xs text-neutral-600">
            {pickHistory.length === 0
              ? "No settled picks yet - they land here after each event."
              : "No picks match this filter."}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="space-y-1.5">
            <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide pt-1">
              {g.label}
              {g.date ? ` · ${fmtDate(g.date)}` : ""}
            </p>
            {g.bets.map((b) => (
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
                    {b.bet_type === "other" ? "unverified · " : ""}
                    {fmtDate(b.event_date ?? b.placed_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
        {filtered.length > 100 && (
          <p className="text-[11px] text-neutral-600">Showing the latest 100.</p>
        )}
      </div>
      )}
    </div>
  );
}
