"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { PublicBet } from "@/lib/types";
import { betProfit, bookTier, fmtDate, fmtOdds, fmtUnits, sideBtn } from "@/lib/format";

/**
 * Public tipster profile. Everything here is computed from the same
 * `public_bets` window the Verified Leaderboard uses: verified bets only,
 * logged before their event started, visible once the event begins - so a
 * profile can never show anything a leaderboard opponent couldn't audit.
 */

const BET_TYPE_LABELS: Record<string, string> = {
  moneyline: "Moneyline",
  method: "Method",
  round: "Round",
  method_round: "Method + Round",
  over: "Totals",
  under: "Totals",
};

type Split = { n: number; w: number; l: number; p: number; staked: number; profit: number };

function emptySplit(): Split {
  return { n: 0, w: 0, l: 0, p: 0, staked: 0, profit: 0 };
}

function addToSplit(s: Split, b: PublicBet) {
  s.n += 1;
  if (b.result === "win") s.w += 1;
  else if (b.result === "loss") s.l += 1;
  else s.p += 1;
  s.staked += Number(b.stake);
  s.profit += betProfit(b);
}

function splitRoi(s: Split): number {
  return s.staked > 0 ? (s.profit / s.staked) * 100 : 0;
}

// American -> decimal and back, for a meaningful "average odds"
function toDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function toAmerican(decimal: number): number {
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1));
}

export function Profile({
  user,
  target,
  onViewUser,
}: {
  user: User;
  target: string | null; // username to show; null = own profile
  onViewUser: (username: string | null) => void;
}) {
  const [selfName, setSelfName] = useState<string | null>(null);
  const [picks, setPicks] = useState<PublicBet[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchMsg, setSearchMsg] = useState("");
  const [selfLoaded, setSelfLoaded] = useState(false);
  const [nowTs] = useState(() => Date.now()); // frozen per mount, keeps render pure
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const [histFilter, setHistFilter] = useState<"all" | "win" | "loss" | "push" | "live">("all");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("profiles")
      .select("username")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (!alive) return;
        setSelfName(data && data.length > 0 ? data[0].username : null);
        setSelfLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [user.id]);

  const shown = target ?? selfName;

  // loading is derived, not stored: the effect below never calls setState
  // synchronously, and every set here runs after the awaited fetch resolves
  const load = useCallback(async (username: string) => {
    const { data } = await supabase
      .from("public_bets")
      .select("*")
      .eq("username", username)
      .order("placed_at", { ascending: false });
    const { data: prof } = await supabase
      .from("public_profiles")
      .select("avatar_url")
      .eq("username", username);
    setAvatarUrl(prof && prof.length > 0 ? prof[0].avatar_url : null);
    setPicks(data ?? []);
    setLoadedFor(username);
  }, []);

  useEffect(() => {
    if (shown) load(shown);
  }, [shown, load]);

  const loading = !!shown && loadedFor !== shown;
  const isSelf = !!shown && shown === selfName;

  async function onAvatarFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !isSelf) return;
    if (!f.type.startsWith("image/")) {
      setAvatarMsg("Pick an image file.");
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      setAvatarMsg("Keep it under 2MB.");
      return;
    }
    setAvatarBusy(true);
    setAvatarMsg("");
    const path = `${user.id}.png`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, f, { upsert: true, contentType: f.type });
    if (upErr) {
      setAvatarMsg("Upload failed - has the avatar SQL been run?");
      setAvatarBusy(false);
      return;
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${pub.publicUrl}?v=${Date.now()}`;
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("user_id", user.id);
    if (error) setAvatarMsg("Could not save the avatar.");
    else setAvatarUrl(url);
    setAvatarBusy(false);
  }

  async function findUser() {
    const q = search.trim();
    if (!q) return;
    const { data } = await supabase
      .from("public_bets")
      .select("username")
      .ilike("username", `%${q}%`)
      .limit(50);
    const names = Array.from(new Set((data ?? []).map((r) => r.username)));
    const exact = names.find((n) => n.toLowerCase() === q.toLowerCase());
    if (exact ?? names[0]) {
      setSearchMsg("");
      setSearch("");
      onViewUser(exact ?? names[0]);
    } else {
      setSearchMsg("No user with public picks matches that name.");
    }
  }

  // ---------------------------------------------------------------- stats
  const stats = useMemo(() => {
    const settled = picks.filter((b) => b.result !== "pending");
    const pending = picks.filter((b) => b.result === "pending");
    const overall = emptySplit();
    const last30 = emptySplit();
    const tiers: Record<"sharp" | "soft", Split> = { sharp: emptySplit(), soft: emptySplit() };
    const orgs: Record<string, Split> = {};
    const types: Record<string, Split> = {};
    const books: Record<string, Split> = {};

    const cutoff = new Date(nowTs - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    settled.forEach((b) => {
      addToSplit(overall, b);
      if ((b.event_date ?? b.placed_at.slice(0, 10)) >= cutoff) addToSplit(last30, b);
      const t = bookTier(b.book);
      if (t) addToSplit(tiers[t], b);
      const org = (b.event_context ?? "").split(" — ")[0].trim() || "Other";
      addToSplit((orgs[org] ??= emptySplit()), b);
      const ty = BET_TYPE_LABELS[b.bet_type ?? ""] ?? "Other";
      addToSplit((types[ty] ??= emptySplit()), b);
      if (b.book) addToSplit((books[b.book] ??= emptySplit()), b);
    });

    // curve + streaks in fight order
    const chron = [...settled].sort((a, b) =>
      (a.event_date ?? a.placed_at).localeCompare(b.event_date ?? b.placed_at)
    );
    const curve = chron.reduce<number[]>((arr, b) => {
      arr.push((arr.length ? arr[arr.length - 1] : 0) + betProfit(b));
      return arr;
    }, []);
    let cur = 0;
    let curKind: "W" | "L" | null = null;
    let bestStreak = 0;
    let streak = 0;
    chron.forEach((b) => {
      if (b.result === "win") {
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
      } else if (b.result === "loss") {
        streak = 0;
      }
    });
    for (let i = chron.length - 1; i >= 0; i--) {
      const r = chron[i].result;
      if (r === "push") continue;
      const kind = r === "win" ? "W" : "L";
      if (curKind === null) curKind = kind;
      if (kind !== curKind) break;
      cur += 1;
    }
    const bestWin = settled.reduce<PublicBet | null>(
      (best, b) => (betProfit(b) > (best ? betProfit(best) : 0) ? b : best),
      null
    );

    const decOdds = settled.map((b) => toDecimal(b.odds));
    const avgOdds = decOdds.length
      ? toAmerican(decOdds.reduce((s, v) => s + v, 0) / decOdds.length)
      : null;

    const clvs = picks.filter((b) => b.clv !== null).map((b) => Number(b.clv));
    const avgClv = clvs.length ? clvs.reduce((s, v) => s + v, 0) / clvs.length : null;
    const beatClose = clvs.length
      ? (clvs.filter((v) => v > 0).length / clvs.length) * 100
      : null;

    const first = picks.length ? picks[picks.length - 1].placed_at : null;

    // "current bets": picks shared before their event started
    const upcomingIds = new Set(
      picks
        .filter((b) => b.event_start && new Date(b.event_start).getTime() > nowTs)
        .map((b) => b.id)
    );
    const upcoming = picks
      .filter((b) => upcomingIds.has(b.id))
      .sort((a, b2) => (a.event_date ?? "").localeCompare(b2.event_date ?? ""));
    const history = picks.filter((b) => !upcomingIds.has(b.id));
    const live = history.filter((b) => b.result === "pending");
    const avgStake = overall.n ? overall.staked / overall.n : null;
    const topOrg =
      Object.entries(orgs).sort((a, b2) => b2[1].n - a[1].n)[0]?.[0] ?? null;
    const peak = Math.max(0, ...curve);
    const trough = Math.min(0, ...curve);

    return {
      settled, pending, overall, last30, tiers, orgs, types, books,
      curve, curStreak: cur, curKind, bestStreak, bestWin, avgOdds,
      avgClv, beatClose, first, upcoming, history, live, avgStake, topOrg,
      peak, trough,
    };
  }, [picks, nowTs]);

  const o = stats.overall;
  const roi = splitRoi(o);
  const profitTone = o.profit >= 0 ? "text-emerald-400" : "text-red-400";

  function emptyPanel(title: string, hint: string) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-3">
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
          {title}
        </p>
        <p className="text-xs text-neutral-600">{hint}</p>
      </div>
    );
  }

  function statCard(label: string, value: string, tone = "") {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        <p className="text-[11px] text-neutral-500 uppercase tracking-wide">{label}</p>
        <p className={`text-lg font-bold ${tone}`}>{value}</p>
      </div>
    );
  }

  function breakdown(title: string, rows: Record<string, Split>) {
    const keys = Object.keys(rows).sort((a, b) => rows[b].n - rows[a].n);
    if (keys.length === 0)
      return emptyPanel(title, "Populates once you have settled picks.");
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
          {title}
        </p>
        <div className="space-y-1">
          {keys.map((k) => {
            const s = rows[k];
            return (
              <div key={k} className="flex items-center justify-between text-xs gap-2">
                <span className="text-neutral-400 truncate">{k}</span>
                <span className="text-neutral-600 shrink-0">
                  {s.w}-{s.l}-{s.p}
                </span>
                <span
                  className={`shrink-0 w-28 text-right ${
                    s.profit >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {fmtUnits(s.profit)} ({splitRoi(s) >= 0 ? "+" : ""}
                  {splitRoi(s).toFixed(1)}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const tierCard = (label: string, s: Split) => (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
      <p className="text-[11px] text-neutral-500 uppercase tracking-wide">{label}</p>
      {s.n === 0 ? (
        <p className="text-sm text-neutral-600 mt-1">No settled picks yet.</p>
      ) : (
        <p className="text-sm mt-1">
          <span className="font-bold">
            {s.w}-{s.l}-{s.p}
          </span>{" "}
          <span className={s.profit >= 0 ? "text-emerald-400" : "text-red-400"}>
            {fmtUnits(s.profit)} ({splitRoi(s) >= 0 ? "+" : ""}
            {splitRoi(s).toFixed(1)}%)
          </span>
        </p>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {target && target !== selfName && (
            <button
              onClick={() => onViewUser(null)}
              className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
            >
              ← My profile
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && findUser()}
            placeholder="Find a user"
            className="w-40 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={findUser}
            className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-400 hover:bg-neutral-900"
          >
            View
          </button>
        </div>
      </div>
      {searchMsg && <p className="text-xs text-amber-400">{searchMsg}</p>}

      {!shown && selfLoaded && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <p className="text-sm text-neutral-400">
            Claim a username on the Verified Leaderboard tab to open your profile. Your page
            fills itself from verified picks - no setup, no self-reported numbers.
          </p>
        </div>
      )}

      {shown && (
        <>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    avatarUrl ??
                    `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(shown)}`
                  }
                  alt={shown}
                  className="w-16 h-16 rounded-full border border-neutral-800 bg-neutral-900 object-cover"
                />
                {isSelf && (
                  <>
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={avatarBusy}
                      title="Change your display picture"
                      className="absolute -bottom-1 -right-1 rounded-full border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:text-emerald-400"
                    >
                      {avatarBusy ? "…" : "edit"}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      onChange={onAvatarFile}
                      className="hidden"
                    />
                  </>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xl font-bold truncate">
                    {shown}
                    {isSelf && <span className="text-neutral-600 text-sm"> (you)</span>}
                  </h2>
                  <span className="text-[11px] uppercase tracking-wide text-emerald-500 border border-emerald-900 rounded px-1.5 py-0.5">
                    verified record
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mt-1">
                  {picks.length} public pick{picks.length === 1 ? "" : "s"}
                  {stats.upcoming.length > 0 ? ` · ${stats.upcoming.length} upcoming` : ""}
                  {stats.live.length > 0 ? ` · ${stats.live.length} live` : ""}
                  {stats.first ? ` · tracking since ${fmtDate(stats.first)}` : ""}
                  {stats.topOrg ? ` · most active: ${stats.topOrg}` : ""}
                </p>
                <p className="text-[11px] text-neutral-600 mt-1">
                  Every number below comes from verified bets logged before their event
                  started - the same window the leaderboard scores. Nothing here is
                  self-reported.
                </p>
                {avatarMsg && <p className="text-xs text-amber-400 mt-1">{avatarMsg}</p>}
              </div>
            </div>
          </div>

          {!loading && picks.length > 0 && stats.upcoming.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-3">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
                Upcoming picks
              </p>
              <p className="text-xs text-neutral-600">
                {isSelf
                  ? "Share a pick early with \u201cmake public\u201d on the Bets tab and it shows here before the fight."
                  : "None shared ahead of their events right now."}
              </p>
            </div>
          )}

          {!loading && stats.upcoming.length > 0 && (
            <div className="rounded-xl border border-emerald-900/60 bg-neutral-900/40 p-3">
              <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wide mb-2">
                Upcoming picks · shared before the event
              </p>
              <div className="space-y-2">
                {stats.upcoming.map((b) => (
                  <div key={b.id} className="border-b border-neutral-900 pb-1 last:border-0">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">
                        {b.selection}{" "}
                        <span className="text-neutral-500">
                          {fmtOdds(b.odds)} · {Number(b.stake)}u
                        </span>
                      </span>
                      <span className="shrink-0 text-neutral-400">
                        {fmtDate(b.event_date ?? b.placed_at)}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-600 truncate">
                      {b.book ? `${b.book} · ` : ""}
                      {b.event_context ? `${b.event_context} · ` : ""}
                      {b.published_at ? `shared ${fmtDate(b.published_at)}` : "shared early"}
                      {b.price_check === "verified" && (
                        <span className="ml-1 uppercase tracking-wide text-amber-300">
                          {" "}
                          market ✓
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && <p className="text-neutral-500">Loading profile...</p>}

          {!loading && (
            <>
              {picks.length === 0 && (
                <div className="rounded-xl border border-emerald-900/60 bg-neutral-900/40 p-4">
                  <p className="text-sm text-neutral-300">
                    {isSelf
                      ? "This is your dashboard - it fills itself in as you go."
                      : `${shown} hasn't shared any picks yet.`}
                  </p>
                  {isSelf && (
                    <p className="text-xs text-neutral-500 mt-1">
                      Log a verified bet on the Bets tab, then hit &ldquo;make public&rdquo;
                      to share it before the event - or it goes public automatically when the
                      fight starts. Every card below then tracks itself: record, ROI, CLV,
                      streaks, and your bankroll curve. No self-reported numbers, ever.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {statCard("Record", `${o.w}-${o.l}-${o.p}`)}
                {statCard("Profit", fmtUnits(o.profit), profitTone)}
                {statCard("ROI", `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`, profitTone)}
                {statCard(
                  "Avg odds",
                  stats.avgOdds !== null ? fmtOdds(stats.avgOdds) : "—"
                )}
                {statCard(
                  "Avg CLV",
                  stats.avgClv !== null
                    ? `${stats.avgClv >= 0 ? "+" : ""}${stats.avgClv.toFixed(2)}`
                    : "—",
                  stats.avgClv !== null
                    ? stats.avgClv >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                    : ""
                )}
                {statCard(
                  "Beat close",
                  stats.beatClose !== null ? `${stats.beatClose.toFixed(0)}%` : "—"
                )}
                {statCard(
                  "Streak",
                  stats.curKind
                    ? `${stats.curKind}${stats.curStreak}${
                        stats.bestStreak ? ` · best W${stats.bestStreak}` : ""
                      }`
                    : "—",
                  stats.curKind === "W"
                    ? "text-emerald-400"
                    : stats.curKind === "L"
                    ? "text-red-400"
                    : ""
                )}
                {statCard(
                  "Avg stake",
                  stats.avgStake !== null
                    ? `${Math.round(stats.avgStake * 100) / 100}u`
                    : "—"
                )}
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                    Bankroll · {stats.settled.length} settled pick
                    {stats.settled.length === 1 ? "" : "s"}
                  </p>
                  {stats.curve.length >= 1 && (
                    <span className="text-xs text-neutral-500">
                      peak <span className="text-emerald-400">{fmtUnits(stats.peak)}</span>
                      {" · "}low{" "}
                      <span className="text-red-400">{fmtUnits(stats.trough)}</span>
                      {" · "}
                      <span className={profitTone}>{fmtUnits(o.profit)}</span>
                    </span>
                  )}
                </div>
                <ProfileCurve values={stats.curve} />
                {stats.curve.length < 2 && (
                  <p className="text-[11px] text-neutral-600 mt-1">
                    Your bankroll line starts drawing after your first settled pick.
                  </p>
                )}
              </div>

              {stats.last30.n > 0 && (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1">
                    Last 30 days
                  </p>
                  <p className="text-sm">
                    <span className="font-bold">
                      {stats.last30.w}-{stats.last30.l}-{stats.last30.p}
                    </span>{" "}
                    <span
                      className={stats.last30.profit >= 0 ? "text-emerald-400" : "text-red-400"}
                    >
                      {fmtUnits(stats.last30.profit)} ({splitRoi(stats.last30) >= 0 ? "+" : ""}
                      {splitRoi(stats.last30).toFixed(1)}%)
                    </span>
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {tierCard("Sharp books", stats.tiers.sharp)}
                {tierCard("Soft books", stats.tiers.soft)}
              </div>

              {stats.bestWin && (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1">
                    Best result
                  </p>
                  <p className="text-sm truncate">
                    {stats.bestWin.selection}{" "}
                    <span className="text-neutral-500">{fmtOdds(stats.bestWin.odds)}</span>{" "}
                    <span className="text-emerald-400">{fmtUnits(betProfit(stats.bestWin))}</span>
                  </p>
                </div>
              )}

              {breakdown("By organization", stats.orgs)}
              {breakdown("By market", stats.types)}
              {breakdown("By book", stats.books)}

              <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                    Pick history
                  </p>
                  <div className="flex gap-1">
                    {(["all", "win", "loss", "push", "live"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setHistFilter(f)}
                        className={sideBtn(histFilter === f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {stats.history.filter((b) =>
                    histFilter === "all"
                      ? true
                      : histFilter === "live"
                      ? b.result === "pending"
                      : b.result === histFilter
                  ).length === 0 && (
                    <p className="text-xs text-neutral-600">
                      {stats.history.length === 0
                        ? "No settled picks yet - they land here after each event."
                        : `No ${histFilter} picks.`}
                    </p>
                  )}
                  {stats.history
                    .filter((b) =>
                      histFilter === "all"
                        ? true
                        : histFilter === "live"
                        ? b.result === "pending"
                        : b.result === histFilter
                    )
                    .slice(0, 100)
                    .map((b) => (
                    <div key={b.id} className="border-b border-neutral-900 pb-1 last:border-0">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">
                          {b.selection}{" "}
                          <span className="text-neutral-500">
                            {fmtOdds(b.odds)} · {Number(b.stake)}u
                          </span>
                        </span>
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
                      <p className="text-[11px] text-neutral-600 truncate">
                        {b.book ? `${b.book} · ` : ""}
                        {b.event_context ? `${b.event_context} · ` : ""}
                        {fmtDate(b.event_date ?? b.placed_at)}
                        {b.price_check === "verified" && (
                          <span className="ml-1 uppercase tracking-wide text-amber-300">
                            {" "}
                            market ✓
                          </span>
                        )}
                        {b.clv !== null && (
                          <span className="ml-1">
                            · CLV{" "}
                            <span
                              className={
                                Number(b.clv) >= 0 ? "text-emerald-400" : "text-red-400"
                              }
                            >
                              {Number(b.clv) >= 0 ? "+" : ""}
                              {Number(b.clv).toFixed(2)}
                            </span>
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                  {stats.history.length > 100 && (
                    <p className="text-[11px] text-neutral-600">Showing the latest 100.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ProfileCurve({ values }: { values: number[] }) {
  // always at least a flat baseline: [0] alone renders a centered dashed zero
  const pts = values.length >= 1 ? [0, ...values] : [0, 0];
  const min = Math.min(0, ...pts);
  const max = Math.max(0, ...pts);
  const span = max - min || 1;
  const W = 100;
  const H = 40;
  const x = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * W : 0);
  const y = (v: number) => H - ((v - min) / span) * H;
  const d = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
    .join(" ");
  const color = pts[pts.length - 1] >= 0 ? "#34d399" : "#f87171";
  const area = `${d} L${W.toFixed(2)},${H.toFixed(2)} L0,${H.toFixed(2)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-32">
      <path d={area} fill={color} opacity="0.1" />
      <line
        x1="0"
        y1={y(0)}
        x2={W}
        y2={y(0)}
        stroke="#404040"
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle
        cx={x(pts.length - 1)}
        cy={y(pts[pts.length - 1])}
        r="1.5"
        fill={color}
      />
    </svg>
  );
}
