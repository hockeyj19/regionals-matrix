"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { LeaderboardRow, PublicBet } from "@/lib/types";
import { SHARP_BOOKS, SOFT_BOOKS, bookTier, fmtDate, fmtOdds, fmtUnits, sideBtn } from "@/lib/format";
import { FlagIcon } from "@/components/icons";

const MIN_BETS_TO_RANK = 5;

type Agg = {
  username: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  staked: number;
  profit: number;
};

export function Leaderboard({ user }: { user: User }) {
  const [raw, setRaw] = useState<LeaderboardRow[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [msg, setMsg] = useState("");
  const [tier, setTier] = useState<"sharp" | "soft">("sharp");
  const [ufcOnly, setUfcOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"profit" | "roi">("profit");
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [userBets, setUserBets] = useState<Record<string, PublicBet[]>>({});
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data: lb } = await supabase.from("leaderboard_rows").select("*");
      const { data: me } = await supabase
        .from("profiles")
        .select("username")
        .eq("user_id", user.id);
      if (!alive) return;
      setRaw(lb ?? []);
      setUsername(me && me.length > 0 ? me[0].username : null);
      setLoading(false);
    }
    load();
    return () => {
      alive = false;
    };
  }, [user.id]);

  async function claimUsername() {
    const name = nameInput.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) {
      setMsg("3-20 characters: letters, numbers, underscores.");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: user.id, username: name }, { onConflict: "user_id" });
    if (error) {
      setMsg("That name is taken or invalid - try another.");
    } else {
      setUsername(name);
      setMsg("");
    }
  }

  async function toggleUser(u: string) {
    if (openUser === u) {
      setOpenUser(null);
      return;
    }
    setOpenUser(u);
    if (!userBets[u]) {
      const { data } = await supabase
        .from("public_bets")
        .select("*")
        .eq("username", u)
        .order("placed_at", { ascending: false });
      setUserBets((prev) => ({ ...prev, [u]: data ?? [] }));
    }
  }

  async function submitReport(betId: string) {
    const why = reason.trim();
    if (!why) return;
    await supabase.from("bet_reports").insert({
      bet_id: betId,
      reporter: user.id,
      reason: why,
    });
    setReporting(null);
    setReason("");
  }

  // aggregate the tier/org grouped rows into the selected board
  const byUser: Record<string, Agg> = {};
  raw
    .filter((r) => r.tier === tier && (!ufcOnly || r.org === "UFC"))
    .forEach((r) => {
      if (!byUser[r.username]) {
        byUser[r.username] = {
          username: r.username,
          bets: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          staked: 0,
          profit: 0,
        };
      }
      const a = byUser[r.username];
      a.bets += Number(r.bets);
      a.wins += Number(r.wins);
      a.losses += Number(r.losses);
      a.pushes += Number(r.pushes);
      a.staked += Number(r.staked);
      a.profit += Number(r.profit);
    });

  const roi = (r: Agg) => (r.staked > 0 ? (r.profit / r.staked) * 100 : 0);
  const sorted = Object.values(byUser).sort((a, b) =>
    sortBy === "profit" ? b.profit - a.profit : roi(b) - roi(a)
  );
  const ranked = sorted.filter((r) => r.bets >= MIN_BETS_TO_RANK);
  const building = sorted.filter((r) => r.bets < MIN_BETS_TO_RANK);

  const rankColor = (i: number) =>
    i === 0
      ? "text-amber-400"
      : i === 1
      ? "text-neutral-300"
      : i === 2
      ? "text-orange-400"
      : "text-neutral-600";

  function visibleBets(u: string): PublicBet[] {
    return (userBets[u] ?? []).filter(
      (b) =>
        bookTier(b.book) === tier &&
        (!ufcOnly || (b.event_context ?? "").split(" — ")[0] === "UFC")
    );
  }

  function renderRow(r: Agg, rank: number | null) {
    const rroi = roi(r);
    const isOpen = openUser === r.username;
    const bets = visibleBets(r.username);
    return (
      <div key={r.username} className="rounded-xl border border-neutral-800 bg-neutral-900/40">
        <button
          onClick={() => toggleUser(r.username)}
          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-900/60"
        >
          <span
            className={`w-6 text-sm font-bold ${
              rank !== null ? rankColor(rank) : "text-neutral-700"
            }`}
          >
            {rank !== null ? rank + 1 : "-"}
          </span>
          <span className="flex-1 text-sm font-medium truncate">
            {r.username}
            {r.username === username && <span className="text-neutral-600"> (you)</span>}
          </span>
          <span className="text-xs text-neutral-500 shrink-0">
            {r.wins}-{r.losses}-{r.pushes}
          </span>
          <span
            className={`text-xs shrink-0 w-16 text-right ${
              r.profit >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {fmtUnits(r.profit)}
          </span>
          <span
            className={`text-xs shrink-0 w-16 text-right ${
              rroi >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {rroi >= 0 ? "+" : ""}
            {rroi.toFixed(1)}%
          </span>
        </button>
        {isOpen && (
          <div className="border-t border-neutral-800 p-2 space-y-1">
            {bets.length === 0 && (
              <p className="text-xs text-neutral-600 px-1">
                No visible bets on this board yet (picks appear once their event starts).
              </p>
            )}
            {bets.map((b) => (
              <div key={b.id} className="px-1 py-0.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    {b.selection}{" "}
                    <span className="text-neutral-500">
                      {fmtOdds(b.odds)} · {Number(b.stake)}u
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span
                      className={
                        b.result === "win"
                          ? "text-emerald-400"
                          : b.result === "loss"
                          ? "text-red-400"
                          : b.result === "push"
                          ? "text-amber-400"
                          : "text-neutral-500"
                      }
                    >
                      {b.result}
                    </span>
                    <button
                      onClick={() => {
                        setReporting(reporting === b.id ? null : b.id);
                        setReason("");
                      }}
                      title="Report this bet (odds not available, etc.)"
                      className="text-neutral-600 hover:text-amber-400 p-0.5"
                    >
                      <FlagIcon />
                    </button>
                  </span>
                </div>
                <p className="text-[11px] text-neutral-600 truncate">
                  {b.book ? `${b.book} · ` : ""}
                  {b.event_context ? `${b.event_context} · ` : ""}
                  {fmtDate(b.event_date ?? b.placed_at)}
                </p>
                {reporting === b.id && (
                  <div className="flex gap-2 mt-1">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why? (e.g. that price was never available)"
                      className="flex-1 min-w-0 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-amber-500"
                    />
                    <button
                      onClick={() => submitReport(b.id)}
                      className="rounded-md border border-amber-700 text-amber-400 px-2 py-1 text-xs hover:bg-neutral-900"
                    >
                      Report
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      {!loading && !username && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
            Pick a username to join the leaderboard
          </p>
          <div className="flex gap-2">
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Username"
              className="flex-1 min-w-0 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
            />
            <button
              onClick={claimUsername}
              className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-sm font-medium"
            >
              Claim
            </button>
          </div>
          {msg && <p className="text-xs text-amber-400">{msg}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <button onClick={() => setTier("sharp")} className={sideBtn(tier === "sharp")}>
            Sharp books
          </button>
          <button onClick={() => setTier("soft")} className={sideBtn(tier === "soft")}>
            Soft books
          </button>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setUfcOnly((v) => !v)} className={sideBtn(ufcOnly)}>
            UFC only
          </button>
          <button onClick={() => setSortBy("profit")} className={sideBtn(sortBy === "profit")}>
            Profit
          </button>
          <button onClick={() => setSortBy("roi")} className={sideBtn(sortBy === "roi")}>
            ROI
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-neutral-500 uppercase tracking-wide mr-1">
          {tier === "sharp" ? "Sharp board books" : "Soft board books"}
        </span>
        {(tier === "sharp" ? SHARP_BOOKS : SOFT_BOOKS).map((b) => (
          <span
            key={b}
            className="rounded-full border border-emerald-800 bg-emerald-600/10 px-2 py-0.5 text-[11px] text-emerald-300"
          >
            {b}
          </span>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Verified bets only, logged before the event started. Picks go public at start time.
      </p>

      {loading && <p className="text-neutral-500">Loading leaderboard...</p>}
      {!loading && sorted.length === 0 && (
        <p className="text-neutral-500">
          Nobody on this board yet. Claim a username and settle verified bets at these books to
          appear.
        </p>
      )}

      {ranked.map((r, i) => renderRow(r, i))}

      {building.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-600 uppercase tracking-wide">
            Building a record (under {MIN_BETS_TO_RANK} bets)
          </p>
          {building.map((r) => renderRow(r, null))}
        </div>
      )}
    </div>
  );
}
