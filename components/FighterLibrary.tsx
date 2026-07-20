"use client";

import { useState } from "react";
import type { FighterNote, BetRow } from "@/lib/types";
import { betProfit, bookLabel, fmtDate, fmtOdds, fmtUnits, sideBtn } from "@/lib/format";
import { TrashIcon } from "@/components/icons";
import { GrowingTextarea } from "@/components/GrowingTextarea";
import { NOTE_TEMPLATES } from "@/lib/noteTemplates";
import { FIGHTERS_README, InfoButton, ReadMePanel } from "@/components/ReadMe";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      className={`text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function searchMatch(b: { selection: string; event_context: string | null }, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (b.selection ?? "").toLowerCase().includes(s) ||
    (b.event_context ?? "").toLowerCase().includes(s);
}

function typeMatch(b: { bet_type: string | null }, f: string): boolean {
  if (f === "all") return true;
  if (f === "ml") return b.bet_type === "moneyline";
  if (f === "totals") return b.bet_type === "over" || b.bet_type === "under";
  return b.bet_type === f;
}

export function FighterLibrary({
  notes,
  bets,
  onSaveNote,
  onSaveTags,
  onDeleteFighter,
}: {
  notes: Record<string, FighterNote>;
  bets: BetRow[];
  onSaveNote: (fighterId: string, fighterName: string, value: string) => void;
  onSaveTags: (fighterId: string, fighterName: string, raw: string) => void;
  onDeleteFighter: (fighterId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [histFilter, setHistFilter] = useState<
    "all" | "ml" | "totals" | "method" | "round" | "method_round"
  >("all");
  const [nowTs] = useState(() => Date.now());
  const [pickOpen, setPickOpen] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  // each fighter's note starts collapsed; expand them one at a time
  const [openNote, setOpenNote] = useState<Record<string, boolean>>({});

  // your settled/in-progress verified picks, newest first (upcoming excluded)
  const pickHistory = bets
    .filter(
      (b) =>
        b.bet_type !== "other" &&
        !(b.event_start && new Date(b.event_start).getTime() > nowTs)
    )
    .sort((a, b) => (b.placed_at ?? "").localeCompare(a.placed_at ?? ""));

  // only show fighters that still have something: a note, tags, or history
  const all = Object.values(notes).filter((n) => {
    const hasNote = (n.notes ?? "").trim() !== "";
    const hasTags = (n.tags ?? []).length > 0;
    return hasNote || hasTags;
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
      <div className="flex">
        <InfoButton open={showInfo} onClick={() => setShowInfo((v) => !v)} />
      </div>
      {showInfo && <ReadMePanel paragraphs={FIGHTERS_README} />}

      {/* Picks history */}
      <div
        onClick={() => setPickOpen((v) => !v)}
        className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 cursor-pointer"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">
              Picks history
            </span>
            <Chevron open={pickOpen} />
          </div>
          {pickOpen && (
            <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
              {(
                [
                  ["all", "All"],
                  ["ml", "ML"],
                  ["totals", "Totals"],
                  ["method", "Methods"],
                  ["round", "Rounds"],
                  ["method_round", "Methods/Rounds"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setHistFilter(key)}
                  className={sideBtn(histFilter === key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {pickOpen && (
        <div className="space-y-2 mt-3 cursor-auto" onClick={(e) => e.stopPropagation()}>
          <input
            value={pickSearch}
            onChange={(e) => setPickSearch(e.target.value)}
            placeholder="Search picks…"
            className="w-full rounded-md bg-neutral-800/60 border border-neutral-800 px-3 py-1.5 text-xs text-neutral-200 outline-none focus:border-emerald-500 placeholder:text-neutral-600"
          />
          {pickHistory.filter((b) => typeMatch(b, histFilter) && searchMatch(b, pickSearch)).length === 0 && (
            <p className="text-xs text-neutral-600">
              {pickHistory.length === 0
                ? "No settled picks yet - they land here after each event."
                : "No picks in this market."}
            </p>
          )}
          {pickHistory
            .filter((b) => typeMatch(b, histFilter) && searchMatch(b, pickSearch))
            .slice(0, 100)
            .map((b) => (
              <div key={b.id} className="border-b border-neutral-900 pb-1 last:border-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{b.selection}</span>
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
                <div className="flex items-baseline gap-1 text-[11px] min-w-0">
                  <span className="shrink-0 text-neutral-500">
                    {fmtOdds(b.odds)} · {Number(b.stake)}u
                    {b.clv !== null && (
                      <>
                        {" · CLV "}
                        <span className={Number(b.clv) >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {Number(b.clv) >= 0 ? "+" : ""}
                          {Number(b.clv).toFixed(1)}
                        </span>
                      </>
                    )}
                    {b.result !== "pending" && (
                      <>
                        {" · "}
                        <span className={betProfit(b) >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {fmtUnits(betProfit(b))}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="truncate text-neutral-600">
                    {b.book ? `${bookLabel(b.book)} · ` : ""}
                    {b.event_context ? `${b.event_context} · ` : ""}
                    {fmtDate(b.event_date ?? b.placed_at)}
                  </span>
                </div>
              </div>
            ))}
          {pickHistory.filter((b) => typeMatch(b, histFilter) && searchMatch(b, pickSearch)).length > 100 && (
            <p className="text-[11px] text-neutral-600">Showing the latest 100.</p>
          )}
        </div>
        )}
      </div>
      {/* Notes library */}
      <div
        onClick={() => setNotesOpen((v) => !v)}
        className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 cursor-pointer"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">
            Notes history
          </span>
          <Chevron open={notesOpen} />
        </div>
        {notesOpen && (
        <div className="mt-3 space-y-4 cursor-auto" onClick={(e) => e.stopPropagation()}>
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
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-900/60 bg-neutral-900/40 p-4">
            <p className="text-sm font-semibold text-neutral-200">Your scouting book</p>
            <p className="text-xs text-neutral-500 mt-1">
              Every note you type on a fight card files itself here under that fighter -
              and follows them to every future booking, across every org. Tag what
              matters, then search all of it the moment a line drops.
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              Open any fight on the Events tab and start typing in the notes box - the
              fighter appears here instantly.
            </p>
          </div>
          <ExampleFighterCard
            name="Lightweight prospect"
            note={
              "Heavy calf kicks from the opening bell, but the tank dips hard after R2 - " +
              "live dog price against anyone who pressures. Southpaw entries get him " +
              "countered clean."
            }
            tags={["calf-kicks", "fades-late", "southpaw"]}
          />
          <ExampleFighterCard
            name="Regional veteran"
            note={
              "Rehydrates badly at 145 - missed weight twice in the last four. " +
              "Grappling-first, panic-wrestles when hurt. Unders have cashed three straight."
            }
            tags={["weight-miss", "wrestle-first", "unders"]}
          />
        </div>
      )}

      {all.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-neutral-500">
          No fighters match - clear the search{activeTag ? " or the tag filter" : ""}.
        </p>
      )}

      {filtered.map((n) => {
        return (
          <div
            key={n.fighter_id}
            className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3"
          >
            <div
              onClick={() =>
                setOpenNote((prev) => ({
                  ...prev,
                  [n.fighter_id]: !prev[n.fighter_id],
                }))
              }
              className="flex items-center justify-between gap-2 cursor-pointer select-none group"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0 text-neutral-500 group-hover:text-neutral-300">
                  <Chevron open={!!openNote[n.fighter_id]} />
                </span>
                <span className="text-sm font-bold truncate group-hover:text-emerald-400">
                  {n.fighter_name}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {n.updated_at && (
                  <span className="text-[11px] text-neutral-600">
                    updated {formatWhen(n.updated_at)}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFighter(n.fighter_id);
                  }}
                  title="Remove this fighter from your notes"
                  className="rounded-md p-1.5 text-neutral-500 hover:text-red-400 hover:bg-neutral-800"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>

            {openNote[n.fighter_id] && (
              <>
            <GrowingTextarea
              defaultValue={n.notes ?? ""}
              onBlur={(v) => onSaveNote(n.fighter_id, n.fighter_name ?? "", v)}
              templates={NOTE_TEMPLATES}
            />

            <input
              defaultValue={(n.tags ?? []).join(", ")}
              onBlur={(e) => onSaveTags(n.fighter_id, n.fighter_name ?? "", e.target.value)}
              placeholder="Tags (comma-separated)"
              className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
            />

              </>
            )}
          </div>
        );
      })}
        </div>
        )}
      </div>
    </div>
  );
}

function ExampleFighterCard({
  name,
  note,
  tags,
}: {
  name: string;
  note: string;
  tags: string[];
}) {
  return (
    <div
      aria-hidden
      className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-4 space-y-3 select-none"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-neutral-500">{name}</span>
        <span className="text-[10px] uppercase tracking-wide text-neutral-600 border border-neutral-800 rounded px-1.5 py-0.5">
          example
        </span>
      </div>
      <div className="rounded-md bg-neutral-800/40 border border-neutral-700/60 px-2 py-1.5 text-sm text-neutral-500 whitespace-pre-wrap">
        {note}
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span
            key={t}
            className="rounded-full border border-neutral-800 px-3 py-0.5 text-xs text-neutral-600"
          >
            {t}
          </span>
        ))}
      </div>
      <p className="text-xs text-neutral-700">History (2)</p>
    </div>
  );
}
