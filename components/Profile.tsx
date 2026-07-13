"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { PublicBet } from "@/lib/types";
import { betProfit, bookLabel, fmtDate, fmtOdds, getOddsMode, setOddsMode, sideBtn, type OddsMode } from "@/lib/format";

/**
 * Public tipster profile. The public bets, badges, and per-window records all
 * come from the same public_bets the Verified Leaderboard scores, so nothing
 * here is anything a leaderboard opponent couldn't audit.
 *
 * Bio, fighter-note count and join date are only wired for your OWN profile:
 * a viewer's bio/notes/created_at aren't in the public views yet, so on someone
 * else's profile those read "—" until we expose them.
 */

const MIN_BETS_TO_RANK = 5; // matches the Leaderboard

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

// "+10.8u" / "-10.8u" / "0.0u"
function fmtU(u: number): string {
  return `${u > 0 ? "+" : ""}${u.toFixed(1)}u`;
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
  const [selfLoaded, setSelfLoaded] = useState(false);
  const [picks, setPicks] = useState<PublicBet[]>([]);
  const [ownBets, setOwnBets] = useState<PublicBet[]>([]);   // self only: the FULL ledger
  const [tableScope, setTableScope] = useState<"verified" | "all">("verified");
  const [openWindow, setOpenWindow] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [dir, setDir] = useState<DirRow[]>([]);
  const [myFollowing, setMyFollowing] = useState<Set<string>>(new Set());
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [shownJoin, setShownJoin] = useState<string | null>(null);
  const [shownBio, setShownBio] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const [bio, setBio] = useState("");
  const [notesCount, setNotesCount] = useState(0);
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [searchMsg, setSearchMsg] = useState("");
  const [modal, setModal] = useState<null | "followers" | "following">(null);
  const [modalUsers, setModalUsers] = useState<
    { user_id: string; username: string; avatar_url: string | null }[]
  >([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [nowTs] = useState(() => Date.now()); // frozen per mount, keeps render pure
  const [copied, setCopied] = useState(false);
  const [oddsFmt, setOddsFmt] = useState<OddsMode>("american");
  useEffect(() => setOddsFmt(getOddsMode()), []);
  function pickOddsFmt(m: OddsMode) {
    setOddsMode(m);
    setOddsFmt(m);
  }

  // A record is only worth keeping if it can travel. /profile/<name> is readable by
  // anyone - no account, no login - so this link IS the proof.
  async function shareProfile(name: string) {
    const url = `${window.location.origin}/profile/${name}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this link:", url); // clipboard blocked - hand it over anyway
    }
  }
  const fileRef = useRef<HTMLInputElement>(null);

  // self: username + about-me + all-time fighter-note count
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id);
      const [notesRes, histRes] = await Promise.all([
        supabase.from("user_fighter_notes").select("fighter_id, notes, tags").eq("user_id", user.id),
        supabase.from("user_fighter_note_history").select("fighter_id").eq("user_id", user.id),
      ]);
      if (!alive) return;
      const row = data && data.length > 0 ? data[0] : null;
      setSelfName(row ? row.username : null);
      setBio(row && typeof row.bio === "string" ? row.bio : "");
      // count fighters with a real note, tags, or history - the same rule the
      // Library uses, so an emptied row can't inflate this the way a raw count did
      const histSet = new Set(
        ((histRes.data as { fighter_id: string }[]) ?? []).map((h) => h.fighter_id)
      );
      const kept = (
        (notesRes.data as { fighter_id: string; notes: string | null; tags: string[] | null }[]) ??
        []
      ).filter(
        (r) => (r.notes ?? "").trim() !== "" || (r.tags ?? []).length > 0 || histSet.has(r.fighter_id)
      ).length;
      setNotesCount(kept);
      setSelfLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [user.id]);

  // directory + my follow set
  useEffect(() => {
    let alive = true;
    (async () => {
      const [d, f, nc] = await Promise.all([
        supabase.from("profile_directory").select("*"),
        supabase.from("follows").select("following_id").eq("follower_id", user.id),
        supabase.from("public_note_counts").select("user_id, note_count"),
      ]);
      if (!alive) return;
      setDir((d.data as DirRow[]) ?? []);
      setMyFollowing(
        new Set(((f.data as { following_id: string }[]) ?? []).map((r) => r.following_id))
      );
      // public per-user note counts; empty (0 shown) until the view exists
      const counts: Record<string, number> = {};
      for (const r of (nc.data as { user_id: string; note_count: number }[]) ?? []) {
        counts[r.user_id] = Number(r.note_count) || 0;
      }
      setNoteCounts(counts);
    })();
    return () => {
      alive = false;
    };
  }, [user.id]);

  const shown = target ?? selfName;

  const load = useCallback(async (username: string) => {
    const { data } = await supabase
      .from("public_bets")
      .select("*")
      .eq("username", username)
      .order("placed_at", { ascending: false });
    const { data: prof } = await supabase
      .from("public_profiles")
      .select("*")
      .eq("username", username);
    const p = prof && prof.length > 0 ? prof[0] : null;
    setAvatarUrl(p?.avatar_url ?? null);
    // created_at is only here once the public_profiles view exposes it; falls
    // back to null (own profile still uses the account's own timestamp)
    setShownJoin(typeof p?.created_at === "string" ? p.created_at : null);
    // another user's bio, once the view exposes it (empty until then)
    setShownBio(typeof p?.bio === "string" ? p.bio : "");
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
      await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", targetId);
    } else {
      await supabase.from("follows").insert({ follower_id: user.id, following_id: targetId });
    }
  }

  // Live matches from the directory (every user with a profile, not just those
  // with public picks - otherwise someone who hasn't shared a pick is unfindable).
  const matches = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const hit = dir.filter((d) => d.username.toLowerCase().includes(q));
    hit.sort((a, b) => {
      // exact first, then prefix, then the rest - alphabetical within each
      const rank = (n: string) =>
        n.toLowerCase() === q ? 0 : n.toLowerCase().startsWith(q) ? 1 : 2;
      return rank(a.username) - rank(b.username) || a.username.localeCompare(b.username);
    });
    return hit.slice(0, 6);
  })();

  function pickUser(name: string) {
    setSearch("");
    setSearchMsg("");
    onViewUser(name);
  }

  // open the followers / following list for the shown user, mapped to usernames
  async function openFollowList(kind: "followers" | "following") {
    if (!shownRow) return;
    setModal(kind);
    setModalLoading(true);
    setModalUsers([]);
    const matchCol = kind === "followers" ? "following_id" : "follower_id";
    const pickCol = kind === "followers" ? "follower_id" : "following_id";
    const { data } = await supabase
      .from("follows")
      .select(pickCol)
      .eq(matchCol, shownRow.user_id);
    const ids = new Set(((data as Record<string, string>[]) ?? []).map((r) => r[pickCol]));
    const users = dir
      .filter((d) => ids.has(d.user_id))
      .map((d) => ({ user_id: d.user_id, username: d.username, avatar_url: d.avatar_url }))
      .sort((a, b) => a.username.localeCompare(b.username));
    setModalUsers(users);
    setModalLoading(false);
  }

  async function saveBio() {
    const v = bio.trim();
    setBio(v);
    // needs a `bio text` column on profiles; if it's missing this no-ops quietly
    await supabase.from("profiles").update({ bio: v }).eq("user_id", user.id);
  }

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
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("user_id", user.id);
    if (error) setAvatarMsg("Could not save the avatar.");
    else setAvatarUrl(url);
    setAvatarBusy(false);
  }

  // leaderboard rank: overall, by profit among users with >= 5 verified bets
  const rank = useMemo(() => {
    if (!shownRow || shownRow.bets < MIN_BETS_TO_RANK) return null;
    const ranked = dir
      .filter((d) => d.bets >= MIN_BETS_TO_RANK)
      .sort((a, b) => b.profit - a.profit);
    const i = ranked.findIndex((d) => d.user_id === shownRow.user_id);
    return i >= 0 ? i + 1 : null;
  }, [dir, shownRow]);

  // per-window performance from settled public bets, bucketed by fight date
  // Your own profile can see your whole ledger; someone else's can only ever show
  // what they made public - their private picks are theirs. That is the honest
  // ceiling, and why the Verified/All switch exists only on your own page.
  useEffect(() => {
    if (!isSelf) {
      setOwnBets([]);
      return;
    }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("user_bets")
        .select(
          "id, selection, bet_type, event_context, event_date, event_start, published_at, odds, stake, book, result, placed_at, price_check"
        )
        .eq("user_id", user.id)
        .order("placed_at", { ascending: false });
      if (!alive) return;
      const rows = (data ?? []) as unknown as Omit<PublicBet, "username">[];
      setOwnBets(rows.map((b) => ({ ...b, username: shown ?? "" })));
    })();
    return () => {
      alive = false;
    };
  }, [isSelf, user.id, shown]);

  // Open picks, shown on every profile to everyone. Deliberately read from the
  // PUBLIC view, never the private ledger: a pending pick that hasn't been
  // published must never leak onto a page anyone can open.
  const openPicks = useMemo(() => picks.filter((b) => b.result === "pending"), [picks]);

  // What the window table scores: your full ledger (sliced by Verified/All) on
  // your own page, their public picks on anyone else's.
  const history = useMemo(() => {
    const src = isSelf ? ownBets : picks;
    return isSelf && tableScope === "all" ? src : src.filter((b) => b.bet_type !== "other");
  }, [isSelf, ownBets, picks, tableScope]);

  const periods = useMemo(() => {
    const settled = history.filter((b) => b.result !== "pending");
    const now = new Date(nowTs);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const D = 86400000;
    const yStart = dayStart - D;
    const wStart = dayStart - 6 * D;
    const mStart = dayStart - 29 * D;
    const dateOf = (b: PublicBet) => {
      const d = b.event_date ?? b.placed_at;
      if (!d) return 0;
      return new Date(d.length === 10 ? `${d}T12:00:00` : d).getTime();
    };
    const bucket = (label: string, pred: (t: number) => boolean) => {
      const bets = settled.filter((b) => pred(dateOf(b)));
      let w = 0;
      let l = 0;
      let p = 0;
      let u = 0;
      bets.forEach((b) => {
        if (b.result === "win") w += 1;
        else if (b.result === "loss") l += 1;
        else p += 1;
        u += betProfit(b);
      });
      return { label, w, l, p, units: u, bets };
    };
    return [
      bucket("Today", (t) => t >= dayStart),
      bucket("Yesterday", (t) => t >= yStart && t < dayStart),
      bucket("Week", (t) => t >= wStart),
      bucket("Month", (t) => t >= mStart),
      bucket("All-Time", () => true),
    ];
  }, [history, nowTs]);

  const joinDate = shownJoin ?? (isSelf ? user.created_at ?? null : null);
  // own count is computed live; another user's comes from the public aggregate
  const shownNotes = isSelf
    ? notesCount
    : shownRow
    ? noteCounts[shownRow.user_id] ?? 0
    : 0;

  function resultTag(b: PublicBet) {
    const cls =
      b.result === "win"
        ? "text-emerald-400"
        : b.result === "loss"
        ? "text-red-400"
        : b.result === "push"
        ? "text-neutral-400"
        : "text-sky-300";
    const label =
      b.result === "win" ? "won" : b.result === "loss" ? "lost" : b.result === "push" ? "push" : "pending";
    return <span className={`shrink-0 text-xs ${cls}`}>{label}</span>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      {target && target !== selfName && (
        <button
          onClick={() => onViewUser(null)}
          className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
        >
          ← My profile
        </button>
      )}

      {!shown && selfLoaded && (
        <p className="text-sm text-neutral-500">
          Claim a username on the Leaderboard tab to set up your profile.
        </p>
      )}

      {shown && (
        <>
          {/* Block 1 — header */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    avatarUrl ??
                    `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(shown)}`
                  }
                  alt={shown}
                  className="w-20 h-20 rounded-full border border-neutral-800 bg-neutral-900 object-cover"
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
              {/* Share sits top-right of the card; the odds toggle tucks in beneath it */}
              <div className="ml-auto flex flex-col items-end gap-2 self-start">
                {shown && (
                  <button
                    onClick={() => shareProfile(shown)}
                    title="Copy this profile's public link - anyone can open it, no account needed"
                    className="rounded-md border border-sky-500/50 px-2 py-1 text-[11px] text-sky-300 hover:bg-sky-500/10"
                  >
                    {copied ? "Link copied" : "Share"}
                  </button>
                )}
              {isSelf && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-neutral-800 bg-neutral-900/40 p-0.5">
                    {(["american", "decimal", "percent"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => pickOddsFmt(m)}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                          oddsFmt === m
                            ? "border border-emerald-500/50 bg-black text-emerald-400"
                            : "border border-transparent text-neutral-400 hover:text-emerald-400"
                        }`}
                      >
                        {m === "american" ? "American" : m === "decimal" ? "Decimal" : "Percent"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!isSelf && (
                <div className="flex flex-wrap gap-2">
                  {shownRow && (
                    <button
                      onClick={() => toggleFollow(shownRow.user_id)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                        iFollowShown
                          ? "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                          : "border-emerald-700 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25"
                      }`}
                    >
                      {iFollowShown ? "Following" : "Follow"}
                    </button>
                  )}
                </div>
              )}
              </div>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white truncate">
              {shown}
              {isSelf && <span className="text-neutral-600 text-base font-normal"> (you)</span>}
            </h2>
            {isSelf ? (
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                onBlur={saveBio}
                placeholder="Add an about me…"
                rows={2}
                className="mt-2 w-full resize-none rounded-md bg-neutral-800/60 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-emerald-500 placeholder:text-neutral-600"
              />
            ) : (
              shownBio && (
                <p className="mt-2 text-sm text-neutral-300 whitespace-pre-wrap">{shownBio}</p>
              )
            )}
            {avatarMsg && <p className="text-xs text-amber-400 mt-1">{avatarMsg}</p>}
          </div>

          {loading && <p className="text-neutral-500">Loading profile...</p>}

          {!loading && (
            <>
              {/* Block 2 — counts + search + badges + join date */}
              <div className="rounded-xl border border-neutral-800 bg-black p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-sm">
                    <button
                      onClick={() => openFollowList("followers")}
                      className="group cursor-pointer rounded px-1"
                    >
                      <span className="font-semibold text-white group-hover:text-emerald-400">
                        {shownRow?.followers ?? 0}
                      </span>{" "}
                      <span className="text-neutral-400 group-hover:text-emerald-400">Followers</span>
                    </button>
                    <span className="text-neutral-700">·</span>
                    <button
                      onClick={() => openFollowList("following")}
                      className="group cursor-pointer rounded px-1"
                    >
                      <span className="font-semibold text-white group-hover:text-emerald-400">
                        {shownRow?.following ?? 0}
                      </span>{" "}
                      <span className="text-neutral-400 group-hover:text-emerald-400">Following</span>
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && matches[0]) pickUser(matches[0].username);
                        if (e.key === "Escape") setSearch("");
                      }}
                      placeholder="Find a user"
                      className="w-40 rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                    />
                    {matches.length > 0 && (
                      <ul className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-xl">
                        {matches.map((m) => (
                          <li key={m.user_id}>
                            <button
                              onClick={() => pickUser(m.username)}
                              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
                            >
                              {m.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={m.avatar_url}
                                  alt=""
                                  className="h-5 w-5 rounded-full object-cover"
                                />
                              ) : (
                                <span className="h-5 w-5 rounded-full border border-neutral-700 bg-neutral-800" />
                              )}
                              <span className="truncate">{m.username}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {search.trim() && matches.length === 0 && (
                      <p className="absolute right-0 mt-1 text-[11px] text-neutral-500">
                        No user by that name.
                      </p>
                    )}
                  </div>
                </div>
                {searchMsg && <p className="text-xs text-amber-400">{searchMsg}</p>}
                <div className="flex flex-wrap gap-2">
                  {rank !== null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-gradient-to-b from-amber-500/20 to-neutral-950 px-3 py-1 text-xs font-semibold text-amber-300 shadow">
                      ★ #{rank} on the Leaderboard
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-gradient-to-b from-emerald-500/15 to-neutral-950 px-3 py-1 text-xs font-semibold text-emerald-300 shadow">
                    {shownNotes} note{shownNotes === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-gradient-to-b from-sky-500/15 to-neutral-950 px-3 py-1 text-xs font-semibold text-sky-300 shadow">
                    {picks.length} pick{picks.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex justify-end">
                  <p className="text-xs text-neutral-500">
                    Join Date: {joinDate ? fmtDate(joinDate) : "—"}
                  </p>
                </div>
              </div>

              {/* Block 3 — open public picks */}
              {openPicks.length > 0 && (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                  <p className="text-xs font-semibold text-sky-300 uppercase tracking-wide mb-2">
                    Open Picks
                  </p>
                  <div className="space-y-1">
                    {openPicks.map((b) => (
                      <div key={b.id} className="border-b border-neutral-900 pb-1 last:border-0">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">
                            {b.selection}{" "}
                            <span className="text-emerald-400">
                              {fmtOdds(b.odds)} · {Number(b.stake)}u
                            </span>
                          </span>
                          {resultTag(b)}
                        </div>
                        <p className="text-[11px] text-neutral-600 truncate">
                          {b.book ? `${bookLabel(b.book)} · ` : ""}
                          {b.event_context ? `${b.event_context} · ` : ""}
                          {fmtDate(b.event_date ?? b.placed_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Block 4 — the record, sliced by window. Tap a row to see the picks. */}
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                {isSelf && (
                  <div className="mb-2 flex items-center gap-1">
                    {(["verified", "all"] as const).map((sc) => (
                      <button
                        key={sc}
                        onClick={() => setTableScope(sc)}
                        title={
                          sc === "verified"
                            ? "Board-priced picks, auto-graded from results"
                            : "Everything, including bets you logged and graded yourself"
                        }
                        className={sideBtn(tableScope === sc)}
                      >
                        {sc === "verified" ? "Verified" : "All"}
                      </button>
                    ))}
                  </div>
                )}
                {periods.map((pr, i) => {
                  const n = pr.w + pr.l + pr.p;
                  const isOpen = openWindow === pr.label;
                  const box =
                    n === 0 || pr.units === 0
                      ? "border-neutral-700 bg-neutral-800 text-neutral-400"
                      : pr.units > 0
                      ? "border-emerald-700 bg-emerald-600/20 text-emerald-300"
                      : "border-red-700 bg-red-600/20 text-red-300";
                  return (
                    <div
                      key={pr.label}
                      className={i < periods.length - 1 ? "border-b border-neutral-800/70" : ""}
                    >
                      <button
                        onClick={() => setOpenWindow(isOpen ? null : pr.label)}
                        title={`Show the picks that settled in this window`}
                        className="flex w-full items-center justify-between py-2.5 text-left hover:bg-neutral-900/50"
                      >
                        <div>
                          <p className="text-sm text-white">{pr.label}</p>
                          <p className="text-xs text-neutral-500">
                            {pr.w}-{pr.l}-{pr.p}
                          </p>
                        </div>
                        <span className="flex items-center gap-2">
                          <span
                            className={`rounded-lg border px-2.5 py-1 text-sm font-semibold tabular-nums ${box}`}
                          >
                            {fmtU(pr.units)}
                          </span>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            className={`shrink-0 text-neutral-600 transition-transform ${
                              isOpen ? "rotate-180" : ""
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
                        </span>
                      </button>
                      {isOpen && (
                        <div className="pb-2">
                          {pr.bets.length === 0 ? (
                            <p className="pb-1 text-xs text-neutral-500">
                              Nothing settled in this window.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {pr.bets.map((b) => (
                                <div
                                  key={b.id}
                                  className="border-b border-neutral-900 pb-1 last:border-0"
                                >
                                  <div className="flex items-center justify-between gap-2 text-xs">
                                    <span className="truncate">
                                      {b.selection}{" "}
                                      <span className="text-emerald-400">
                                        {fmtOdds(b.odds)} · {Number(b.stake)}u
                                      </span>
                                    </span>
                                    {resultTag(b)}
                                  </div>
                                  <p className="text-[11px] text-neutral-600 truncate">
                                    {b.book ? `${bookLabel(b.book)} · ` : ""}
                                    {b.event_context ? `${b.event_context} · ` : ""}
                                    {fmtDate(b.event_date ?? b.placed_at)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {modal && (
        <div
          onClick={() => setModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-2xl min-h-[50vh] max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <p className="text-sm font-semibold text-white">
                {modal === "followers" ? "Followers" : "Following"}
                <span className="text-neutral-500"> · {modalUsers.length}</span>
              </p>
              <button
                onClick={() => setModal(null)}
                className="rounded-md px-2 py-0.5 text-neutral-400 hover:bg-neutral-900 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {modalLoading ? (
                <p className="p-4 text-sm text-neutral-500">Loading…</p>
              ) : modalUsers.length === 0 ? (
                <p className="p-4 text-sm text-neutral-500">
                  {modal === "followers" ? "0 followers" : "0 following"}
                </p>
              ) : (
                modalUsers.map((u) => (
                  <button
                    key={u.user_id}
                    onClick={() => {
                      setModal(null);
                      onViewUser(u.username);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-900"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        u.avatar_url ??
                        `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(u.username)}`
                      }
                      alt={u.username}
                      className="h-9 w-9 rounded-full border border-neutral-800 bg-neutral-900 object-cover"
                    />
                    <span className="truncate text-sm font-medium text-white">{u.username}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
