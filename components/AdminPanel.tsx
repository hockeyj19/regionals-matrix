"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { fmtDate, fmtOdds } from "@/lib/format";

type AdminReport = {
  report_id: string;
  created_at: string;
  status: string;
  reason: string;
  reporter: string | null;
  bet_id: string;
  owner: string | null;
  selection: string;
  odds: number;
  stake: number;
  result: string;
  book: string | null;
  event_context: string | null;
  event_date: string | null;
  placed_at: string;
  event_start: string | null;
  flagged: boolean;
  grade_note: string | null;
};

export function AdminPanel() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("admin_reports")
      .select("*")
      .order("created_at", { ascending: false });
    setReports(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function flagBet(betId: string, flag: boolean) {
    const { error } = await supabase.rpc("admin_flag_bet", { p_bet_id: betId, p_flag: flag });
    setMsg(error ? "Action failed - are you admin?" : "");
    load();
  }

  async function resolve(reportId: string, status: string) {
    const { error } = await supabase.rpc("admin_resolve_report", {
      p_report_id: reportId,
      p_status: status,
    });
    setMsg(error ? "Action failed - are you admin?" : "");
    load();
  }

  const open = reports.filter((r) => r.status === "open");
  const handled = reports.filter((r) => r.status !== "open");

  function card(r: AdminReport) {
    return (
      <div
        key={r.report_id}
        className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-2"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-amber-400">
            {r.reporter ?? "someone"} reported: {r.reason}
          </p>
          <span className="text-[11px] text-neutral-600 shrink-0">{fmtDate(r.created_at)}</span>
        </div>
        <div className="text-sm">
          <span className="text-neutral-400">{r.owner ?? "unknown"}</span>{" "}
          <span className="font-medium">{r.selection}</span>{" "}
          <span className="text-neutral-500">
            {fmtOdds(r.odds)} · {Number(r.stake)}u{r.book ? ` · ${r.book}` : ""}
          </span>{" "}
          <span
            className={
              r.result === "win"
                ? "text-emerald-400"
                : r.result === "loss"
                ? "text-red-400"
                : "text-neutral-500"
            }
          >
            {r.result}
          </span>
          {r.flagged && (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-red-400 border border-red-800 rounded px-1">
              voided
            </span>
          )}
        </div>
        <p className="text-[11px] text-neutral-600">
          {r.event_context ? `${r.event_context} · ` : ""}
          placed {fmtDate(r.placed_at)}
          {r.grade_note ? ` · ${r.grade_note}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => flagBet(r.bet_id, !r.flagged)}
            className={`rounded-md border px-2 py-1 text-xs ${
              r.flagged
                ? "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                : "border-red-700 text-red-400 hover:bg-neutral-900"
            }`}
          >
            {r.flagged ? "Unvoid bet" : "Void bet"}
          </button>
          {r.status === "open" && (
            <>
              <button
                onClick={() => resolve(r.report_id, "resolved")}
                className="rounded-md border border-emerald-700 text-emerald-400 px-2 py-1 text-xs hover:bg-neutral-900"
              >
                Mark resolved
              </button>
              <button
                onClick={() => resolve(r.report_id, "dismissed")}
                className="rounded-md border border-neutral-700 text-neutral-400 px-2 py-1 text-xs hover:bg-neutral-900"
              >
                Dismiss
              </button>
            </>
          )}
          {r.status !== "open" && (
            <span className="text-[11px] text-neutral-600 self-center uppercase tracking-wide">
              {r.status}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <p className="text-xs text-neutral-500">
        Reports from the leaderboard land here. Voiding a bet removes it from every public board
        instantly; unvoid restores it. Handled reports stay below for the record.
      </p>
      {msg && <p className="text-xs text-amber-400">{msg}</p>}
      {loading && <p className="text-neutral-500">Loading reports...</p>}
      {!loading && open.length === 0 && (
        <p className="text-neutral-500">No open reports. The people are behaving.</p>
      )}
      {open.map(card)}
      {handled.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-600 uppercase tracking-wide">Handled</p>
          {handled.map(card)}
        </div>
      )}
    </div>
  );
}
