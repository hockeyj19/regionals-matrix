"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

const supabase = createClient();

type EventRow = {
  id: string;
  org: string;
  event_name: string;
  event_date: string | null;
  location: string | null;
};

type FightRow = {
  id: string;
  event_id: string;
  fighter1_name: string;
  fighter2_name: string;
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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // auth form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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

  if (!user) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center">Regionals Matrix</h1>
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
  const [openEvents, setOpenEvents] = useState<Record<string, boolean>>({});
  const [loadingData, setLoadingData] = useState(true);

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

    setEvents(ev ?? []);
    setFights(fg ?? []);
    const map: Record<string, UserData> = {};
    (ud ?? []).forEach((row) => (map[row.fight_id] = row));
    setUserData(map);

    // open all events by default
    const open: Record<string, boolean> = {};
    (ev ?? []).forEach((e) => (open[e.id] = true));
    setOpenEvents(open);
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

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold">Regionals Matrix</h1>
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

      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        {loadingData && <p className="text-neutral-500">Loading fights…</p>}
        {!loadingData && events.length === 0 && (
          <p className="text-neutral-500">No events yet.</p>
        )}

        {events.map((ev) => {
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
                  <p className="text-xs text-neutral-500">
                    {ev.event_date} {ev.location ? `· ${ev.location}` : ""}
                  </p>
                </div>
                <span className="text-neutral-500 text-xl">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen && (
                <div className="divide-y divide-neutral-800 border-t border-neutral-800">
                  {evFights.map((f) => {
                    const d = userData[f.id];
                    return (
                      <div key={f.id} className="p-4 space-y-3">
                        {f.is_main_event && (
                          <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                            Main Event
                          </div>
                        )}
                        {/* price + names row */}
                        <div className="flex items-center justify-center gap-2 sm:gap-3">
                          <input
                            defaultValue={d?.price1 ?? ""}
                            onBlur={(e) => saveField(f.id, "price1", e.target.value)}
                            placeholder="–"
                            className="w-16 text-center rounded-md bg-neutral-800 border border-neutral-700 px-1 py-1 text-sm focus:border-emerald-500 outline-none"
                          />
                          <span className="flex-1 text-right text-sm font-medium truncate">
                            {f.fighter1_name}
                          </span>
                          <span className="text-neutral-600 text-xs px-1">VS</span>
                          <span className="flex-1 text-left text-sm font-medium truncate">
                            {f.fighter2_name}
                          </span>
                          <input
                            defaultValue={d?.price2 ?? ""}
                            onBlur={(e) => saveField(f.id, "price2", e.target.value)}
                            placeholder="–"
                            className="w-16 text-center rounded-md bg-neutral-800 border border-neutral-700 px-1 py-1 text-sm focus:border-emerald-500 outline-none"
                          />
                        </div>
                        <div className="text-center text-[11px] text-neutral-600">
                          {f.weight_class}
                        </div>
                        {/* two-column notes */}
                        <div className="grid grid-cols-2 gap-2">
                          <textarea
                            defaultValue={d?.notes1 ?? ""}
                            onBlur={(e) => saveField(f.id, "notes1", e.target.value)}
                            placeholder={`Notes: ${f.fighter1_name}`}
                            rows={3}
                            className="rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs focus:border-emerald-500 outline-none resize-y"
                          />
                          <textarea
                            defaultValue={d?.notes2 ?? ""}
                            onBlur={(e) => saveField(f.id, "notes2", e.target.value)}
                            placeholder={`Notes: ${f.fighter2_name}`}
                            rows={3}
                            className="rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs focus:border-emerald-500 outline-none resize-y"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}