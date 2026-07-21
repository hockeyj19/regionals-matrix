"use client";

import type { EventRow, FightRow } from "@/lib/types";
import { matrixCell } from "@/lib/format";
import {
  buildPropSections,
  buildAlwaysShownTemplate,
  ALWAYS_SHOWN_MARKETS,
  propRowLabel,
  propRowKey,
  type PropRow,
} from "@/lib/propBet";
import { cellClv, type BoardML } from "@/lib/matrixBoard";

// A single row's identity + what's currently known about its price. Both the
// always-shown template rows (no live data yet) and the opportunistic,
// live-data-only rows (Total Rounds, Point Spread, etc.) render through this
// same shape, so one row component handles both.
type Row = { key: string; label: string; odds: number | null };

// Non-UFC cards only get the four core categories - three of them (Moneyline,
// Goes The Distance, Method of Victory) still show their full template even
// with no live price yet, since their structure never depends on org. Total
// Rounds is core too, but its line is BetOnline's call, so it stays
// opportunistic for every org, UFC included.
const CORE_SECTION_TITLES = new Set(["Moneyline", "Total Rounds", "Goes The Distance", "Method of Victory"]);

function ClvChip({ typed, board }: { typed: string | undefined; board: number | null }) {
  const clv = cellClv(typed, board);
  if (clv === null) {
    return <span className="block text-[9px] leading-tight text-neutral-700 text-center">—</span>;
  }
  const up = clv >= 0;
  return (
    <span
      className={`block text-[9px] leading-tight text-center font-medium ${
        up ? "text-emerald-400" : "text-red-400"
      }`}
      title="Your price vs BetOnline’s live price"
    >
      {up ? "+" : ""}
      {clv.toFixed(1)}%
    </span>
  );
}

function MatrixRow({
  row,
  data,
  onSave,
}: {
  row: Row;
  data: Record<string, string>;
  onSave: (rowKey: string, value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-neutral-300 truncate flex-1">{row.label}</span>
      <div className="w-14 shrink-0">
        <input
          defaultValue={data[row.key] ?? ""}
          onBlur={(e) => onSave(row.key, e.target.value)}
          className={matrixCell}
        />
        <ClvChip typed={data[row.key]} board={row.odds} />
      </div>
    </div>
  );
}

export function NotesPriceMatrix({
  fight,
  event,
  ml,
  props,
  data,
  onSave,
}: {
  fight: FightRow;
  event: EventRow;
  ml: BoardML | null;
  props: PropRow[];
  data: Record<string, string>;
  onSave: (rowKey: string, value: string) => void;
}) {
  const isUFC = event.org === "UFC";
  const fiveRound = fight.is_main_event || /champ|title/i.test(fight.weight_class ?? "");
  const propFightKey = props[0]?.fight_key ?? "";

  // fast lookup: has BetOnline actually posted a price for this exact row yet?
  const liveByKey = new Map<string, PropRow>();
  for (const p of props) liveByKey.set(propRowKey(p), p);

  type Section = { title: string; rows: Row[] };
  const sections: Section[] = [];

  // Moneyline - always templated, all orgs (structure never depends on data)
  const mlRows: Row[] = [];
  const mlKey1 = propRowKey({ market: "moneyline", fighter: fight.fighter1_name, method: null, round: null, ou_side: null, ou_line: null, outcome: null });
  const mlKey2 = propRowKey({ market: "moneyline", fighter: fight.fighter2_name, method: null, round: null, ou_side: null, ou_line: null, outcome: null });
  mlRows.push({ key: mlKey1, label: fight.fighter1_name, odds: ml?.cur1 ?? null });
  mlRows.push({ key: mlKey2, label: fight.fighter2_name, odds: ml?.cur2 ?? null });
  sections.push({ title: "Moneyline", rows: mlRows });

  // Goes The Distance / Method of Victory (all orgs) + Round Betting /
  // Method + Round (UFC only) - full structure from just the two names and
  // round count, live price merged in wherever BetOnline has posted it
  for (const tmpl of buildAlwaysShownTemplate(fight.fighter1_name, fight.fighter2_name, fiveRound)) {
    if (!isUFC && (tmpl.title === "Round Betting" || tmpl.title === "Method + Round")) continue;
    const rows: Row[] = tmpl.specs.map((spec) => {
      const live = liveByKey.get(spec.key);
      return { key: spec.key, label: live ? propRowLabel(live) : spec.fallbackLabel, odds: live ? live.odds : null };
    });
    sections.push({ title: tmpl.title, rows });
  }

  // everything else - opportunistic, shown only once BetOnline actually
  // posts it. The always-shown markets are excluded here so they don't
  // render twice (once as template, once again from live grouping).
  if (propFightKey) {
    for (const sec of buildPropSections(props, propFightKey)) {
      if (ALWAYS_SHOWN_MARKETS.has(sec.rows[0]?.market)) continue;
      if (!isUFC && !CORE_SECTION_TITLES.has(sec.title)) continue;
      sections.push({
        title: sec.title,
        rows: sec.rows.map((p) => ({ key: propRowKey(p), label: propRowLabel(p), odds: p.odds })),
      });
    }
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 overflow-hidden">
      {sections.map((sec) => (
        <div key={sec.title}>
          <div className="bg-neutral-900/80 px-2 py-1 text-[11px] font-bold text-neutral-100 border-b border-neutral-800">
            {sec.title}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
            {sec.rows.map((row) => (
              <MatrixRow key={row.key} row={row} data={data} onSave={onSave} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
