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
import {
  buildPointSpreadRows,
  buildSigStrikesRows,
  buildTotalRoundsRows,
  buildTotalTakedownsRows,
  fmtLineDiff,
  isFiveRound,
  lineDiff,
  type PresetDiffRow,
  type PresetPriceRow,
} from "@/lib/manualProps";

// Non-UFC cards only get the headline four live sections - the full sheet
// (Round Betting, Method + Round, and the rest) is UFC-only for now. Total
// Rounds is handled as its own always-on manual block below, not through
// this list, so it isn't named here anymore.
const CORE_ONLY_TITLES = new Set(["Moneyline", "Goes The Distance", "Method of Victory"]);

// These four markets are rendered entirely by the manual preset blocks below
// instead of straight off the live feed, and Specials never renders at all -
// so all five are stripped out of the live board data before section-building.
const FULLY_MANUAL_MARKETS = new Set([
  "total",
  "point_spread",
  "total_significant_strikes",
  "total_takedowns",
  "specials",
]);

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
      title="Your price vs BetOnline's live price"
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

// A preset row that isn't tied to a live PropRow - Total Rounds / Point
// Spread / Total Takedowns lines that are always available regardless of
// what BetOnline has posted, priced manually with a CLV chip against the
// board when a matching line is live.
function PresetRow({
  row,
  data,
  onSave,
}: {
  row: PresetPriceRow;
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
        <ClvChip typed={data[row.key]} board={row.board} />
      </div>
    </div>
  );
}

// Total Sig Strikes: no price at all, just the user's own line vs BetOnline's,
// shown as a plain strike-count difference.
function DiffRow({
  row,
  data,
  onSave,
}: {
  row: PresetDiffRow;
  data: Record<string, string>;
  onSave: (rowKey: string, value: string) => void;
}) {
  const diff = lineDiff(data[row.key], row.boardLine);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-neutral-300 truncate flex-1">{row.label}</span>
      <div className="w-14 shrink-0">
        <input
          defaultValue={data[row.key] ?? ""}
          onBlur={(e) => onSave(row.key, e.target.value)}
          placeholder="line"
          inputMode="decimal"
          className={matrixCell}
        />
        <span
          className="block text-[9px] leading-tight text-center font-medium text-neutral-400"
          title="Difference from BetOnline's own line, in strikes"
        >
          {diff === null ? "—" : `Δ ${fmtLineDiff(diff)}`}
        </span>
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="bg-neutral-900/80 px-2 py-1 text-[11px] font-bold text-neutral-100 border-b border-neutral-800">
      {title}
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
  const fiveRound = isFiveRound(fight);
  const propFightKey = props[0]?.fight_key ?? "";

  // strip the fully-manual markets out of the live feed before building the
  // ordinary board-driven sections, so nothing renders twice
  const liveOnlyProps = props.filter((p) => !FULLY_MANUAL_MARKETS.has(p.market));
  let sections: PropSection[] = propFightKey ? buildPropSections(liveOnlyProps, propFightKey) : [];

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

  // Total Rounds: fight-level, always on, any org.
  const totalRoundsRows = buildTotalRoundsRows(props, fiveRound);

  // Point Spread / Sig Strikes / Takedowns: UFC only, matching the same
  // non-core gate the rest of the sheet uses.
  const pointSpreadRows = isUFC
    ? buildPointSpreadRows(
        props,
        fight.fighter1_name,
        fight.fighter2_name,
        fiveRound,
        ml?.cur1 ?? null,
        ml?.cur2 ?? null
      )
    : [];
  const sigStrikesGroups = isUFC
    ? buildSigStrikesRows(props, fight.fighter1_name, fight.fighter2_name)
    : [];
  const takedownGroups = isUFC
    ? buildTotalTakedownsRows(props, fight.fighter1_name, fight.fighter2_name)
    : [];

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 overflow-hidden">
      {sections.map((sec) => (
        <div key={sec.title}>
          <SectionHeader title={sec.title} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
            {sec.rows.map((p, i) => (
              <MatrixRow key={i} p={p} data={data} onSave={onSave} />
            ))}
          </div>
        </div>
      ))}

      <div>
        <SectionHeader title="Total Rounds" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
          {totalRoundsRows.map((row) => (
            <PresetRow key={row.key} row={row} data={data} onSave={onSave} />
          ))}
        </div>
      </div>

      {pointSpreadRows.length > 0 && (
        <div>
          <SectionHeader title="Point Spread" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
            {pointSpreadRows.map((row) => (
              <PresetRow key={row.key} row={row} data={data} onSave={onSave} />
            ))}
          </div>
        </div>
      )}

      {sigStrikesGroups.map(({ name, row }) => (
        <div key={row.key}>
          <SectionHeader title={`${name} Total Sig Strikes`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
            <DiffRow row={row} data={data} onSave={onSave} />
          </div>
        </div>
      ))}

      {takedownGroups.map(({ name, rows }) => (
        <div key={name}>
          <SectionHeader title={`${name} Total Takedowns`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
            {rows.map((row) => (
              <PresetRow key={row.key} row={row} data={data} onSave={onSave} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
