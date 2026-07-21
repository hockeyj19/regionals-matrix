"use client";

import type { EventRow, FightRow } from "@/lib/types";
import { matrixCell } from "@/lib/format";
import {
  buildPropSections,
  propRowLabel,
  propRowKey,
  type PropRow,
  type PropSection,
} from "@/lib/propBet";
import { cellClv, type BoardML } from "@/lib/matrixBoard";

// Non-UFC cards only get the headline four sections - the full sheet (Round
// Betting, Method + Round, Point Spread, and the rest) is UFC-only for now.
const CORE_ONLY_TITLES = new Set(["Moneyline", "Total Rounds", "Goes The Distance", "Method of Victory"]);

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
  p,
  data,
  onSave,
}: {
  p: PropRow;
  data: Record<string, string>;
  onSave: (rowKey: string, value: string) => void;
}) {
  const key = propRowKey(p);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-neutral-300 truncate flex-1">{propRowLabel(p)}</span>
      <div className="w-14 shrink-0">
        <input
          defaultValue={data[key] ?? ""}
          onBlur={(e) => onSave(key, e.target.value)}
          className={matrixCell}
        />
        <ClvChip typed={data[key]} board={p.odds} />
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
  // this fight's live moneyline (from bol_board), or null if it's not posted
  ml: BoardML | null;
  // this fight's live prop rows (from bol_current_props), already matched
  props: PropRow[];
  data: Record<string, string>;
  onSave: (rowKey: string, value: string) => void;
}) {
  const isUFC = event.org === "UFC";
  const propFightKey = props[0]?.fight_key ?? "";
  let sections: PropSection[] = propFightKey ? buildPropSections(props, propFightKey) : [];

  // moneyline isn't in the props feed at all (separate table) - synthesize
  // its own section from the board row and put it first, matching how a
  // sportsbook's own page always leads with the moneyline.
  const mlRows: PropRow[] = [];
  if (ml?.cur1 !== null && ml?.cur1 !== undefined) {
    mlRows.push({
      fight_key: fight.id,
      market: "moneyline",
      fighter: fight.fighter1_name,
      method: null,
      round: null,
      ou_side: null,
      ou_line: null,
      odds: ml.cur1,
      outcome: null,
    });
  }
  if (ml?.cur2 !== null && ml?.cur2 !== undefined) {
    mlRows.push({
      fight_key: fight.id,
      market: "moneyline",
      fighter: fight.fighter2_name,
      method: null,
      round: null,
      ou_side: null,
      ou_line: null,
      odds: ml.cur2,
      outcome: null,
    });
  }
  if (mlRows.length) sections = [{ title: "Moneyline", rows: mlRows }, ...sections];

  if (!isUFC) sections = sections.filter((sec) => CORE_ONLY_TITLES.has(sec.title));

  if (sections.length === 0) {
    return (
      <p className="text-xs text-neutral-600 px-1">
        No BetOnline prices posted for this fight yet - check back closer to the card.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 overflow-hidden">
      {sections.map((sec) => (
        <div key={sec.title}>
          <div className="bg-neutral-900/80 px-2 py-1 text-[11px] font-bold text-neutral-100 border-b border-neutral-800">
            {sec.title}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
            {sec.rows.map((p, i) => (
              <MatrixRow key={i} p={p} data={data} onSave={onSave} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
