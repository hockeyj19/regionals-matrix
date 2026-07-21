"use client";

import { useState } from "react";
import type { NewBet } from "@/lib/types";
import { fmtOdds } from "@/lib/format";

/**
 * The guts of a verified-bet badge: a locked price, a units field, and a
 * submit button that inserts through the caller's own onAdd - so wherever
 * this renders (a prop's price badge, the ML line-history modal's bet tab)
 * the resulting bet goes through the exact same server-side verification,
 * embargo, and stake-cap checks as everywhere else in the app. This
 * component only owns the form; the caller supplies what "confirm" means.
 */
export function VerifiedBetForm({
  label,
  contextLine,
  odds,
  onAdd,
  buildBet,
  onClose,
}: {
  label: string;
  contextLine: string;
  odds: number;
  onAdd: (bet: NewBet) => Promise<string | null>;
  buildBet: (stake: number) => NewBet;
  onClose: () => void;
}) {
  const [stake, setStake] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const s = parseFloat(stake);
    if (isNaN(s) || s <= 0) {
      setError("Enter units, e.g. 0.5");
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onAdd(buildBet(s));
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    onClose();
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400 mb-1">
          BetOnline Verified
        </p>
        <p className="text-sm font-semibold text-neutral-100">{label}</p>
        <p className="text-xs text-neutral-500">
          {contextLine} <span className="text-emerald-400 font-medium">{fmtOdds(odds)}</span>
        </p>
      </div>
      <div>
        <label className="text-[11px] uppercase tracking-wide text-neutral-500">Units</label>
        <input
          autoFocus
          type="number"
          step="0.1"
          min="0"
          inputMode="decimal"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="mt-1 w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm outline-none focus:border-emerald-500 [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 px-3 py-2 text-sm font-medium"
        >
          {busy ? "Placing…" : "Place bet"}
        </button>
      </div>
    </div>
  );
}
