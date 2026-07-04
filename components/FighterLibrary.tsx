"use client";

import { useState } from "react";
import type { FighterNote, NoteHistoryRow } from "@/lib/types";
import { tapologyUrl } from "@/lib/format";
import { TrashIcon } from "@/components/icons";
import { GrowingTextarea } from "@/components/GrowingTextarea";
import { FIGHTERS_README, InfoButton, ReadMePanel } from "@/components/ReadMe";

export function FighterLibrary({
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
  const [showInfo, setShowInfo] = useState(false);
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
      <div className="flex">
        <InfoButton open={showInfo} onClick={() => setShowInfo((v) => !v)} />
      </div>
      {showInfo && <ReadMePanel paragraphs={FIGHTERS_README} />}
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
