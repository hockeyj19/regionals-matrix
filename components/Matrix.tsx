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
  ReviewRow,
} from "@/lib/types";
import { eventStarted, sortEvents, formatEventMeta, tapologyUrl } from "@/lib/format";
import { GridIcon, DollarIcon } from "@/components/icons";
import { GrowingTextarea } from "@/components/GrowingTextarea";
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
  "UAE Warriors": "text-teal-400",
  Rizin: "text-rose-400",
  ACA: "text-lime-400",
  "ONE Championship": "text-cyan-400",
};

function orgColor(org: string): string {
  return ORG_COLORS[org] ?? "text-emerald-400";
}

function PastNotes({
  history,
  fighterId,
  context,
}: {
  history: NoteHistoryRow[];
  fighterId: string;
  context: string;
}) {
  const past = history.filter(
    (h) =>
      h.fighter_id === fighterId &&
      h.event_context !== context &&
      (h.notes ?? "").trim() !== ""
  );
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
        <p className="text-[11px] text-neutral-600">+{past.length - 3} more in the Notes tab</p>
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

export function Matrix({ user }: { user: User }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [fights, setFights] = useState<FightRow[]>([]);
  const [userData, setUserData] = useState<Record<string, UserData>>({});
  const [fighterNotes, setFighterNotes] = useState<Record<string, FighterNote>>({});
  const [noteHistory, setNoteHistory] = useState<NoteHistoryRow[]>([]);
  const [view, setView] = useState<
    "profile" | "events" | "odds" | "fighters" | "bets" | "leaderboard" | "admin"
  >("events");
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showEventsInfo, setShowEventsInfo] = useState(false);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
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
      .select("id, selection, event_context, event_date, event_start, fighter_id, bet_type, prop_method, prop_round, ou_line, event_source_url, odds, stake, result, placed_at, grade_note, settled_by, delete_requested_at, published_at, book, price_check, market_best, market_book, market_checked_at, close_odds, clv")
      .order("placed_at", { ascending: false });
    const { data: mx } = await supabase
      .from("user_fight_matrix")
      .select("fight_id, data");
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id);
    const { data: rv } = await supabase
      .from("user_fight_review")
      .select(
        "id, fight_id, org, event_name, event_date, fighter1_name, fighter2_name, weight_class, price1, price2, matrix, winner_name, f1_result, method, result_round, result_time"
      )
      .order("event_date", { ascending: false });

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
    setReviews(rv ?? []);
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

  // save a note for a fighter. Each entry belongs to the booking it was
  // written for (the event context): editing during the same booking updates
  // that entry, a new booking gets a fresh one. The profile blob mirrors the
  // latest text so the Fighters tab and its filters keep working.
  async function saveFighterNote(
    fighterId: string,
    fighterName: string,
    value: string,
    context: string
  ) {
    const latest = noteHistory.find((h) => h.fighter_id === fighterId);
    const sameContext = !!latest && (latest.event_context ?? "Library") === context;
    const prevNotes = sameContext && latest ? latest.notes ?? "" : "";
    if (value === prevNotes) return; // nothing changed, don't write

    const now = new Date().toISOString();
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

    if (value.trim() === "") {
      // clearing the box removes this booking's entry
      if (sameContext && latest) {
        setNoteHistory((prev) => prev.filter((h) => h.id !== latest.id));
        await supabase.from("user_fighter_note_history").delete().eq("id", latest.id);
      }
      return;
    }

    if (sameContext && latest) {
      setNoteHistory((prev) =>
        prev.map((h) => (h.id === latest.id ? { ...h, notes: value } : h))
      );
      await supabase
        .from("user_fighter_note_history")
        .update({ notes: value })
        .eq("id", latest.id);
    } else {
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
  function noteFor(fighterId: string, ev: EventRow): string {
    const ctx = `${ev.org} — ${ev.event_name}`;
    const h = noteHistory.find(
      (x) => x.fighter_id === fighterId && x.event_context === ctx
    );
    return h?.notes ?? "";
  }

  // delete a single note-history entry
  async function deleteHistoryEntry(id: string) {
    setNoteHistory((prev) => prev.filter((h) => h.id !== id));
    await supabase.from("user_fighter_note_history").delete().eq("id", id);
  }

  // log a bet (from a fight card or the Bets tab)
  async function addBet(bet: NewBet) {
    const { data: b } = await supabase
      .from("user_bets")
      .insert({ user_id: user.id, ...bet })
      .select("id, selection, event_context, event_date, event_start, fighter_id, bet_type, prop_method, prop_round, ou_line, event_source_url, odds, stake, result, placed_at, grade_note, settled_by, delete_requested_at, published_at, book, price_check, market_best, market_book, market_checked_at, close_odds, clv")
      .single();
    if (b) setBets((prev) => [b, ...prev]);
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
  async function requestBetDelete(id: string, requested: boolean) {
    const stamp = requested ? new Date().toISOString() : null;
    setBets((prev) =>
      prev.map((b) => (b.id === id ? { ...b, delete_requested_at: stamp } : b))
    );
    const { error } = await supabase
      .from("user_bets")
      .update({ delete_requested_at: stamp })
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
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold flex items-center gap-2">
              MMA Matrix
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400 border border-emerald-800 rounded px-1 py-0.5">
                beta
              </span>
            </h1>
            <nav className="flex gap-1">
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
                Events
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
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-400 hidden sm:inline">{user.email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded-lg border border-neutral-700 px-3 py-1 hover:bg-neutral-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {view === "odds" ? (
        <OddsBoard events={events} fights={fights} />
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
          onSaveNote={saveFighterNote}
          onSaveTags={saveFighterTags}
          onDeleteHistory={deleteHistoryEntry}
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
          reviews={reviews}
          events={events}
          fights={fights}
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
                <div>
                  <span className={`text-xs font-semibold uppercase tracking-wide ${orgColor(ev.org)}`}>
                    {ev.org}
                  </span>
                  <h2 className="text-base font-bold">{ev.event_name}</h2>
                  <p className="text-xs text-neutral-500">{formatEventMeta(ev)}</p>
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
                      ? noteFor(f1id, ev).trim()
                      : (d?.notes1 ?? "").trim();
                    const noteB = f2id
                      ? noteFor(f2id, ev).trim()
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
                        className="relative p-4 space-y-3 cursor-pointer hover:bg-neutral-900/30"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenNotes((prev) => ({ ...prev, [f.id]: !expanded }));
                          }}
                          title={expanded ? "Collapse" : "Expand notes & tools"}
                          className={`absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                            expanded
                              ? "border-emerald-700 bg-emerald-600/15 text-emerald-300"
                              : "border-neutral-600 bg-neutral-800 text-neutral-300 hover:border-emerald-700 hover:text-emerald-300"
                          }`}
                        >
                          {expanded ? "Close" : "Expand"}
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
                        {/* names with price beside each */}
                        <div className="flex items-start justify-center gap-2 sm:gap-3">
                          <div className="flex-1 flex items-center justify-end gap-2">
                            
                              <a href={tapologyUrl(f.fighter1_name)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm font-medium text-right truncate hover:text-emerald-400 hover:underline"
                            >
                              {f.fighter1_name}
                            </a>
                            {expanded && (
                              <input
                                defaultValue={d?.price1 ?? ""}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => saveField(f.id, "price1", e.target.value)}
                                className="w-14 shrink-0 text-center rounded-md bg-neutral-800 border border-neutral-700 px-1 py-1 text-sm focus:border-emerald-500 outline-none"
                              />
                            )}
                          </div>
                          <span className="text-neutral-600 text-xs px-1 pt-2">VS</span>
                          <div className="flex-1 flex items-center justify-start gap-2">
                            {expanded && (
                              <input
                                defaultValue={d?.price2 ?? ""}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => saveField(f.id, "price2", e.target.value)}
                                className="w-14 shrink-0 text-center rounded-md bg-neutral-800 border border-neutral-700 px-1 py-1 text-sm focus:border-emerald-500 outline-none"
                              />
                            )}
                            
                              <a href={tapologyUrl(f.fighter2_name)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm font-medium text-left truncate hover:text-emerald-400 hover:underline"
                            >
                              {f.fighter2_name}
                            </a>
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
                                defaultValue={noteFor(f1id, ev)}
                                onBlur={(v) =>
                                  saveFighterNote(f1id, f.fighter1_name, v, `${ev.org} — ${ev.event_name}`)
                                }
                              />
                              <PastNotes
                                history={noteHistory}
                                fighterId={f1id}
                                context={`${ev.org} — ${ev.event_name}`}
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
                                defaultValue={noteFor(f2id, ev)}
                                onBlur={(v) =>
                                  saveFighterNote(f2id, f.fighter2_name, v, `${ev.org} — ${ev.event_name}`)
                                }
                              />
                              <PastNotes
                                history={noteHistory}
                                fighterId={f2id}
                                context={`${ev.org} — ${ev.event_name}`}
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
