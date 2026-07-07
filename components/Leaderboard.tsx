"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { LeaderboardRow, PublicBet } from "@/lib/types";
import { SHARP_BOOKS, SOFT_BOOKS, bookLabel, bookTier, fmtDate, fmtOdds, fmtUnits, sideBtn } from "@/lib/format";
import { FlagIcon } from "@/components/icons";
import { InfoButton, LEADERBOARD_README, ReadMePanel } from "@/components/ReadMe";

const MIN_BETS_TO_RANK = 5;

type Agg = {
  username: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  staked: number;
  profit: number;
  clv_sum: number;
  clv_n: number;
};

export function Leaderboard({
  user,
  onOpenProfile,
}: {
  user: User;
  onOpenProfile: (username: string) => void;
}) {
  const [raw, setRaw] = useState<LeaderboardRow[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [msg, setMsg] = useState("");
  const [tier, setTier] = useState<"sharp" | "soft">("sharp");
  const [ufcOnly, setUfcOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"profit" | "roi" | "clv">("profit");
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [userBets, setUserBets] = useState<Record<string, PublicBet[]>>({});
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

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
          clv_sum: 0,
          clv_n: 0,
        };
      }
      const a = byUser[r.username];
      a.bets += Number(r.bets);
      a.wins += Number(r.wins);
      a.losses += Number(r.losses);
      a.pushes += Number(r.pushes);
      a.staked += Number(r.staked);
      a.profit += Number(r.profit);
      a.clv_sum += Number(r.clv_sum);
      a.clv_n += Number(r.clv_n);
    });

  const roi = (r: Agg) => (r.staked > 0 ? (r.profit / r.staked) * 100 : 0);
  const avgClv = (r: Agg) => (r.clv_n > 0 ? r.clv_sum / r.clv_n : -Infinity);
  const sorted = Object.values(byUser).sort((a, b) =>
    sortBy === "profit"
      ? b.profit - a.profit
      : sortBy === "roi"
      ? roi(b) - roi(a)
      : avgClv(b) - avgClv(a)
  );
  const ranked = sorted.filter((r) => r.bets >= MIN_BETS_TO_RANK);
  const building = sorted.filter((r) => r.bets < MIN_BETS_TO_RANK);

  // your settled verified picks across BOTH boards - fuel for the rank tracker
  const selfSettled = username
    ? raw
        .filter((r) => r.username === username)
        .reduce((s, r) => s + Number(r.bets), 0)
    : 0;

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
    const rclv = r.clv_n > 0 ? r.clv_sum / r.clv_n : null;
    const isOpen = openUser === r.username;
    const bets = visibleBets(r.username);
    return (
      <div key={r.username} className="rounded-xl border border-neutral-800 bg-neutral-900/40">
        <div
          onClick={() => toggleUser(r.username)}
          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-900/60 cursor-pointer"
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
          <span
            className={`text-xs shrink-0 w-14 text-right ${
              rclv === null ? "text-neutral-700" : rclv >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {rclv === null ? "—" : `${rclv >= 0 ? "+" : ""}${rclv.toFixed(1)}`}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenProfile(r.username);
            }}
            title="Open this user's profile"
            className="shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-600 hover:text-emerald-400 hover:border-neutral-700"
          >
            profile
          </button>
        </div>
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
                  {b.book ? `${bookLabel(b.book)} · ` : ""}
                  {b.event_context ? `${b.event_context} · ` : ""}
                  {fmtDate(b.event_date ?? b.placed_at)}
                  {b.price_check === "verified" && (
                    <span className="ml-1 uppercase tracking-wide text-amber-300"> market ✓</span>
                  )}
                </p>
                {b.price_check === "above_market" && b.market_best !== null && (
                  <p className="text-[11px] text-amber-500/80">
                    Above board when logged (best {fmtOdds(b.market_best)}
                    {b.market_book ? ` @ ${b.market_book}` : ""})
                  </p>
                )}
                {b.clv !== null && (
                  <p className="text-[11px] text-neutral-500">
                    CLV{" "}
                    <span className={Number(b.clv) >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {Number(b.clv) >= 0 ? "+" : ""}
                      {Number(b.clv).toFixed(2)}
                    </span>
                  </p>
                )}
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
        <div className="flex items-center gap-1">
          <InfoButton open={showInfo} onClick={() => setShowInfo((v) => !v)} />
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
          <button onClick={() => setSortBy("clv")} className={sideBtn(sortBy === "clv")}>
            CLV
          </button>
        </div>
      </div>
      {showInfo && <ReadMePanel paragraphs={LEADERBOARD_README} />}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-neutral-500 uppercase tracking-wide mr-1">
          {tier === "sharp" ? "Sharp board books" : "Soft board books"}
        </span>
        {(tier === "sharp" ? SHARP_BOOKS : SOFT_BOOKS).map((bk) => (
          <span
            key={bk}
            className="rounded-full border border-emerald-800 bg-emerald-600/10 px-2 py-0.5 text-[11px] text-emerald-300"
          >
            {bookLabel(bk)}
          </span>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Verified bets only - logged at a listed book before the event started. Picks go
        public at start time. Tap a row to see picks, or open the full profile.
      </p>

      {loading && <p className="text-neutral-500">Loading leaderboard...</p>}
      {!loading && sorted.length === 0 && (
        <div aria-hidden className="space-y-2 select-none">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`rounded-xl border border-dashed bg-neutral-900/20 ${
                i === 0
                  ? "border-neutral-700"
                  : i === 1
                  ? "border-neutral-800 opacity-70"
                  : "border-neutral-800 opacity-40"
              }`}
            >
              <div className="flex items-center gap-3 px-3 py-2">
                <span className={`w-6 text-sm font-bold ${rankColor(i)}`}>{i + 1}</span>
                <span
                  className={`flex-1 text-sm ${
                    i === 0 ? "text-neutral-500" : "text-neutral-700"
                  }`}
                >
                  {i === 0 ? "open seat" : "—"}
                </span>
                <span className="text-xs text-neutral-700 shrink-0">0-0-0</span>
                <span className="text-xs text-neutral-700 shrink-0 w-16 text-right">
                  +0.00u
                </span>
                <span className="text-xs text-neutral-700 shrink-0 w-16 text-right">
                  +0.0%
                </span>
                <span className="text-xs text-neutral-700 shrink-0 w-14 text-right">—</span>
              </div>
            </div>
          ))}
          <p className="text-xs text-neutral-600">
            The {tier} board is waiting for its first verified record
            {ufcOnly ? " (the UFC filter is on)" : ""}. First five settled picks take the
            podium.
          </p>
        </div>
      )}

      {ranked.map((r, i) => renderRow(r, i))}

      {!loading && selfSettled < MIN_BETS_TO_RANK && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
            Your path to the board
          </p>
          <div className="space-y-1.5 text-xs">
            {[
              {
                done: Boolean(username),
                label: username
                  ? `Username claimed — ${username}`
                  : "Claim a username (top of this page)",
              },
              {
                done: selfSettled > 0,
                label: "Log verified picks at a listed book before the fight starts",
              },
              {
                done: selfSettled >= MIN_BETS_TO_RANK,
                label: `Settle ${MIN_BETS_TO_RANK} - you rank the moment the fifth grades`,
              },
            ].map((s, i) => (
              <p key={i} className="flex items-center gap-2">
                <span className={s.done ? "text-emerald-400" : "text-neutral-700"}>
                  {s.done ? "✓" : "○"}
                </span>
                <span className={s.done ? "text-neutral-400" : "text-neutral-500"}>
                  {s.label}
                </span>
              </p>
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            {Array.from({ length: MIN_BETS_TO_RANK }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-6 rounded-full ${
                  i < selfSettled ? "bg-emerald-500" : "bg-neutral-800"
                }`}
              />
            ))}
            <span className="text-[11px] text-neutral-500 ml-1">
              {Math.min(selfSettled, MIN_BETS_TO_RANK)} of {MIN_BETS_TO_RANK} settled picks
            </span>
          </div>
        </div>
      )}

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
