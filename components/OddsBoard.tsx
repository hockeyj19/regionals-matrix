"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { fmtAmerican, freshness } from "@/lib/board";
import { LineHistoryModal } from "@/components/LineHistoryModal";

/**
 * The Odds board: BetOnline's moneyline for every fight the monitors see,
 * plus how each line has MOVED since it opened - the one thing a multi-book
 * comparison page can't show. Fed entirely by the two BOL bots via the
 * `bol_board` ledger view; single-book by nature (the bots watch BetOnline).
 */

type BoardRow = {
  fight_key: string;
  fighter1: string;
  fighter2: string;
  schedule: string | null;
  open1: number | null;
  open2: number | null;
  cur1: number | null;
  cur2: number | null;
  opened_at: string;
  updated_at: string;
};

// implied win probability from American odds
function impliedProb(odds: number): number {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function Move({ open, cur }: { open: number | null; cur: number | null }) {
  if (open === null || cur === null || open === cur) {
    return <span className="text-[11px] text-neutral-600">no move</span>;
  }
  const shortened = impliedProb(cur) > impliedProb(open); // line firmed = more likely
  const tone = shortened ? "text-emerald-400" : "text-red-400";
  const arrow = shortened ? "▲" : "▼";
  return (
    <span className={`text-[11px] ${tone}`} title="opened → current">
      {arrow} {fmtAmerican(open)} → {fmtAmerican(cur)}
    </span>
  );
}

function FighterLine({
  name,
  open,
  cur,
  onOpen,
}: {
  name: string;
  open: number | null;
  cur: number | null;
  onOpen: () => void;
}) {
  const fav = cur !== null && cur < 0;
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className={`text-sm truncate ${fav ? "text-neutral-100" : "text-neutral-300"}`}>
        {name}
      </span>
      <div className="flex items-center gap-3 shrink-0">
        <Move open={open} cur={cur} />
        <span className="text-xs text-neutral-500 w-10 text-right">
          {cur !== null ? pct(impliedProb(cur)) : "—"}
        </span>
        <button
          onClick={onOpen}
          disabled={cur === null}
          title="Chart this line's movement"
          className={`text-sm font-semibold w-16 text-right rounded px-1 -mx-1 ${
            cur === null
              ? "text-neutral-600 cursor-default"
              : fav
              ? "text-emerald-300 hover:bg-emerald-600/10 hover:underline"
              : "text-neutral-200 hover:bg-neutral-800 hover:underline"
          }`}
        >
          {cur !== null ? fmtAmerican(cur) : "—"}
        </button>
      </div>
    </div>
  );
}

export function OddsBoard() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<
    { fightKey: string; side: 1 | 2; name: string } | null
  >(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("bol_board").select("*");
    setRows((data as BoardRow[]) ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { groups, lastUpdate } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.fighter1.toLowerCase().includes(needle) ||
            r.fighter2.toLowerCase().includes(needle) ||
            (r.schedule ?? "").toLowerCase().includes(needle)
        )
      : rows;
    const byEvent: Record<string, BoardRow[]> = {};
    let last = "";
    for (const r of filtered) {
      const key = r.schedule || "Other";
      (byEvent[key] ??= []).push(r);
      if (r.updated_at > last) last = r.updated_at;
    }
    const order = Object.keys(byEvent).sort((a, b) => {
      // real UFC events first, the non-UFC "Future Events" bucket last
      const af = a === "Future Events" || a === "Other";
      const bf = b === "Future Events" || b === "Other";
      if (af !== bf) return af ? 1 : -1;
      return a.localeCompare(b);
    });
    for (const k of order) {
      byEvent[k].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    }
    return { groups: order.map((k) => [k, byEvent[k]] as const), lastUpdate: last };
  }, [rows, q]);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">BetOnline board</h2>
          <p className="text-[11px] text-neutral-500">
            Live moneylines and how they&rsquo;ve moved since open — straight from the
            line-movement monitors.
            {lastUpdate ? ` Updated ${freshness(lastUpdate)}.` : ""}
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search fighter or event"
          className="w-52 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm outline-none focus:border-emerald-500"
        />
      </div>

      {!loaded && <p className="text-neutral-500">Reading the board…</p>}

      {loaded && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-4">
          <p className="text-sm text-neutral-300">The board is warming up.</p>
          <p className="text-xs text-neutral-600 mt-1">
            Lines appear here as the BetOnline monitors post them — usually within a minute
            of a sweep. If this stays empty, check that both line-movement workers are running.
          </p>
        </div>
      )}

      {loaded && rows.length > 0 && groups.length === 0 && (
        <p className="text-sm text-neutral-500">No fights match “{q}”.</p>
      )}

      {groups.map(([event, fights]) => (
        <div
          key={event}
          className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-neutral-900/60">
            <span className="text-sm font-semibold text-neutral-200">{event}</span>
            <span className="text-[11px] text-neutral-600">
              {fights.length} fight{fights.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="divide-y divide-neutral-900">
            {fights.map((f) => (
              <div key={f.fight_key} className="px-3 py-2">
                <FighterLine
                  name={f.fighter1}
                  open={f.open1}
                  cur={f.cur1}
                  onOpen={() =>
                    setSelected({ fightKey: f.fight_key, side: 1, name: f.fighter1 })
                  }
                />
                <FighterLine
                  name={f.fighter2}
                  open={f.open2}
                  cur={f.cur2}
                  onOpen={() =>
                    setSelected({ fightKey: f.fight_key, side: 2, name: f.fighter2 })
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {selected && (
        <LineHistoryModal
          fightKey={selected.fightKey}
          side={selected.side}
          fighterName={selected.name}
          onClose={() => setSelected(null)}
        />
      )}

      {loaded && rows.length > 0 && (
        <p className="text-[11px] text-neutral-600">
          One book by design — these are BetOnline&rsquo;s lines, the sharp board this platform
          grades against. The movement (open → current) is the edge a static multi-book table
          doesn&rsquo;t show.
        </p>
      )}
    </div>
  );
}
