"use client";

import type { FightRow, MatrixData } from "@/lib/types";
import { matrixCell, MATRIX_MARKETS } from "@/lib/format";

export function FightMatrix({
  fight,
  data,
  onSave,
}: {
  fight: FightRow;
  data: MatrixData;
  onSave: (market: string, cell: string, value: string) => void;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[4rem_1fr_11rem_1fr_4rem] gap-1 items-center px-2 py-1.5 border-b border-neutral-800">
          <span className="text-[10px] text-neutral-500 uppercase tracking-wide text-center">
            Odds+
          </span>
          <span className="text-[11px] font-semibold text-neutral-300 text-center truncate">
            {fight.fighter1_name}
          </span>
          <span />
          <span className="text-[11px] font-semibold text-neutral-300 text-center truncate">
            {fight.fighter2_name}
          </span>
          <span className="text-[10px] text-neutral-500 uppercase tracking-wide text-center">
            Odds+
          </span>
        </div>
        <div className="divide-y divide-neutral-800/70">
          {MATRIX_MARKETS.map(([key, label]) => {
            const row = data[key] ?? {};
            return (
              <div
                key={key}
                className="grid grid-cols-[4rem_1fr_11rem_1fr_4rem] gap-1 items-center px-2 py-1"
              >
                <input
                  defaultValue={row.f1o ?? ""}
                  onBlur={(e) => onSave(key, "f1o", e.target.value)}
                  className={matrixCell}
                />
                <input
                  defaultValue={row.f1v ?? ""}
                  onBlur={(e) => onSave(key, "f1v", e.target.value)}
                  className={matrixCell}
                />
                <span className="text-[11px] font-semibold text-amber-400/90 text-center px-1">
                  {label}
                </span>
                <input
                  defaultValue={row.f2v ?? ""}
                  onBlur={(e) => onSave(key, "f2v", e.target.value)}
                  className={matrixCell}
                />
                <input
                  defaultValue={row.f2o ?? ""}
                  onBlur={(e) => onSave(key, "f2o", e.target.value)}
                  className={matrixCell}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
