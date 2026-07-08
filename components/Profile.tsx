"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { PublicBet } from "@/lib/types";
import { betProfit, bookLabel, fmtDate, fmtOdds, sideBtn } from "@/lib/format";

/**
 * Public tipster profile. Everything here is computed from the same
 * `public_bets` window the Verified Leaderboard uses: verified bets only,
 * logged before their event started, visible once the event begins - so a
 * profile can never show anything a leaderboard opponent couldn't audit.
 */

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

type DirRow = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  followers: number;
  following: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  staked: number;
  profit: number;
  ml_bets: number;
  prop_bets: number;
  last_bet_at: string | null;
};

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

  // directory + my follow set, fetched once
  useEffect(() => {
    let alive = true;
    (async () => {
      const [d, f] = await Promise.all([
        supabase.from("profile_directory").select("*"),
        supabase.from("follows").select("following_id").eq("follower_id", user.id),
      ]);
      if (!alive) return;
      setDir((d.data as DirRow[]) ?? []);
      setMyFollowing(
        new Set(((f.data as { following_id: string }[]) ?? []).map((r) => r.following_id))
      );
    })();
    return () => {
      alive = false;
    };
  }, [user.id]);

  const [dir, setDir] = useState<DirRow[]>([]);
  const [myFollowing, setMyFollowing] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<PublicBet[]>([]);
  const [dirSort, setDirSort] = useState<"followers" | "profit" | "roi" | "recent">(
    "followers"
  );

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

  const shownRow = dir.find((d) => d.username === shown) ?? null;
  const iFollowShown = !!shownRow && myFollowing.has(shownRow.user_id);

  async function toggleFollow(targetId: string) {
    const has = myFollowing.has(targetId);
    setMyFollowing((prev) => {
      const n = new Set(prev);
      if (has) n.delete(targetId);
      else n.add(targetId);
      return n;
    });
    if (has) {
      await supabase
        .from("follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", targetId);
    } else {
      await supabase
        .from("follows")
        .insert({ follower_id: user.id, following_id: targetId });
    }
  }

  // the Following feed: recent public picks from everyone you follow
  useEffect(() => {
    if (!isSelf) {
      setFeed([]);
      return;
    }
    const names = dir
      .filter((d) => myFollowing.has(d.user_id))
      .map((d) => d.username);
    if (names.length === 0) {
      setFeed([]);
      return;
    }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("public_bets")
        .select("*")
        .in("username", names)
        .order("event_start", { ascending: false })
        .limit(60);
      if (alive) setFeed((data as PublicBet[]) ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [isSelf, dir, myFollowing]);

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
  // only what the header meta line still needs; the analytics moved to Bets
  const stats = useMemo(() => {
    const settled = picks.filter((b) => b.result !== "pending");
    const orgs: Record<string, Split> = {};
    settled.forEach((b) => {
      const org = (b.event_context ?? "").split(" \u2014 ")[0].trim() || "Other";
      addToSplit((orgs[org] ??= emptySplit()), b);
    });
    const first = picks.length ? picks[picks.length - 1].placed_at : null;
    const upcomingIds = new Set(
      picks
        .filter((b) => b.event_start && new Date(b.event_start).getTime() > nowTs)
        .map((b) => b.id)
    );
    const upcoming = picks.filter((b) => upcomingIds.has(b.id));
    const history = picks.filter((b) => !upcomingIds.has(b.id));
    const live = history.filter((b) => b.result === "pending");
    const topOrg =
      Object.entries(orgs).sort((a, b2) => b2[1].n - a[1].n)[0]?.[0] ?? null;
    return { upcoming, live, first, topOrg };
  }, [picks, nowTs]);

  const dirRoi = (d: DirRow) => (d.staked > 0 ? (d.profit / d.staked) * 100 : 0);
  const dq = search.trim().toLowerCase();
  const discover = dir
    .filter((d) => d.username !== selfName)
    .filter((d) => (dq ? d.username.toLowerCase().includes(dq) : d.bets > 0 || d.followers > 0))
    .sort((a, b) =>
      dirSort === "followers"
        ? b.followers - a.followers
        : dirSort === "profit"
        ? b.profit - a.profit
        : dirSort === "roi"
        ? dirRoi(b) - dirRoi(a)
        : (b.last_bet_at ?? "").localeCompare(a.last_bet_at ?? "")
    )
    .slice(0, 25);

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
                  <div className="flex items-center gap-2">
                    {!isSelf && shownRow && (
                      <button
                        onClick={() => toggleFollow(shownRow.user_id)}
                        className={`rounded-md border px-2.5 py-0.5 text-xs font-medium ${
                          iFollowShown
                            ? "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                            : "border-emerald-700 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25"
                        }`}
                      >
                        {iFollowShown ? "Following" : "Follow"}
                      </button>
                    )}
                    <span className="text-[11px] uppercase tracking-wide text-emerald-500 border border-emerald-900 rounded px-1.5 py-0.5">
                      verified record
                    </span>
                  </div>
                </div>
                <p className="text-xs text-neutral-500 mt-1">
                  {shownRow
                    ? `${shownRow.followers} follower${
                        shownRow.followers === 1 ? "" : "s"
                      } · ${shownRow.following} following · `
                    : ""}
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

          {loading && <p className="text-neutral-500">Loading profile...</p>}

          {!loading && (
            <>
              {isSelf && !target && (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                      Discover bettors{dq ? ` · "${search.trim()}"` : ""}
                    </p>
                    <div className="flex gap-1">
                      {(
                        [
                          ["followers", "Most followed"],
                          ["profit", "Top profit"],
                          ["roi", "Top ROI"],
                          ["recent", "Recent"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setDirSort(key)}
                          className={sideBtn(dirSort === key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {discover.length === 0 ? (
                    <p className="text-xs text-neutral-600">
                      {dq ? "No bettors match that name." : "No bettors with a public record yet."}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {discover.map((d) => (
                        <div
                          key={d.user_id}
                          className="flex items-center gap-2 py-1 border-b border-neutral-900 last:border-0"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={
                              d.avatar_url ??
                              `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(
                                d.username
                              )}`
                            }
                            alt={d.username}
                            className="w-7 h-7 rounded-full border border-neutral-800 bg-neutral-900 object-cover shrink-0"
                          />
                          <button
                            onClick={() => onViewUser(d.username)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <span className="block text-sm font-medium truncate hover:text-emerald-400">
                              {d.username}
                            </span>
                            <span className="block text-[10px] text-neutral-600">
                              {d.wins}-{d.losses}-{d.pushes} · {dirRoi(d) >= 0 ? "+" : ""}
                              {dirRoi(d).toFixed(0)}% ROI · {d.followers} follower
                              {d.followers === 1 ? "" : "s"}
                              {d.prop_bets > 0 && d.ml_bets === 0 ? " · props" : ""}
                            </span>
                          </button>
                          <button
                            onClick={() => toggleFollow(d.user_id)}
                            className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                              myFollowing.has(d.user_id)
                                ? "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                                : "border-emerald-700 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/20"
                            }`}
                          >
                            {myFollowing.has(d.user_id) ? "Following" : "Follow"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!shown && selfLoaded && (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                  <p className="text-sm text-neutral-400">
                    Claim a username on the Verified Leaderboard tab to open your profile. Your page
                    fills itself from verified picks - no setup, no self-reported numbers.
                  </p>
                </div>
              )}

              {isSelf && (
                <div className="rounded-xl border border-emerald-900/60 bg-neutral-900/40 p-3">
                  <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wide mb-2">
                    Following feed
                  </p>
                  {feed.length === 0 ? (
                    <p className="text-xs text-neutral-600">
                      {myFollowing.size === 0
                        ? "Follow some bettors below and their public picks land here, newest first."
                        : "No public picks from the people you follow yet — they appear as their events start."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {feed.map((b) => (
                        <div key={b.id} className="border-b border-neutral-900 pb-1.5 last:border-0">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate">
                              <button
                                onClick={() => onViewUser(b.username)}
                                className="font-semibold text-emerald-300 hover:underline"
                              >
                                {b.username}
                              </button>{" "}
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
                              {b.result}
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
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </>
          )}
        </>
      )}
    </div>
  );
}
