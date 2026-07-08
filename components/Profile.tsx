"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { PublicBet } from "@/lib/types";
import { betProfit, bookLabel, fmtDate, fmtOdds } from "@/lib/format";

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
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [dir, setDir] = useState<DirRow[]>([]);
  const [myFollowing, setMyFollowing] = useState<Set<string>>(new Set());
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const [bio, setBio] = useState("");
  const [notesCount, setNotesCount] = useState(0);
  const [notifOn, setNotifOn] = useState(false);
  const [nowTs] = useState(() => Date.now()); // frozen per mount, keeps render pure
  const fileRef = useRef<HTMLInputElement>(null);

  // self: username + about-me + all-time fighter-note count
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id);
      const { count } = await supabase
        .from("user_fighter_notes")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (!alive) return;
      const row = data && data.length > 0 ? data[0] : null;
      setSelfName(row ? row.username : null);
      setBio(row && typeof row.bio === "string" ? row.bio : "");
      setNotesCount(count ?? 0);
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

  const shown = target ?? selfName;

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
      await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", targetId);
    } else {
      await supabase.from("follows").insert({ follower_id: user.id, following_id: targetId });
    }
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
  const periods = useMemo(() => {
    const settled = picks.filter((b) => b.result !== "pending");
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
      let w = 0;
      let l = 0;
      let p = 0;
      let u = 0;
      settled.forEach((b) => {
        if (!pred(dateOf(b))) return;
        if (b.result === "win") w += 1;
        else if (b.result === "loss") l += 1;
        else p += 1;
        u += betProfit(b);
      });
      return { label, w, l, p, units: u };
    };
    return [
      bucket("Today", (t) => t >= dayStart),
      bucket("Yesterday", (t) => t >= yStart && t < dayStart),
      bucket("Week", (t) => t >= wStart),
      bucket("Month", (t) => t >= mStart),
      bucket("All-Time", () => true),
    ];
  }, [picks, nowTs]);

  const joinDate = isSelf ? user.created_at ?? null : null;

  function resultTag(b: PublicBet) {
    const cls =
      b.result === "win"
        ? "text-emerald-400"
        : b.result === "loss"
        ? "text-red-400"
        : b.result === "push"
        ? "text-neutral-400"
        : "text-amber-400";
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
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setNotifOn((v) => !v)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                    notifOn
                      ? "border-emerald-700 bg-emerald-600/15 text-emerald-300"
                      : "border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                  }`}
                >
                  {notifOn ? "Notifications On" : "Turn on Notifications"}
                </button>
                {!isSelf && shownRow ? (
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
                ) : (
                  <button
                    disabled
                    title="This is you"
                    className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-600"
                  >
                    Following
                  </button>
                )}
              </div>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white truncate">
              {shown}
              {isSelf && <span className="text-neutral-600 text-base font-normal"> (you)</span>}
            </h2>
            {isSelf && (
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                onBlur={saveBio}
                placeholder="Add an about me…"
                rows={2}
                className="mt-2 w-full resize-none rounded-md bg-neutral-800/60 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-emerald-500 placeholder:text-neutral-600"
              />
            )}
            {avatarMsg && <p className="text-xs text-amber-400 mt-1">{avatarMsg}</p>}
          </div>

          {loading && <p className="text-neutral-500">Loading profile...</p>}

          {!loading && (
            <>
              {/* Block 2 — badges + counts + join date */}
              <div className="rounded-xl border border-neutral-800 bg-black p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {rank !== null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-gradient-to-b from-amber-500/20 to-neutral-950 px-3 py-1 text-xs font-semibold text-amber-300 shadow">
                      ★ #{rank} on the Leaderboard
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-gradient-to-b from-emerald-500/15 to-neutral-950 px-3 py-1 text-xs font-semibold text-emerald-300 shadow">
                    {isSelf ? notesCount : "—"} fighter note{isSelf && notesCount === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-gradient-to-b from-sky-500/15 to-neutral-950 px-3 py-1 text-xs font-semibold text-sky-300 shadow">
                    {picks.length} pick{picks.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-white">
                    <span className="font-semibold">{shownRow?.followers ?? 0}</span>{" "}
                    <span className="text-neutral-400">Followers</span>
                    <span className="mx-2 text-neutral-700">·</span>
                    <span className="font-semibold">{shownRow?.following ?? 0}</span>{" "}
                    <span className="text-neutral-400">Following</span>
                  </p>
                  <p className="text-xs text-neutral-500 shrink-0">
                    Join Date: {joinDate ? fmtDate(joinDate) : "—"}
                  </p>
                </div>
              </div>

              {/* Block 3 — public bets */}
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wide mb-2">
                  Public Bets
                </p>
                {picks.length === 0 ? (
                  <p className="text-sm text-neutral-500">No public bets yet.</p>
                ) : (
                  <div className="space-y-1">
                    {picks.map((b) => (
                      <div key={b.id} className="border-b border-neutral-900 pb-1 last:border-0">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">
                            {b.selection}{" "}
                            <span className="text-neutral-500">
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

              {/* Block 4 — per-window performance */}
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                {periods.map((pr, i) => {
                  const n = pr.w + pr.l + pr.p;
                  const box =
                    n === 0 || pr.units === 0
                      ? "border-neutral-700 bg-neutral-800 text-neutral-400"
                      : pr.units > 0
                      ? "border-emerald-700 bg-emerald-600/20 text-emerald-300"
                      : "border-red-700 bg-red-600/20 text-red-300";
                  return (
                    <div
                      key={pr.label}
                      className={`flex items-center justify-between py-2.5 ${
                        i < periods.length - 1 ? "border-b border-neutral-800/70" : ""
                      }`}
                    >
                      <div>
                        <p className="text-sm text-white">{pr.label}</p>
                        <p className="text-xs text-neutral-500">
                          {pr.w}-{pr.l}-{pr.p}
                        </p>
                      </div>
                      <span
                        className={`rounded-lg border px-2.5 py-1 text-sm font-semibold tabular-nums ${box}`}
                      >
                        {fmtU(pr.units)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
