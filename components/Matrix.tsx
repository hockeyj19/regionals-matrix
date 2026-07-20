"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type {
  EventRow,
  FightRow,
  UserData,
  FighterNote,
  NoteHistoryRow,
  NewBet,
  BetRow,
  MatrixData,
} from "@/lib/types";
import { eventStarted, sortEvents, formatEventMeta, displayTypedOdds, normalizeTypedOdds } from "@/lib/format";
import { GridIcon, DollarIcon, UserIcon } from "@/components/icons";
import { GrowingTextarea } from "@/components/GrowingTextarea";
import { NOTE_TEMPLATES } from "@/lib/noteTemplates";
import { QuickBet } from "@/components/QuickBet";
import { FightMatrix } from "@/components/FightMatrix";
import { FighterLibrary } from "@/components/FighterLibrary";
import { BetTracker } from "@/components/BetTracker";
import { Profile } from "@/components/Profile";
import { OddsBoard } from "@/components/OddsBoard";
import { Leaderboard } from "@/components/Leaderboard";
import { AdminPanel } from "@/components/AdminPanel";
import { EVENTS_README, InfoButton, ReadMePanel } from "@/components/ReadMe";

// per-promotion accent color for event headers
const ORG_COLORS: Record<string, string> = {
  UFC: "text-red-400",
  "Road to UFC": "text-red-300",
  "Dana White's Contender Series": "text-red-300",
  PFL: "text-blue-400",
  LFA: "text-sky-400",
  "Cage Warriors": "text-yellow-400",
  KSW: "text-orange-400",
  Oktagon: "text-pink-400",
  CFFC: "text-purple-400",
  "Brave CF": "text-amber-400",
  "UAE Warriors": "text-yellow-400",
  Rizin: "text-rose-400",
  ACA: "text-lime-400",
  "ONE Championship": "text-pink-400",
};

function orgColor(org: string): string {
  return ORG_COLORS[org] ?? "text-emerald-400";
}

// Promotion badge: a logo-sized tile in the org's brand colour with its
// short mark. If a real logo image is dropped in at public/orgs/<slug>.png it
// fades in over the badge automatically; otherwise the badge stands in. No
// trademark art is reproduced here - just a coloured, lettered placeholder.
const ORG_BADGE: Record<string, { abbr: string; bg: string; fg: string }> = {
  UFC: { abbr: "UFC", bg: "bg-red-600", fg: "text-white" },
  "Road to UFC": { abbr: "RTU", bg: "bg-red-500", fg: "text-white" },
  "Dana White's Contender Series": { abbr: "DWCS", bg: "bg-zinc-600", fg: "text-white" },
  PFL: { abbr: "PFL", bg: "bg-blue-600", fg: "text-white" },
  LFA: { abbr: "LFA", bg: "bg-sky-600", fg: "text-white" },
  "Cage Warriors": { abbr: "CW", bg: "bg-yellow-500", fg: "text-black" },
  KSW: { abbr: "KSW", bg: "bg-orange-600", fg: "text-white" },
  Oktagon: { abbr: "OKT", bg: "bg-pink-600", fg: "text-white" },
  CFFC: { abbr: "CFFC", bg: "bg-purple-600", fg: "text-white" },
  "Brave CF": { abbr: "BRAVE", bg: "bg-amber-600", fg: "text-black" },
  "UAE Warriors": { abbr: "UAE", bg: "bg-yellow-500", fg: "text-white" },
  Rizin: { abbr: "RIZIN", bg: "bg-white", fg: "text-red-600" },
  ACA: { abbr: "ACA", bg: "bg-lime-500", fg: "text-white" },
  "ONE Championship": { abbr: "ONE", bg: "bg-white", fg: "text-black" },
};

function orgSlug(org: string): string {
  return org.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function OrgBadge({ org, size = 44 }: { org: string; size?: number }) {
  const meta =
    ORG_BADGE[org] ?? {
      abbr: org.slice(0, 3).toUpperCase(),
      bg: "bg-neutral-700",
      fg: "text-white",
    };
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const fontClass =
    meta.abbr.length >= 5
      ? "text-[8px]"
      : meta.abbr.length === 4
      ? "text-[10px]"
      : "text-xs";
  return (
    <div
      className={`relative shrink-0 rounded-lg overflow-hidden flex items-center justify-center ring-1 ring-black/20 ${meta.bg} ${meta.fg}`}
      style={{ width: size, height: size }}
      title={org}
    >
      <span
        className={`font-bold uppercase tracking-tight ${fontClass} ${
          logoLoaded ? "opacity-0" : ""
        }`}
      >
        {meta.abbr}
      </span>
      {!logoFailed && (
        <img
          src={`/orgs/${orgSlug(org)}.png`}
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full bg-white object-contain transition-opacity ${
            logoLoaded ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setLogoLoaded(true)}
          onError={() => setLogoFailed(true)}
        />
      )}
    </div>
  );
}

function PastNotes({
  history,
  fighterId,
  current,
}: {
  history: NoteHistoryRow[];
  fighterId: string;
  current: string;
}) {
  // Model A: one note per fighter (shown in the box above). The reference
  // column is the version timeline - earlier, superseded takes on this
  // fighter. Skip the entry that equals the current note and dedupe repeats,
  // so a value can never show as its own "prior version".
  const cur = current.trim();
  const seen = new Set<string>();
  const past = history.filter((h) => {
    if (h.fighter_id !== fighterId) return false;
    const n = (h.notes ?? "").trim();
    if (!n || n === cur || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  if (past.length === 0) return null;
  const shown = past.slice(0, 3);
  return (
    <div className="space-y-1 border-l border-neutral-800 pl-2">
      {shown.map((h) => (
        <p key={h.id} className="text-[11px] text-neutral-500 whitespace-pre-wrap">
          <span className="text-neutral-600">{h.event_context ?? "Library"} · </span>
          {h.notes}
        </p>
      ))}
      {past.length > 3 && (
        <p className="text-[11px] text-neutral-600">+{past.length - 3} earlier version(s)</p>
      )}
    </div>
  );
}

function fightHasMatrix(d?: MatrixData): boolean {
  if (!d) return false;
  return Object.values(d).some((m) =>
    Object.values(m).some((v) => (v ?? "").trim() !== "")
  );
}

function AccountMenu({ email }: { email: string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Account"
        className="rounded-full border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-900 hover:text-emerald-300"
      >
        <UserIcon />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-neutral-800 bg-neutral-950 p-2 shadow-xl">
            {email && (
              <p className="px-2 py-1 text-[11px] text-neutral-500 truncate border-b border-neutral-800 mb-1">
                {email}
              </p>
            )}
            <button
              onClick={() => supabase.auth.signOut()}
              className="w-full text-left rounded-md px-2 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Matrix({ user }: { user: User }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [fights, setFights] = useState<FightRow[]>([]);
  const [userData, setUserData] = useState<Record<string, UserData>>({});
  const [fighterNotes, setFighterNotes] = useState<Record<string, FighterNote>>({});
  const [noteHistory, setNoteHistory] = useState<NoteHistoryRow[]>([]);
  const [view, setView] = useState<
    "profile" | "events" | "odds" | "fighters" | "bets" | "leaderboard" | "admin"
  >("profile");
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showEventsInfo, setShowEventsInfo] = useState(false);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [matrixData, setMatrixData] = useState<Record<string, MatrixData>>({});
  const [openMatrix, setOpenMatrix] = useState<Record<string, boolean>>({});
  const [openBet, setOpenBet] = useState<Record<string, boolean>>({});
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  // always-current mirror of matrixData + ordered save queue: rapid tabbing
  // between cells must never snapshot stale data or land upserts out of order
  const matrixRef = useRef<Record<string, MatrixData>>({});
  const matrixSaveChain = useRef<Promise<unknown>>(Promise.resolve());
  const [openEvents, setOpenEvents] = useState<Record<string, boolean>>({});
  const [loadingData, setLoadingData] = useState(true);
  const [ufcOnly, setUfcOnly] = useState(false);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    const { data: ev } = await supabase
      .from("events")
      .select("*")
      .order("event_date", { ascending: true });
    const { data: fg } = await supabase
      .from("fights")
      .select("*")
      .order("bout_order", { ascending: true });
    const { data: ud } = await supabase
      .from("user_fight_data")
      .select("fight_id, price1, price2, notes1, notes2");
    const { data: fn } = await supabase
      .from("user_fighter_notes")
      .select("fighter_id, fighter_name, notes, tags, updated_at");
    const { data: nh } = await supabase
      .from("user_fighter_note_history")
      .select("id, fighter_id, notes, event_context, created_at")
      .order("created_at", { ascending: false });
    const { data: bt } = await supabase
      .from("user_bets")
      .select("id, selection, event_context, event_date, event_start, fighter_id, bet_type, prop_method, prop_round, ou_line, event_source_url, odds, stake, result, placed_at, grade_note, settled_by, delete_requested_at, delete_reason, published_at, book, price_check, market_best, market_book, market_checked_at, close_odds, clv")
      .order("placed_at", { ascending: false });
    const { data: mx } = await supabase
      .from("user_fight_matrix")
      .select("fight_id, data");
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id);
    setEvents(sortEvents(ev ?? []));
    setFights(fg ?? []);
    const map: Record<string, UserData> = {};
    (ud ?? []).forEach((row) => (map[row.fight_id] = row));
    setUserData(map);

    const nmap: Record<string, FighterNote> = {};
    (fn ?? []).forEach((row) => (nmap[row.fighter_id] = row));
    setFighterNotes(nmap);
    setNoteHistory(nh ?? []);
    setBets(bt ?? []);
    const mmap: Record<string, MatrixData> = {};
    (mx ?? []).forEach((row) => (mmap[row.fight_id] = row.data ?? {}));
    matrixRef.current = mmap;
    setMatrixData(mmap);
    setIsAdmin(prof && prof.length > 0 ? !!prof[0].is_admin : false);

    // open all events by default
    setOpenEvents({});
    setLoadingData(false);
  }, [user.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // save a single field for a fight (debounced via onBlur)
  async function saveField(
    fightId: string,
    field: "price1" | "price2" | "notes1" | "notes2",
    value: string
  ) {
    const existing = userData[fightId] ?? {
      fight_id: fightId,
      price1: null,
      price2: null,
      notes1: null,
      notes2: null,
    };
    const updated = { ...existing, [field]: value };
    setUserData((prev) => ({ ...prev, [fightId]: updated }));

    await supabase.from("user_fight_data").upsert(
      {
        user_id: user.id,
        fight_id: fightId,
        price1: updated.price1,
        price2: updated.price2,
        notes1: updated.notes1,
        notes2: updated.notes2,
      },
      { onConflict: "user_id,fight_id" }
    );
  }

  // Save a fighter note. Model A: a fighter has exactly ONE note, and BOTH the
  // Notes tab and the Library tab read and write this same record - so an edit
  // in either place is the edit everywhere, and the two can never diverge.
  // `user_fighter_notes` is the single source of truth; `event_context` is now
  // only a label recording where a version was written.
  //
  // History is a linear, deduped version log: a new value is appended only when
  // it actually differs from the latest stored version. Writing the same text
  // from Notes and then Library therefore appends nothing the second time -
  // which is precisely what made notes appear to "double" before.
  async function saveFighterNote(
    fighterId: string,
    fighterName: string,
    value: string,
    context: string
  ) {
    const prevNote = fighterNotes[fighterId]?.notes ?? "";
    if (value === prevNote) return; // already the current note - nothing to do

    const now = new Date().toISOString();

    // 1) the single source of truth, read by both tabs
    setFighterNotes((prev) => ({
      ...prev,
      [fighterId]: {
        fighter_id: fighterId,
        fighter_name: fighterName,
        notes: value,
        tags: prev[fighterId]?.tags ?? [],
        updated_at: now,
      },
    }));
    await supabase.from("user_fighter_notes").upsert(
      {
        user_id: user.id,
        fighter_id: fighterId,
        fighter_name: fighterName,
        notes: value,
        updated_at: now,
      },
      { onConflict: "user_id,fighter_id" }
    );

    // 2) version log. Clearing the box is a full delete: the note empties in
    // both tabs (one shared row) and its history is dropped too, so nothing you
    // erased lingers anywhere.
    if (value.trim() === "") {
      await supabase
        .from("user_fighter_note_history")
        .delete()
        .eq("user_id", user.id)
        .eq("fighter_id", fighterId);
      setNoteHistory((prev) => prev.filter((h) => h.fighter_id !== fighterId));
      return;
    }

    const newest = noteHistory.find((h) => h.fighter_id === fighterId);
    if (newest && (newest.notes ?? "") === value) return; // already the latest version

    const { data: h } = await supabase
      .from("user_fighter_note_history")
      .insert({
        user_id: user.id,
        fighter_id: fighterId,
        fighter_name: fighterName,
        notes: value,
        event_context: context,
      })
      .select("id, fighter_id, notes, event_context, created_at")
      .single();
    if (h) setNoteHistory((prev) => [h, ...prev]);
  }

  // save a fighter's tags (comma-separated input -> text[])
  async function saveFighterTags(fighterId: string, fighterName: string, raw: string) {
    const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
    const prevTags = (fighterNotes[fighterId]?.tags ?? []).join(",");
    if (tags.join(",") === prevTags) return; // nothing changed, don't write
    const now = new Date().toISOString();
    setFighterNotes((prev) => ({
      ...prev,
      [fighterId]: {
        fighter_id: fighterId,
        fighter_name: fighterName,
        notes: prev[fighterId]?.notes ?? "",
        tags,
        updated_at: now,
      },
    }));
    await supabase.from("user_fighter_notes").upsert(
      {
        user_id: user.id,
        fighter_id: fighterId,
        fighter_name: fighterName,
        tags,
        updated_at: now,
      },
      { onConflict: "user_id,fighter_id" }
    );
  }

  // the note written for THIS booking (empty for a fresh matchup)
  // Model A: the fighter's single note, shown identically in Notes and Library.
  function noteFor(fighterId: string): string {
    return fighterNotes[fighterId]?.notes ?? "";
  }

  // delete a single note-history entry
  async function deleteHistoryEntry(id: string) {
    setNoteHistory((prev) => prev.filter((h) => h.id !== id));
    await supabase.from("user_fighter_note_history").delete().eq("id", id);
  }

  // remove a fighter from the notes library entirely: the note/tags record and
  // every history entry. Clearing the note text alone leaves the fighter here if
  // it still has history, so this is the way to make it disappear.
  async function deleteFighter(fighterId: string) {
    setFighterNotes((prev) => {
      const next = { ...prev };
      delete next[fighterId];
      return next;
    });
    setNoteHistory((prev) => prev.filter((h) => h.fighter_id !== fighterId));
    await supabase
      .from("user_fighter_notes")
      .delete()
      .eq("user_id", user.id)
      .eq("fighter_id", fighterId);
    await supabase
      .from("user_fighter_note_history")
      .delete()
      .eq("user_id", user.id)
      .eq("fighter_id", fighterId);
  }

  // log a bet (from a fight card or the Bets tab)
  // Returns null on success, or the database's own words on failure. A bet that
  // silently vanishes is worse than no bet at all: the user thinks they have a
  // position they do not have.
  async function addBet(bet: NewBet): Promise<string | null> {
    const { data: b, error } = await supabase
      .from("user_bets")
      .insert({ user_id: user.id, ...bet })
      .select("id, selection, event_context, event_date, event_start, fighter_id, bet_type, prop_method, prop_round, ou_line, event_source_url, odds, stake, result, placed_at, grade_note, settled_by, delete_requested_at, delete_reason, published_at, book, price_check, market_best, market_book, market_checked_at, close_odds, clv")
      .single();
    if (error) return error.message;
    if (!b) return "The bet did not save - please try again.";
    setBets((prev) => [b, ...prev]);
    return null;
  }

  // settle / unsettle a bet. A DB trigger enforces the same rules server-side:
  // no grading before the event starts, and auto-graded results are final.
  async function setBetResult(id: string, result: string) {
    const bet = bets.find((b) => b.id === id);
    if (!bet) return;
    if (bet.settled_by === "auto") return;
    if (result !== "pending" && bet.bet_type !== "other" && !eventStarted(bet.event_start))
      return;
    const settled_by = result === "pending" ? null : "user";
    setBets((prev) => prev.map((b) => (b.id === id ? { ...b, result, settled_by } : b)));
    const { error } = await supabase.from("user_bets").update({ result }).eq("id", id);
    if (error) loadData(); // server said no - resync so the UI stays honest
  }

  // delete a bet - only unverified bets are user-deletable. Verified bets go
  // through a removal request instead (pre-start requests clear on the next
  // scrape; post-start ones need an admin decision).
  async function deleteBet(id: string) {
    const bet = bets.find((b) => b.id === id);
    if (bet && bet.bet_type !== "other") return;
    setBets((prev) => prev.filter((b) => b.id !== id));
    const { error } = await supabase.from("user_bets").delete().eq("id", id);
    if (error) loadData();
  }

  // make a verified pick visible on the public profile before its event
  // starts. One-way by design - a shared pick can't be quietly unshared -
  // and the DB stamps the share time itself, so it can't be backdated.
  async function publishBet(id: string) {
    const stamp = new Date().toISOString();
    setBets((prev) =>
      prev.map((b) => (b.id === id ? { ...b, published_at: stamp } : b))
    );
    const { error } = await supabase
      .from("user_bets")
      .update({ published_at: stamp })
      .eq("id", id);
    if (error) loadData();
  }

  // request (or cancel a request for) removal of a verified bet
  async function requestBetDelete(id: string, requested: boolean, reason?: string) {
    const stamp = requested ? new Date().toISOString() : null;
    const why = requested ? (reason ?? "").trim() || null : null;
    setBets((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, delete_requested_at: stamp, delete_reason: why } : b
      )
    );
    const { error } = await supabase
      .from("user_bets")
      .update({ delete_requested_at: stamp, delete_reason: why })
      .eq("id", id);
    if (error) loadData();
  }

  // save one cell of a fight's handicapping matrix (via ref + ordered queue)
  function saveMatrixCell(fightId: string, market: string, cell: string, value: string) {
    const current = matrixRef.current[fightId] ?? {};
    const updated: MatrixData = {
      ...current,
      [market]: { ...(current[market] ?? {}), [cell]: value },
    };
    matrixRef.current = { ...matrixRef.current, [fightId]: updated };
    setMatrixData((prev) => ({ ...prev, [fightId]: updated }));
    matrixSaveChain.current = matrixSaveChain.current.then(() =>
      supabase.from("user_fight_matrix").upsert(
        {
          user_id: user.id,
          fight_id: fightId,
          data: updated,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,fight_id" }
      )
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2 sm:gap-3">
          <nav className="flex-1 min-w-0 overflow-x-auto flex gap-1 [&>button]:shrink-0">
              <button
                onClick={() => setView("profile")}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  view === "profile"
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                Profile
              </button>
              <button
                onClick={() => setView("events")}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  view === "events"
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                Notes
              </button>
              <button
                onClick={() => setView("bets")}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  view === "bets"
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                Bets
              </button>
              <button
                onClick={() => setView("odds")}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  view === "odds"
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                Odds
              </button>
              <button
                onClick={() => setView("fighters")}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  view === "fighters"
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                Library
              </button>
              <button
                onClick={() => setView("leaderboard")}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  view === "leaderboard"
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                Leaderboard
              </button>
              {isAdmin && (
                <button
                  onClick={() => setView("admin")}
                  className={`rounded-lg border px-3 py-1 text-sm ${
                    view === "admin"
                      ? "border-amber-500 bg-amber-600/20 text-amber-300"
                      : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                  }`}
                >
                  Admin
                </button>
              )}
          </nav>
          <div className="shrink-0">
            <AccountMenu email={user.email} />
          </div>
        </div>
      </header>

      {view === "odds" ? (
        <OddsBoard events={events} fights={fights} userData={userData} />
      ) : view === "profile" ? (
        <Profile
          user={user}
          target={profileUser}
          onViewUser={(u) => setProfileUser(u)}
        />
      ) : view === "fighters" ? (
        <FighterLibrary
          notes={fighterNotes}
          history={noteHistory}
          bets={bets}
          onSaveNote={saveFighterNote}
          onSaveTags={saveFighterTags}
          onDeleteHistory={deleteHistoryEntry}
          onDeleteFighter={deleteFighter}
        />
      ) : view === "admin" && isAdmin ? (
        <AdminPanel />
      ) : view === "leaderboard" ? (
        <Leaderboard
          user={user}
          onOpenProfile={(u) => {
            setProfileUser(u);
            setView("profile");
          }}
        />
      ) : view === "bets" ? (
        <BetTracker
          bets={bets}
          events={events}
          fights={fights}
          fighterNotes={fighterNotes}
          onAdd={addBet}
          onSetResult={setBetResult}
          onDelete={deleteBet}
          onRequestDelete={requestBetDelete}
          onPublish={publishBet}
        />
      ) : (
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <InfoButton open={showEventsInfo} onClick={() => setShowEventsInfo((v) => !v)} />
          <button
            onClick={() => setUfcOnly((v) => !v)}
            className={`rounded-lg border px-3 py-1 text-sm ${
              ufcOnly
                ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
            }`}
          >
            {ufcOnly ? "UFC only ✓" : "UFC only"}
          </button>
        </div>
        {showEventsInfo && <ReadMePanel paragraphs={EVENTS_README} />}

        {loadingData && <p className="text-neutral-500">Loading fights…</p>}
        {!loadingData && events.length === 0 && (
          <p className="text-neutral-500">No events yet.</p>
        )}

        {events
          .filter((ev) => !ufcOnly || ev.org === "UFC")
          .map((ev) => {
          const evFights = fights.filter((f) => f.event_id === ev.id);
          const isOpen = openEvents[ev.id];
          return (
            <div
              key={ev.id}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden"
            >
              <button
                onClick={() =>
                  setOpenEvents((prev) => ({ ...prev, [ev.id]: !prev[ev.id] }))
                }
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/60 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <OrgBadge org={ev.org} />
                  <div className="min-w-0">
                    <span className={`text-xs font-semibold uppercase tracking-wide ${orgColor(ev.org)}`}>
                      {ev.org}
                    </span>
                    <h2 className="text-base font-bold truncate">{ev.event_name}</h2>
                    <p className="text-xs text-neutral-500">{formatEventMeta(ev)}</p>
                  </div>
                </div>
                <span className="text-neutral-500 text-xl">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen && (
                <div className="divide-y divide-neutral-800 border-t border-neutral-800">
                  {evFights.map((f) => {
                    const d = userData[f.id];
                    const f1id = f.fighter1_id;
                    const f2id = f.fighter2_id;
                    const hasMx = fightHasMatrix(matrixData[f.id]);
                    const hasFightBets = bets.some(
                      (b) =>
                        b.fighter_id &&
                        b.event_source_url === ev.source_url &&
                        (b.fighter_id === f.fighter1_id || b.fighter_id === f.fighter2_id)
                    );
                    // a fight's workspace (prices, notes, tools) stays folded
                    // away until it's touched - unless it already holds work
                    const noteA = f1id
                      ? noteFor(f1id).trim()
                      : (d?.notes1 ?? "").trim();
                    const noteB = f2id
                      ? noteFor(f2id).trim()
                      : (d?.notes2 ?? "").trim();
                    const hasWork = !!(
                      (d?.price1 ?? "").trim() ||
                      (d?.price2 ?? "").trim() ||
                      noteA ||
                      noteB ||
                      hasMx ||
                      hasFightBets
                    );
                    const expanded = openNotes[f.id] ?? hasWork;
                    return (
                      <div
                        key={f.id}
                        onClick={() =>
                          setOpenNotes((prev) => ({ ...prev, [f.id]: !expanded }))
                        }
                        className={`relative px-4 pb-4 space-y-3 cursor-pointer hover:bg-neutral-900/30 ${
                          expanded ? "pt-12" : "pt-4"
                        }`}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenNotes((prev) => ({ ...prev, [f.id]: !expanded }));
                          }}
                          title={expanded ? "Collapse" : "Expand notes & tools"}
                          className={`absolute right-2 top-2 z-10 flex items-center rounded-md border p-1.5 ${
                            expanded
                              ? "border-emerald-700 bg-emerald-600/15 text-emerald-300"
                              : "border-neutral-600 bg-neutral-800 text-neutral-300 hover:border-emerald-700 hover:text-emerald-300"
                          }`}
                        >
                          <svg
                            width="14" height="14" viewBox="0 0 24 24" fill="none"
                            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                          >
                            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5"
                              strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        {expanded && (
                        <div className="absolute left-2 top-2 flex gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMatrix((prev) => ({ ...prev, [f.id]: !prev[f.id] }));
                            }}
                            title="Handicapping matrix"
                            className={`rounded-md border p-1.5 ${
                              openMatrix[f.id]
                                ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                                : hasMx
                                ? "border-emerald-700 text-emerald-400 hover:bg-neutral-900"
                                : "border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900"
                            }`}
                          >
                            <GridIcon />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenBet((prev) => ({ ...prev, [f.id]: !prev[f.id] }));
                            }}
                            title="Log a bet"
                            className={`rounded-md border p-1.5 ${
                              openBet[f.id]
                                ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                                : hasFightBets
                                ? "border-emerald-700 text-emerald-400 hover:bg-neutral-900"
                                : "border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900"
                            }`}
                          >
                            <DollarIcon />
                          </button>
                        </div>
                        )}
                        {f.is_main_event && (
                          <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider text-center">
                            Main Event
                          </div>
                        )}
                        {/* names, price stacked underneath each */}
                        <div className="flex items-start justify-center gap-2 sm:gap-3">
                          <div className="flex-1 min-w-0 flex flex-col items-center gap-1">
                            <span className="w-full text-sm font-medium text-center truncate">
                              {f.fighter1_name}
                            </span>
                            {expanded && (
                              <input
                                defaultValue={displayTypedOdds(d?.price1 ?? "")}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => saveField(f.id, "price1", normalizeTypedOdds(e.target.value))}
                                className="w-16 text-center rounded-md bg-neutral-800 border border-neutral-700 px-1 py-1 text-sm focus:border-emerald-500 outline-none"
                              />
                            )}
                          </div>
                          <span className="text-neutral-600 text-xs px-1 pt-0.5">VS</span>
                          <div className="flex-1 min-w-0 flex flex-col items-center gap-1">
                            <span className="w-full text-sm font-medium text-center truncate">
                              {f.fighter2_name}
                            </span>
                            {expanded && (
                              <input
                                defaultValue={displayTypedOdds(d?.price2 ?? "")}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => saveField(f.id, "price2", normalizeTypedOdds(e.target.value))}
                                className="w-16 text-center rounded-md bg-neutral-800 border border-neutral-700 px-1 py-1 text-sm focus:border-emerald-500 outline-none"
                              />
                            )}
                          </div>
                        </div>
                        {f.weight_class && (
                          <div className="text-center text-[11px] text-neutral-600">
                            {f.weight_class}
                          </div>
                        )}
                        {/* per-fighter notes (permanent profile), with a
                            per-fight fallback when a fighter has no stable id */}
                        {expanded && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="grid grid-cols-2 gap-2"
                        >
                          {f1id ? (
                            <div className="space-y-1">
                              <GrowingTextarea
                                defaultValue={noteFor(f1id)}
                                onBlur={(v) =>
                                  saveFighterNote(f1id, f.fighter1_name, v, `${ev.org} — ${ev.event_name}`)
                                }
                                templates={NOTE_TEMPLATES}
                              />
                              <PastNotes
                                history={noteHistory}
                                fighterId={f1id}
                                current={noteFor(f1id)}
                              />
                            </div>
                          ) : (
                            <GrowingTextarea
                              defaultValue={d?.notes1 ?? ""}
                              onBlur={(v) => saveField(f.id, "notes1", v)}
                            />
                          )}
                          {f2id ? (
                            <div className="space-y-1">
                              <GrowingTextarea
                                defaultValue={noteFor(f2id)}
                                onBlur={(v) =>
                                  saveFighterNote(f2id, f.fighter2_name, v, `${ev.org} — ${ev.event_name}`)
                                }
                                templates={NOTE_TEMPLATES}
                              />
                              <PastNotes
                                history={noteHistory}
                                fighterId={f2id}
                                current={noteFor(f2id)}
                              />
                            </div>
                          ) : (
                            <GrowingTextarea
                              defaultValue={d?.notes2 ?? ""}
                              onBlur={(v) => saveField(f.id, "notes2", v)}
                            />
                          )}
                        </div>
                        )}
                        {expanded && openMatrix[f.id] && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <FightMatrix
                              fight={f}
                              data={matrixData[f.id] ?? {}}
                              onSave={(market, cell, value) =>
                                saveMatrixCell(f.id, market, cell, value)
                              }
                            />
                          </div>
                        )}
                        {expanded && openBet[f.id] && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <QuickBet
                              fight={f}
                              eventLabel={`${ev.org} — ${ev.event_name}`}
                              eventDate={ev.event_date}
                              eventTime={ev.event_time}
                              eventSourceUrl={ev.source_url}
                              onAdd={addBet}
                              fighterNotes={fighterNotes}
                              embedded
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </main>
  );
}
