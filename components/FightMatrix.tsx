"use client";

import type { FightRow, MatrixData } from "@/lib/types";
import { matrixCell, MATRIX_GROUPS } from "@/lib/format";
import { cellClv, type MatrixBoardPrice } from "@/lib/matrixBoard";

// The little CLV badge under a cell: your typed price vs BetOnline's live
// price for that exact market. Green if you beat the board, red if not, dash
// when the board doesn't post it (or your cell is empty). Same sign
// convention as the platform's real CLV.
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

export function FightMatrix({
  fight,
  data,
  boardPrice,
  onSave,
}: {
  fight: FightRow;
  data: MatrixData;
  // marketKey -> current BetOnline prices for each side; absent while the
  // board is still loading or this fight isn't on the board at all.
  boardPrice?: (marketKey: string) => MatrixBoardPrice;
  onSave: (market: string, cell: string, value: string) => void;
}) {
  // 5-round fights (main events / title bouts) unlock the deeper round over/unders
  const fiveRound =
    fight.is_main_event || /champ|title/i.test(fight.weight_class ?? "");
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 overflow-x-auto">
      <div className="min-w-[16rem]">
        <div className="grid grid-cols-[1fr_6rem_1fr] gap-1 items-center px-2 py-1.5 border-b border-neutral-800">
          <span className="text-[11px] font-semibold text-neutral-300 text-right truncate pr-1">
            {fight.fighter1_name}
          </span>
          <span className="text-[10px] text-neutral-500 uppercase tracking-wide text-center">
            %
          </span>
          <span className="text-[11px] font-semibold text-neutral-300 text-left truncate pl-1">
            {fight.fighter2_name}
          </span>
        </div>
        <div>
          {MATRIX_GROUPS.map((group, gi) => {
            const rows = group.filter((m) => !m.fiveRoundOnly || fiveRound);
            if (rows.length === 0) return null;
            return (
              <div
                key={gi}
                className={`divide-y divide-neutral-800/70 ${gi > 0 ? "mt-2" : ""}`}
              >
                {rows.map((m) => {
                  const row = data[m.key] ?? {};
                  const bp = boardPrice?.(m.key) ?? { f1: null, f2: null };
                  return (
                    <div
                      key={m.key}
                      className="grid grid-cols-[1fr_6rem_1fr] gap-1 items-start px-2 py-1"
                    >
                      <div className="flex justify-end">
                        <div className="w-16">
                          <input
                            defaultValue={row.f1o ?? ""}
                            onBlur={(e) => onSave(m.key, "f1o", e.target.value)}
                            className={matrixCell}
                          />
                          <ClvChip typed={row.f1o} board={bp.f1} />
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-amber-400/90 text-center px-1 pt-1.5">
                        {m.label}
                      </span>
                      <div className="flex justify-start">
                        <div className="w-16">
                          <input
                            defaultValue={row.f2o ?? ""}
                            onBlur={(e) => onSave(m.key, "f2o", e.target.value)}
                            className={matrixCell}
                          />
                          <ClvChip typed={row.f2o} board={bp.f2} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
