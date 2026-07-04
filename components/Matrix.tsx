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
import { sortEvents, formatEventMeta, tapologyUrl } from "@/lib/format";
import { GridIcon, DollarIcon } from "@/components/icons";
import { GrowingTextarea } from "@/components/GrowingTextarea";
import { QuickBet } from "@/components/QuickBet";
import { FightMatrix } from "@/components/FightMatrix";
import { FighterLibrary } from "@/components/FighterLibrary";
import { BetTracker } from "@/components/BetTracker";

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
  const [view, setView] = useState<"events" | "fighters" | "bets">("events");
  const [bets, setBets] = useState<BetRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [matrixData, setMatrixData] = useState<Record<string, MatrixData>>({});
  const [openMatrix, setOpenMatrix] = useState<Record<string, boolean>>({});
  const [openBet, setOpenBet] = useState<Record<string, boolean>>({});
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
      .select("id, selection, event_context, event_date, fighter_id, bet_type, prop_method, prop_round, ou_line, event_source_url, odds, stake, result, placed_at, grade_note")
      .order("placed_at", { ascending: false });
    const { data: mx } = await supabase
      .from("user_fight_matrix")
      .select("fight_id, data");
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

    // open all events by default
    setOpenEvents({});
    setLoadingData(false);
  }, []);

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

  // save a fighter's permanent scouting notes (shared across all their fights)
  async function saveFighterNote(
    fighterId: string,
    fighterName: string,
    value: string,
    context: string
  ) {
    const prevNotes = fighterNotes[fighterId]?.notes ?? "";
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

    // snapshot to history whenever the note actually changes
    if (value.trim() !== "" && value.trim() !== prevNotes.trim()) {
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
      .select("id, selection, event_context, event_date, fighter_id, bet_type, prop_method, prop_round, ou_line, event_source_url, odds, stake, result, placed_at, grade_note")
      .single();
    if (b) setBets((prev) => [b, ...prev]);
  }

  // settle / unsettle a bet
  async function setBetResult(id: string, result: string) {
    setBets((prev) => prev.map((b) => (b.id === id ? { ...b, result } : b)));
    await supabase.from("user_bets").update({ result }).eq("id", id);
  }

  // delete a bet
  async function deleteBet(id: string) {
    setBets((prev) => prev.filter((b) => b.id !== id));
    await supabase.from("user_bets").delete().eq("id", id);
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
            <h1 className="text-lg font-bold">Tape Notes</h1>
            <nav className="flex gap-1">
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
                onClick={() => setView("fighters")}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  view === "fighters"
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                    : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                Fighters
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

      {view === "fighters" ? (
        <FighterLibrary
          notes={fighterNotes}
          history={noteHistory}
          onSaveNote={saveFighterNote}
          onSaveTags={saveFighterTags}
          onDeleteHistory={deleteHistoryEntry}
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
        />
      ) : (
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex justify-end">
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
                    return (
                      <div key={f.id} className="relative p-4 space-y-3">
                        <div className="absolute left-2 top-2 flex gap-1">
                          <button
                            onClick={() =>
                              setOpenMatrix((prev) => ({ ...prev, [f.id]: !prev[f.id] }))
                            }
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
                            onClick={() =>
                              setOpenBet((prev) => ({ ...prev, [f.id]: !prev[f.id] }))
                            }
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
                              className="text-sm font-medium text-right truncate hover:text-emerald-400 hover:underline"
                            >
                              {f.fighter1_name}
                            </a>
                            <input
                              defaultValue={d?.price1 ?? ""}
                              onBlur={(e) => saveField(f.id, "price1", e.target.value)}
                              className="w-14 shrink-0 text-center rounded-md bg-neutral-800 border border-neutral-700 px-1 py-1 text-sm focus:border-emerald-500 outline-none"
                            />
                          </div>
                          <span className="text-neutral-600 text-xs px-1 pt-2">VS</span>
                          <div className="flex-1 flex items-center justify-start gap-2">
                            <input
                              defaultValue={d?.price2 ?? ""}
                              onBlur={(e) => saveField(f.id, "price2", e.target.value)}
                              className="w-14 shrink-0 text-center rounded-md bg-neutral-800 border border-neutral-700 px-1 py-1 text-sm focus:border-emerald-500 outline-none"
                            />
                            
                              <a href={tapologyUrl(f.fighter2_name)}
                              target="_blank"
                              rel="noopener noreferrer"
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
                        <div className="grid grid-cols-2 gap-2">
                          {f1id ? (
                            <GrowingTextarea
                              defaultValue={fighterNotes[f1id]?.notes ?? ""}
                              onBlur={(v) =>
                                saveFighterNote(f1id, f.fighter1_name, v, `${ev.org} — ${ev.event_name}`)
                              }
                            />
                          ) : (
                            <GrowingTextarea
                              defaultValue={d?.notes1 ?? ""}
                              onBlur={(v) => saveField(f.id, "notes1", v)}
                            />
                          )}
                          {f2id ? (
                            <GrowingTextarea
                              defaultValue={fighterNotes[f2id]?.notes ?? ""}
                              onBlur={(v) =>
                                saveFighterNote(f2id, f.fighter2_name, v, `${ev.org} — ${ev.event_name}`)
                              }
                            />
                          ) : (
                            <GrowingTextarea
                              defaultValue={d?.notes2 ?? ""}
                              onBlur={(v) => saveField(f.id, "notes2", v)}
                            />
                          )}
                        </div>
                        {openMatrix[f.id] && (
                          <FightMatrix
                            fight={f}
                            data={matrixData[f.id] ?? {}}
                            onSave={(market, cell, value) =>
                              saveMatrixCell(f.id, market, cell, value)
                            }
                          />
                        )}
                        {openBet[f.id] && (
                          <QuickBet
                            fight={f}
                            eventLabel={`${ev.org} — ${ev.event_name}`}
                            eventDate={ev.event_date}
                            eventSourceUrl={ev.source_url}
                            onAdd={addBet}
                            embedded
                          />
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
