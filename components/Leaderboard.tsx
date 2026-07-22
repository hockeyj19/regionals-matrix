"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { LeaderboardRow, PublicBet } from "@/lib/types";
import {
  SHARP_BOOKS,
  SOFT_BOOKS,
  americanToImplied,
  bookLabel,
  bookTier,
  fmtDate,
  fmtOdds,
  fmtUnits,
  percentToAmerican,
  sideBtn,
} from "@/lib/format";
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
  const [ufcOnly, setUfcOnly] = useState(true);
  const [sortBy, setSortBy] = useState<"profit" | "roi" | "clv">("profit");
  const [marketFilter, setMarketFilter] = useState<"all" | "ml" | "prop">("all");
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [userBets, setUserBets] = useState<Record<string, PublicBet[]>>({});
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [allPublic, setAllPublic] = useState<PublicBet[]>([]);
  const [avatarByUsername, setAvatarByUsername] = useState<Record<string, string | null>>({});
  const [collapsedPublic, setCollapsedPublic] = useState<Set<string>>(new Set());
  const [picksView, setPicksView] = useState<"public" | "consensus" | "results">("public");

  useEffect(() => {
    let alive = true;
    async function load() {
      const [{ data: lb }, { data: me }, { data: pubs }, { data: avatars }] = await Promise.all([
        supabase.from("leaderboard_rows").select("*"),
        supabase.from("profiles").select("username").eq("user_id", user.id),
        supabase.from("public_bets").select("*").order("placed_at", { ascending: false }),
        supabase.from("public_profiles").select("username, avatar_url"),
      ]);
      if (!alive) return;
      setRaw(lb ?? []);
      setUsername(me && me.length > 0 ? me[0].username : null);
      setAllPublic(pubs ?? []);
      const avMap: Record<string, string | null> = {};
      (avatars ?? []).forEach((a: { username: string; avatar_url: string | null }) => (avMap[a.username] = a.avatar_url));
      setAvatarByUsername(avMap);
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

  // aggregate the tier/org grouped rows into the selected board
  const byUser: Record<string, Agg> = {};
  raw
    .filter(
      (r) =>
        r.tier === tier &&
        (!ufcOnly || r.org === "UFC") &&
        (marketFilter === "all" || r.market === marketFilter)
    )
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

  // your settled verified picks across BOTH boards - fuel for the rank tracker
  const selfSettled = username
    ? raw
        .filter((r) => r.username === username)
        .reduce((s, r) => s + Number(r.bets), 0)
    : 0;

  // same fallback Profile.tsx already uses for a user with no uploaded picture
  const avatarSrc = (u: string) =>
    avatarByUsername[u] ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(u)}`;

  const rankColor = (i: number) =>
    i === 0
      ? "text-amber-400"
      : i === 1
      ? "text-neutral-300"
      : i === 2
      ? "text-orange-400"
      : "text-neutral-600";

  // every public pick, grouped by user, ordered by board rank then name
  const rankIndex: Record<string, number> = {};
  sorted.forEach((r, i) => {
    rankIndex[r.username] = i;
  });
  // Consensus: every public pick grouped by what was actually taken. Prices are
  // averaged as implied PROBABILITY, not raw American odds - averaging -200 and
  // +200 arithmetically gives 0, which is nonsense. Groups with open picks float
  // to the top: what the room is on right now is the useful part.
  type Cons = {
    key: string;
    selection: string;
    event: string;
    n: number;
    open: number;
    probSum: number;
    units: number;
    users: string[];
  };
  // Public = what the room is on right now. Results = the last 14 days, graded.
  const DAY_MS = 86400000;
  const viewPicks =
    picksView === "results"
      ? allPublic.filter(
          (b) =>
            b.result !== "pending" &&
            Date.now() - new Date(b.event_date ?? b.placed_at).getTime() <= 14 * DAY_MS
        )
      : allPublic.filter((b) => b.result === "pending");

  const consMap: Record<string, Cons> = {};
  for (const b of allPublic) {
    if (b.username === "Consensus") continue; // the bot mirrors consensus - never let it count itself
    const key = `${b.event_context ?? ""}||${b.selection}`;
    const c =
      consMap[key] ??
      (consMap[key] = {
        key,
        selection: b.selection,
        event: b.event_context ?? "",
        n: 0,
        open: 0,
        probSum: 0,
        units: 0,
        users: [],
      });
    c.n += 1;
    if (b.result === "pending") c.open += 1;
    c.probSum += americanToImplied(b.odds);
    c.units += Number(b.stake) || 0;
    if (!c.users.includes(b.username)) c.users.push(b.username);
  }
  const consensusRows = Object.values(consMap)
    .filter((c) => c.users.length >= 2) // consensus = 2+ distinct users on the same pick
    .map((c) => ({ ...c, avgOdds: percentToAmerican((c.probSum / c.n) * 100) }))
    .sort(
      (a, b) =>
        (b.open > 0 ? 1 : 0) - (a.open > 0 ? 1 : 0) ||
        b.n - a.n ||
        b.units - a.units ||
        a.selection.localeCompare(b.selection)
    );

  const publicByUser: Record<string, PublicBet[]> = {};  // of the chosen view
  for (const b of viewPicks) {
    if (bookTier(b.book) !== tier) continue;
    if (ufcOnly && (b.event_context ?? "").split(" — ")[0] !== "UFC") continue;
    if (marketFilter !== "all" && betMarket(b.bet_type) !== marketFilter) continue;
    (publicByUser[b.username] ??= []).push(b);
  }
  const publicUsers = Object.keys(publicByUser).sort((a, b) => {
    const ra = rankIndex[a] ?? Infinity;
    const rb = rankIndex[b] ?? Infinity;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  function betMarket(bt: string | null): "ml" | "prop" {
    return bt === "moneyline" ? "ml" : "prop";
  }

  function visibleBets(u: string): PublicBet[] {
    return (userBets[u] ?? []).filter(
      (b) =>
        bookTier(b.book) === tier &&
        (!ufcOnly || (b.event_context ?? "").split(" — ")[0] === "UFC") &&
        (marketFilter === "all" || betMarket(b.bet_type) === marketFilter)
    );
  }

  function renderPublicBet(b: PublicBet) {
    return (
              <div key={b.id} className="px-1 py-0.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-baseline gap-1 min-w-0">
                    <span className="truncate">{b.selection}</span>
                    <span className="shrink-0 text-emerald-400">
                      {fmtOdds(b.odds)} · {Number(b.stake)}u
                      {b.clv !== null && (
                        <span className="text-neutral-500">
                          {" · CLV "}
                          <span className={Number(b.clv) >= 0 ? "text-emerald-400" : "text-red-400"}>
                            {Number(b.clv) >= 0 ? "+" : ""}
                            {Number(b.clv).toFixed(1)}%
                          </span>
                        </span>
                      )}
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
                          ? "text-neutral-400"
                          : "text-sky-300"
                      }
                    >
                      {b.result}
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-neutral-600 truncate">
                  {b.book ? `${bookLabel(b.book)} · ` : ""}
                  {b.event_context ? `${b.event_context} · ` : ""}
                  {fmtDate(b.event_date ?? b.placed_at)}
                </p>
                {b.price_check === "above_market" && b.market_best !== null && (
                  <p className="text-[11px] text-amber-500/80">
                    Above board when logged (best {fmtOdds(b.market_best)}
                    {b.market_book ? ` @ ${b.market_book}` : ""})
                  </p>
                )}
              </div>);
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
          <span className="hidden sm:flex flex-1 items-center gap-2 min-w-0 text-sm font-medium">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarSrc(r.username)}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full border border-neutral-800 bg-neutral-900 object-cover"
            />
            <span className="truncate">
              {r.username}
              {r.username === username && <span className="text-neutral-600"> (you)</span>}
            </span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenProfile(r.username);
            }}
            className="sm:hidden flex-1 flex items-center gap-2 min-w-0 text-left text-sm font-medium hover:text-emerald-400"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarSrc(r.username)}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full border border-neutral-800 bg-neutral-900 object-cover"
            />
            <span className="truncate">
              {r.username}
              {r.username === username && <span className="text-neutral-600"> (you)</span>}
            </span>
          </button>
          <span className="hidden sm:inline text-xs text-neutral-500 shrink-0 w-14 text-right">
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
            className={`hidden sm:inline text-xs shrink-0 w-14 text-right ${
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
            className="hidden sm:block shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-600 hover:text-emerald-400 hover:border-neutral-700"
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
            {bets.map((b) => renderPublicBet(b))}
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
          <button onClick={() => setUfcOnly((v) => !v)} className={sideBtn(ufcOnly)}>
            UFC Only
          </button>
          <button onClick={() => setTier("sharp")} className={sideBtn(tier === "sharp")}>
            BetOnline Verified
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(
              [
                ["all", "All"],
                ["ml", "MLs"],
                ["prop", "Props"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMarketFilter(key)}
                className={sideBtn(marketFilter === key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
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
      </div>
      {showInfo && <ReadMePanel paragraphs={LEADERBOARD_README} />}

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

      {ranked.length > 0 && (
        <div className="flex items-center gap-3 px-3 pb-1 text-[10px] uppercase tracking-wide text-neutral-600">
          <span className="w-6" />
          <span className="flex-1">User</span>
          <span className="hidden sm:inline shrink-0 w-14 text-right">Record</span>
          <span className="shrink-0 w-16 text-right">Profit</span>
          <span className="shrink-0 w-16 text-right">ROI</span>
          <span className="hidden sm:inline shrink-0 w-14 text-right">CLV</span>
          <span className="hidden sm:block shrink-0 w-[52px]" />
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

      {!loading && (allPublic.length > 0 || consensusRows.length > 0) && (
        <div className="flex items-center gap-1 pt-2">
          {(
            [
              ["public", "Public"],
              ["consensus", "Consensus"],
              ["results", "Results"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPicksView(key)}
              className={sideBtn(picksView === key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!loading && picksView !== "consensus" && publicUsers.length === 0 && (
        <p className="pt-1 text-xs text-neutral-500">
          {picksView === "results"
            ? "No picks have graded in the last 14 days."
            : "No open public picks right now."}
        </p>
      )}

      {!loading && picksView === "consensus" && consensusRows.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
            Consensus — what the group is on
          </p>
          {consensusRows.map((c) => (
            <div
              key={c.key}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium truncate">{c.selection}</p>
                <span className="shrink-0 text-xs font-semibold text-emerald-400">
                  {c.n} pick{c.n === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 truncate">
                {c.event ? `${c.event} · ` : ""}
                avg {fmtOdds(c.avgOdds)} · {fmtUnits(c.units).replace("+", "")} staked
                {c.open > 0 && <span className="text-sky-300"> · {c.open} open</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.users.map((u) => (
                  <button
                    key={u}
                    onClick={() => onOpenProfile(u)}
                    className="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:text-emerald-400 hover:border-neutral-700"
                  >
                    {u}
                    {u === username && " (you)"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && picksView !== "consensus" && publicUsers.length > 0 && (
        <div className="space-y-2 pt-2">
          {publicUsers.map((u) => {
            const collapsed = collapsedPublic.has(u);
            const rk = rankIndex[u];
            const ubets = publicByUser[u];
            return (
              <div key={u} className="rounded-xl border border-neutral-800 bg-neutral-900/40">
                <div
                  onClick={() =>
                    setCollapsedPublic((prev) => {
                      const next = new Set(prev);
                      if (next.has(u)) next.delete(u);
                      else next.add(u);
                      return next;
                    })
                  }
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-900/60"
                >
                  <span
                    className={`w-6 text-sm font-bold ${
                      rk !== undefined ? rankColor(rk) : "text-neutral-700"
                    }`}
                  >
                    {rk !== undefined ? rk + 1 : "-"}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarSrc(u)}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-full border border-neutral-800 bg-neutral-900 object-cover"
                  />
                  <span className="flex-1 text-sm font-medium truncate">
                    {u}
                    {u === username && <span className="text-neutral-600"> (you)</span>}
                  </span>
                  <span className="text-[11px] text-neutral-600 shrink-0">
                    {ubets.length} pick{ubets.length === 1 ? "" : "s"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenProfile(u);
                    }}
                    title="Open this user's profile"
                    className="shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-600 hover:text-emerald-400 hover:border-neutral-700"
                  >
                    profile
                  </button>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    className={`text-neutral-500 transition-transform ${
                      collapsed ? "" : "rotate-180"
                    }`}
                  >
                    <path
                      d="M6 9l6 6 6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                {!collapsed && (
                  <div className="border-t border-neutral-800 p-2 space-y-1">
                    {ubets.map((b) => renderPublicBet(b))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
