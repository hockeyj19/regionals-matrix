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
  buildMethodOfVictoryRows,
  buildMethodRoundRows,
  buildMostMatchupRows,
  buildPointSpreadRows,
  buildRoundBettingRows,
  buildSigStrikesRows,
  buildTotalRoundsRows,
  buildTotalTakedownsRows,
  fmtLineDiff,
  isFiveRound,
  lineDiff,
  type PresetDiffRow,
  type PresetPriceRow,
} from "@/lib/manualProps";

// Moneyline is synthesized separately below. Goes The Distance and the rest
// of the outcome-list exotics stay live-only for now - see the note in
// manualProps.ts about the propRowKey collision on those markets.
const CORE_ONLY_TITLES = new Set(["Moneyline", "Goes The Distance"]);

// These markets are rendered entirely by the always-on template blocks below
// instead of straight off the live feed, and Specials never renders at all -
// so all nine are stripped out of the live board data before section-building.
const FULLY_MANUAL_MARKETS = new Set([
  "total",
  "point_spread",
  "total_significant_strikes",
  "total_takedowns",
  "method",
  "round",
  "method_round",
  "most_significant_strikes_landed",
  "most_takedowns_landed",
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

// A preset/template row that isn't tied to a live PropRow directly - always
// available, priced manually with a CLV chip against the board when a
// matching outcome is live.
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
  // every section here is a prop category EXCEPT the synthesized "Moneyline"
  // header above them - that one isn't a prop, so it keeps the original color.
  const isMoneyline = title === "Moneyline";
  return (
    <div
      className={`bg-neutral-900/80 px-2 py-1 text-[11px] font-bold border-b border-neutral-800 ${
        isMoneyline ? "text-neutral-100" : "text-yellow-400"
      }`}
    >
      {title}
    </div>
  );
}

function PresetSection({
  title,
  rows,
  data,
  onSave,
}: {
  title: string;
  rows: PresetPriceRow[];
  data: Record<string, string>;
  onSave: (rowKey: string, value: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <SectionHeader title={title} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
        {rows.map((row) => (
          <PresetRow key={row.key} row={row} data={data} onSave={onSave} />
        ))}
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
  const fiveRound = isFiveRound(fight);
  const propFightKey = props[0]?.fight_key ?? "";
  const f1 = fight.fighter1_name;
  const f2 = fight.fighter2_name;

  // strip the markets now handled by always-on templates out of the live
  // feed before building the remaining board-driven sections, so nothing
  // renders twice
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
      fighter: f1,
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
      fighter: f2,
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

  // Always-on templates. Method of Victory matches the old non-UFC
  // allowance; Round Betting / Method+Round / Most SS / Most TDs stay
  // UFC-only, same gate the rest of the exotic sheet already used.
  const methodOfVictoryRows = buildMethodOfVictoryRows(props, f1, f2);
  const roundBettingRows = isUFC ? buildRoundBettingRows(props, f1, f2, fiveRound) : [];
  const methodRoundRows = isUFC ? buildMethodRoundRows(props, f1, f2, fiveRound) : [];
  const mostSigStrikesRows = isUFC
    ? buildMostMatchupRows(props, f1, f2, "most_significant_strikes_landed")
    : [];
  const mostTakedownsRows = isUFC
    ? buildMostMatchupRows(props, f1, f2, "most_takedowns_landed")
    : [];
  const totalRoundsRows = buildTotalRoundsRows(props, fiveRound);
  const pointSpreadRows = isUFC
    ? buildPointSpreadRows(props, f1, f2, fiveRound, ml?.cur1 ?? null, ml?.cur2 ?? null)
    : [];
  const sigStrikesGroups = isUFC ? buildSigStrikesRows(props, f1, f2) : [];
  const takedownGroups = isUFC ? buildTotalTakedownsRows(props, f1, f2) : [];

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

      <PresetSection title="Method of Victory" rows={methodOfVictoryRows} data={data} onSave={onSave} />
      <PresetSection title="Round Betting" rows={roundBettingRows} data={data} onSave={onSave} />
      <PresetSection title="Method + Round" rows={methodRoundRows} data={data} onSave={onSave} />
      <PresetSection title="Total Rounds" rows={totalRoundsRows} data={data} onSave={onSave} />
      <PresetSection title="Point Spread" rows={pointSpreadRows} data={data} onSave={onSave} />
      <PresetSection
        title="Most Significant Strikes Landed"
        rows={mostSigStrikesRows}
        data={data}
        onSave={onSave}
      />
      <PresetSection title="Most Takedowns Landed" rows={mostTakedownsRows} data={data} onSave={onSave} />

      {sigStrikesGroups.map(({ name, row }) => (
        <div key={row.key}>
          <SectionHeader title={`${name} Total Sig Strikes`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-2 py-2">
            <DiffRow row={row} data={data} onSave={onSave} />
          </div>
        </div>
      ))}

      {takedownGroups.map(({ name, rows }) => (
        <PresetSection key={name} title={`${name} Total Takedowns`} rows={rows} data={data} onSave={onSave} />
      ))}
    </div>
  );
}
