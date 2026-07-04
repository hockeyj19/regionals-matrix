"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

const supabase = createClient();

const SITE_URL = "https://regionals-matrix.vercel.app";

type EventRow = {
  id: string;
  org: string;
  event_name: string;
  event_date: string | null;
  event_time: string | null;
  location: string | null;
  source_url: string | null;
};

type FightRow = {
  id: string;
  event_id: string;
  fighter1_name: string;
  fighter2_name: string;
  fighter1_id: string | null;
  fighter2_id: string | null;
  weight_class: string | null;
  is_main_event: boolean;
  bout_order: number | null;
};

type UserData = {
  fight_id: string;
  price1: string | null;
  price2: string | null;
  notes1: string | null;
  notes2: string | null;
};

type FighterNote = {
  fighter_id: string;
  fighter_name: string | null;
  notes: string | null;
  tags: string[] | null;
  updated_at: string | null;
};

type NoteHistoryRow = {
  id: string;
  fighter_id: string;
  notes: string | null;
  event_context: string | null;
  created_at: string;
};

type NewBet = {
  selection: string;
  event_context: string | null;
  event_date: string | null;
  fighter_id: string | null;
  bet_type: string;
  prop_method: string | null;
  prop_round: number | null;
  ou_line: number | null;
  event_source_url: string | null;
  odds: number;
  stake: number;
};

type BetRow = NewBet & {
  id: string;
  result: string;
  placed_at: string;
  grade_note: string | null;
};

// "2026-06-26" -> "Friday, June 26th"
// Convert "7:00 PM ET" -> minutes since midnight, for sorting. No time sorts last.
function timeToMinutes(t: string | null): number {
  if (!t) return 99999;
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 99999;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const pm = m[3].toUpperCase() === "PM";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return h * 60 + min;
}

// Sort events by date, then by start time within the same date.
function sortEvents(rows: EventRow[]): EventRow[] {
  return [...rows].sort((a, b) => {
    const da = a.event_date ?? "";
    const db = b.event_date ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return timeToMinutes(a.event_time) - timeToMinutes(b.event_time);
  });
}
function formatEventDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = dt.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const suffix =
    d % 10 === 1 && d !== 11 ? "st" :
    d % 10 === 2 && d !== 12 ? "nd" :
    d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${weekday}, ${month} ${d}${suffix}`;
}

// Build the "Friday, June 26th, 9:00 AM ET · Location" line.
function formatEventMeta(ev: EventRow): string {
  const parts: string[] = [];
  const date = formatEventDate(ev.event_date);
  if (date) parts.push(date);
  if (ev.event_time) parts[parts.length - 1] = `${parts[parts.length - 1]}, ${ev.event_time}`;
  const left = parts.join("");
  return ev.location ? `${left} · ${ev.location}` : left;
}

// Link a fighter name to a Tapology search for that fighter.
function tapologyUrl(name: string): string {
  return `https://www.tapology.com/search?term=${encodeURIComponent(name)}&mainSearchFilter=fighters`;
}

// American-odds profit (in units) for a settled bet; pending/push = 0
function betProfit(b: BetRow): number {
  if (b.result === "win")
    return Number(b.stake) * (b.odds > 0 ? b.odds / 100 : 100 / Math.abs(b.odds));
  if (b.result === "loss") return -Number(b.stake);
  return 0;
}

function fmtOdds(o: number): string {
  return o > 0 ? `+${o}` : `${o}`;
}

function fmtUnits(u: number): string {
  const r = Math.round(u * 100) / 100;
  return `${r > 0 ? "+" : ""}${r}u`;
}

function fmtDate(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// validate American odds + units inputs; returns parsed values or an error string
function parseBetInputs(odds: string, stake: string): { odds: number; stake: number } | string {
  const o = parseInt(odds, 10);
  const s = parseFloat(stake);
  if (isNaN(o) || Math.abs(o) < 100) return "Odds must be American, e.g. -150 or +130.";
  if (isNaN(s) || s <= 0) return "Units must be a positive number.";
  return { odds: o, stake: s };
}

function sideBtn(active: boolean): string {
  return `rounded-md border px-2 py-1 text-xs truncate ${
    active
      ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
      : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
  }`;
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

// Textarea that grows with its content instead of scrolling.
function GrowingTextarea({
  defaultValue,
  onBlur,
}: {
  defaultValue: string;
  onBlur: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [resize]);

  return (
    <textarea
      ref={ref}
      defaultValue={defaultValue}
      onInput={resize}
      onBlur={(e) => onBlur(e.target.value)}
      rows={3}
      className="w-full overflow-hidden rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs focus:border-emerald-500 outline-none resize-none"
    />
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // auth form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");

  // password reset state
  const [recovery, setRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecovery(true);
      }
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleForgotPassword() {
    if (!email) {
      setMessage("Enter your email above first, then click Forgot password.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: SITE_URL,
    });
    setMessage(error ? error.message : "Password reset email sent — check your inbox (and spam).");
  }

  async function handleSetNewPassword() {
    setMessage("");
    if (newPassword.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setMessage(error.message);
    } else {
      setRecovery(false);
      setNewPassword("");
      setMessage("Password updated — you're signed in.");
    }
  }

  async function handleAuth() {
    setMessage("");
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      setMessage(error ? error.message : "Account created — you're in.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        Loading…
      </main>
    );
  }

  if (recovery) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center">Set a new password</h1>
          <input
            type="password"
            placeholder="New password (min 6 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-500"
          />
          <button
            onClick={handleSetNewPassword}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 font-medium"
          >
            Update password
          </button>
          {message && <p className="text-center text-sm text-amber-400">{message}</p>}
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center">Tape Notes</h1>
          <p className="text-center text-neutral-400 text-sm">
            {mode === "signin" ? "Sign in to your account" : "Create an account"}
          </p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-500"
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-500"
          />
          <button
            onClick={handleAuth}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 font-medium"
          >
            {mode === "signin" ? "Sign in" : "Sign up"}
          </button>
          {message && <p className="text-center text-sm text-amber-400">{message}</p>}
          {mode === "signin" && (
            <button
              onClick={handleForgotPassword}
              className="w-full text-sm text-neutral-400 hover:text-neutral-200"
            >
              Forgot password?
            </button>
          )}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage("");
            }}
            className="w-full text-sm text-neutral-400 hover:text-neutral-200"
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </main>
    );
  }

  return <Matrix user={user} />;
}

function Matrix({ user }: { user: User }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [fights, setFights] = useState<FightRow[]>([]);
  const [userData, setUserData] = useState<Record<string, UserData>>({});
  const [fighterNotes, setFighterNotes] = useState<Record<string, FighterNote>>({});
  const [noteHistory, setNoteHistory] = useState<NoteHistoryRow[]>([]);
  const [view, setView] = useState<"events" | "fighters" | "bets">("events");
  const [bets, setBets] = useState<BetRow[]>([]);
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
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
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
                    return (
                      <div key={f.id} className="p-4 space-y-3">
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
                        <QuickBet
                          fight={f}
                          eventLabel={`${ev.org} — ${ev.event_name}`}
                          eventDate={ev.event_date}
                          eventSourceUrl={ev.source_url}
                          onAdd={addBet}
                        />
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

function FighterLibrary({
  notes,
  history,
  onSaveNote,
  onSaveTags,
  onDeleteHistory,
}: {
  notes: Record<string, FighterNote>;
  history: NoteHistoryRow[];
  onSaveNote: (fighterId: string, fighterName: string, value: string, context: string) => void;
  onSaveTags: (fighterId: string, fighterName: string, raw: string) => void;
  onDeleteHistory: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});

  // only show fighters that still have something: a note, tags, or history
  const all = Object.values(notes).filter((n) => {
    const hasNote = (n.notes ?? "").trim() !== "";
    const hasTags = (n.tags ?? []).length > 0;
    const hasHistory = history.some((h) => h.fighter_id === n.fighter_id);
    return hasNote || hasTags || hasHistory;
  });
  const allTags = Array.from(new Set(all.flatMap((n) => n.tags ?? []))).sort();

  const needle = q.trim().toLowerCase();
  const filtered = all
    .filter((n) => {
      if (activeTag && !(n.tags ?? []).includes(activeTag)) return false;
      if (!needle) return true;
      const hay = `${n.fighter_name ?? ""} ${n.notes ?? ""} ${(n.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    })
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));

  function formatWhen(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search fighters, notes, tags"
        className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      />

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
              className={`rounded-full border px-3 py-0.5 text-xs ${
                activeTag === t
                  ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                  : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        {filtered.length} fighter{filtered.length === 1 ? "" : "s"}
      </p>

      {all.length === 0 && (
        <p className="text-neutral-500">
          No fighter notes yet. Write some on the Events tab and they will collect here.
        </p>
      )}

      {filtered.map((n) => {
        const fh = history.filter((h) => h.fighter_id === n.fighter_id);
        const isOpen = openHistory[n.fighter_id];
        return (
          <div
            key={n.fighter_id}
            className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <a
                href={tapologyUrl(n.fighter_name ?? "")}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold hover:text-emerald-400 hover:underline"
              >
                {n.fighter_name}
              </a>
              {n.updated_at && (
                <span className="text-[11px] text-neutral-600">
                  updated {formatWhen(n.updated_at)}
                </span>
              )}
            </div>

            <GrowingTextarea
              defaultValue={n.notes ?? ""}
              onBlur={(v) => onSaveNote(n.fighter_id, n.fighter_name ?? "", v, "Library")}
            />

            <input
              defaultValue={(n.tags ?? []).join(", ")}
              onBlur={(e) => onSaveTags(n.fighter_id, n.fighter_name ?? "", e.target.value)}
              placeholder="Tags (comma-separated)"
              className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
            />

            {fh.length > 0 && (
              <div>
                <button
                  onClick={() =>
                    setOpenHistory((prev) => ({
                      ...prev,
                      [n.fighter_id]: !prev[n.fighter_id],
                    }))
                  }
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  {isOpen ? "Hide history" : `History (${fh.length})`}
                </button>
                {isOpen && (
                  <div className="mt-2 space-y-2 border-l border-neutral-800 pl-3">
                    {fh.map((h) => (
                      <div key={h.id} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-neutral-600">
                            {formatWhen(h.created_at)}
                            {h.event_context ? ` · ${h.event_context}` : ""}
                          </div>
                          <button
                            onClick={() => onDeleteHistory(h.id)}
                            title="Delete this entry"
                            className="shrink-0 rounded-md p-1.5 text-neutral-500 hover:text-red-400 hover:bg-neutral-800"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                        <div className="text-neutral-400 whitespace-pre-wrap">{h.notes}</div>
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
  );
}

const BET_TYPE_OPTIONS = [
  { key: "moneyline", label: "ML" },
  { key: "method", label: "Method" },
  { key: "round", label: "Round" },
  { key: "method_round", label: "Method+Rd" },
  { key: "over", label: "Over" },
  { key: "under", label: "Under" },
];

function QuickBet({
  fight,
  eventLabel,
  eventDate,
  eventSourceUrl,
  onAdd,
}: {
  fight: FightRow;
  eventLabel: string;
  eventDate: string | null;
  eventSourceUrl: string | null;
  onAdd: (bet: NewBet) => void;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<1 | 2>(1);
  const [betType, setBetType] = useState("moneyline");
  const [method, setMethod] = useState("ko_tko");
  const [round, setRound] = useState("");
  const [line, setLine] = useState("2.5");
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [error, setError] = useState("");

  const needsSide = betType !== "over" && betType !== "under";
  const needsMethod = betType === "method" || betType === "method_round";
  const needsRound = betType === "round" || betType === "method_round";
  const needsLine = betType === "over" || betType === "under";

  function pickType(t: string) {
    setBetType(t);
    setError("");
    if (t === "method_round" && method === "decision") setMethod("ko_tko");
  }

  function submit() {
    const parsed = parseBetInputs(odds, stake);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    let propRound: number | null = null;
    if (needsRound) {
      propRound = parseInt(round, 10);
      if (isNaN(propRound) || propRound < 1 || propRound > 5) {
        setError("Round must be 1-5.");
        return;
      }
    }
    let ouLine: number | null = null;
    if (needsLine) {
      ouLine = parseFloat(line);
      if (isNaN(ouLine) || ouLine <= 0 || Math.round(ouLine * 2) % 2 !== 1) {
        setError("Use a half line like 1.5 or 2.5.");
        return;
      }
    }
    const name = side === 1 ? fight.fighter1_name : fight.fighter2_name;
    const fid = side === 1 ? fight.fighter1_id : fight.fighter2_id;
    const methodLabel =
      method === "ko_tko" ? "KO/TKO" : method === "submission" ? "Submission" : "Decision";
    let selection = name;
    if (betType === "method") selection = `${name} by ${methodLabel}`;
    else if (betType === "round") selection = `${name} in R${propRound}`;
    else if (betType === "method_round") selection = `${name} by ${methodLabel} in R${propRound}`;
    else if (betType === "over" || betType === "under")
      selection = `${betType === "over" ? "Over" : "Under"} ${ouLine} — ${fight.fighter1_name} vs ${fight.fighter2_name}`;
    onAdd({
      selection,
      event_context: eventLabel,
      event_date: eventDate,
      // for over/under bets the fighter id is just a bout locator for the grader
      fighter_id: needsSide ? fid : fight.fighter1_id ?? fight.fighter2_id,
      bet_type: betType,
      prop_method: needsMethod ? method : null,
      prop_round: propRound,
      ou_line: ouLine,
      event_source_url: eventSourceUrl,
      odds: parsed.odds,
      stake: parsed.stake,
    });
    setOpen(false);
    setSide(1);
    setBetType("moneyline");
    setOdds("");
    setStake("");
    setRound("");
    setLine("2.5");
    setError("");
  }

  if (!open) {
    return (
      <div className="text-center">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-neutral-500 hover:text-emerald-400"
        >
          + Log bet
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 space-y-2">
      <div className="flex flex-wrap gap-1">
        {BET_TYPE_OPTIONS.map((t) => (
          <button key={t.key} onClick={() => pickType(t.key)} className={sideBtn(betType === t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {needsSide && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setSide(1)} className={sideBtn(side === 1)}>
            {fight.fighter1_name}
          </button>
          <button onClick={() => setSide(2)} className={sideBtn(side === 2)}>
            {fight.fighter2_name}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {needsMethod && (
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
          >
            <option value="ko_tko">KO/TKO</option>
            <option value="submission">Submission</option>
            {betType !== "method_round" && <option value="decision">Decision</option>}
          </select>
        )}
        {needsRound && (
          <input
            value={round}
            onChange={(e) => setRound(e.target.value)}
            placeholder="Rd (1-5)"
            className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
          />
        )}
        {needsLine && (
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="Line (2.5)"
            className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
          />
        )}
        <input
          value={odds}
          onChange={(e) => setOdds(e.target.value)}
          placeholder="Odds (-150)"
          className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
        />
        <input
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          placeholder="Units"
          className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
        />
        <button
          onClick={submit}
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-medium"
        >
          Save
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError("");
          }}
          className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  );
}

function BetTracker({
  bets,
  onAdd,
  onSetResult,
  onDelete,
}: {
  bets: BetRow[];
  onAdd: (bet: NewBet) => void;
  onSetResult: (id: string, result: string) => void;
  onDelete: (id: string) => void;
}) {
  const [selection, setSelection] = useState("");
  const [context, setContext] = useState("");
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [error, setError] = useState("");

  const settled = bets.filter((b) => b.result !== "pending");
  const wins = settled.filter((b) => b.result === "win").length;
  const losses = settled.filter((b) => b.result === "loss").length;
  const pushes = settled.filter((b) => b.result === "push").length;
  const staked = settled.reduce((s, b) => s + Number(b.stake), 0);
  const profit = settled.reduce((s, b) => s + betProfit(b), 0);
  const roi = staked > 0 ? (profit / staked) * 100 : 0;
  const pendingCount = bets.length - settled.length;

  // ROI over time: month buckets by event date (falls back to when placed)
  const months: Record<string, { staked: number; profit: number; n: number }> = {};
  settled.forEach((b) => {
    const key = (b.event_date ?? b.placed_at).slice(0, 7);
    if (!months[key]) months[key] = { staked: 0, profit: 0, n: 0 };
    months[key].staked += Number(b.stake);
    months[key].profit += betProfit(b);
    months[key].n += 1;
  });
  const monthKeys = Object.keys(months).sort();

  function submit() {
    if (!selection.trim()) {
      setError("Enter what the bet is on.");
      return;
    }
    const parsed = parseBetInputs(odds, stake);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    onAdd({
      selection: selection.trim(),
      event_context: context.trim() || null,
      event_date: null,
      fighter_id: null,
      bet_type: "other",
      prop_method: null,
      prop_round: null,
      ou_line: null,
      event_source_url: null,
      odds: parsed.odds,
      stake: parsed.stake,
    });
    setSelection("");
    setContext("");
    setOdds("");
    setStake("");
    setError("");
  }

  const profitTone = profit >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Record</p>
          <p className="text-lg font-bold">{wins}-{losses}-{pushes}</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Units staked</p>
          <p className="text-lg font-bold">{Math.round(staked * 100) / 100}u</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Profit</p>
          <p className={`text-lg font-bold ${profitTone}`}>{fmtUnits(profit)}</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide">ROI</p>
          <p className={`text-lg font-bold ${profitTone}`}>
            {roi >= 0 ? "+" : ""}{roi.toFixed(1)}%
          </p>
        </div>
      </div>
      {pendingCount > 0 && (
        <p className="text-xs text-neutral-500">
          {pendingCount} pending bet{pendingCount === 1 ? "" : "s"} not counted above.
        </p>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Log a bet</p>
        <input
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          placeholder="Selection (e.g. McGregor ML, over 2.5 rounds)"
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
        />
        <div className="flex gap-2">
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Event (optional)"
            className="flex-1 min-w-0 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <input
            value={odds}
            onChange={(e) => setOdds(e.target.value)}
            placeholder="Odds (-150)"
            className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <input
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            placeholder="Units"
            className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={submit}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-sm font-medium"
          >
            Add
          </button>
        </div>
        {error && <p className="text-xs text-amber-400">{error}</p>}
      </div>

      {monthKeys.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
            ROI by month
          </p>
          <div className="space-y-1">
            {monthKeys.map((m) => {
              const v = months[m];
              const mroi = v.staked > 0 ? (v.profit / v.staked) * 100 : 0;
              return (
                <div key={m} className="flex items-center justify-between text-xs gap-2">
                  <span className="text-neutral-400 w-16 shrink-0">{m}</span>
                  <span className="text-neutral-600 flex-1 text-center">
                    {v.n} bet{v.n === 1 ? "" : "s"} · {Math.round(v.staked * 100) / 100}u
                  </span>
                  <span className={v.profit >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {fmtUnits(v.profit)} ({mroi >= 0 ? "+" : ""}{mroi.toFixed(1)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bets.length === 0 && (
        <p className="text-neutral-500">
          No bets logged yet. Add one above, or use the + Log bet button on any fight card.
        </p>
      )}

      {bets.map((b) => {
        const p = betProfit(b);
        return (
          <div key={b.id} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {b.selection}{" "}
                  <span className="text-neutral-500">
                    {fmtOdds(b.odds)} · {Number(b.stake)}u
                  </span>
                </p>
                <p className="text-[11px] text-neutral-600 truncate">
                  {b.event_context ? `${b.event_context} · ` : ""}
                  {fmtDate(b.event_date ?? b.placed_at)}
                </p>
                {b.grade_note && (
                  <p className="text-[11px] text-neutral-500 italic truncate">{b.grade_note}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {b.result !== "pending" && (
                  <span className={`text-xs mr-1 ${p >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtUnits(p)}
                  </span>
                )}
                <button
                  onClick={() => onSetResult(b.id, b.result === "win" ? "pending" : "win")}
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                    b.result === "win"
                      ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                      : "border-neutral-700 text-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  W
                </button>
                <button
                  onClick={() => onSetResult(b.id, b.result === "loss" ? "pending" : "loss")}
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                    b.result === "loss"
                      ? "border-red-500 bg-red-600/20 text-red-300"
                      : "border-neutral-700 text-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  L
                </button>
                <button
                  onClick={() => onSetResult(b.id, b.result === "push" ? "pending" : "push")}
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                    b.result === "push"
                      ? "border-amber-500 bg-amber-600/20 text-amber-300"
                      : "border-neutral-700 text-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  P
                </button>
                <button
                  onClick={() => onDelete(b.id)}
                  title="Delete bet"
                  className="shrink-0 rounded-md p-1.5 text-neutral-500 hover:text-red-400 hover:bg-neutral-800"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}