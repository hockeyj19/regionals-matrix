"use client";

import type { FightRow, MatrixData } from "@/lib/types";
import { matrixCell, MATRIX_GROUPS } from "@/lib/format";

export function FightMatrix({
  fight,
  data,
  onSave,
}: {
  fight: FightRow;
  data: MatrixData;
  onSave: (market: string, cell: string, value: string) => void;
}) {
  // 5-round fights (main events / title bouts) unlock the deeper round over/unders
  const fiveRound =
    fight.is_main_event || /champ|title/i.test(fight.weight_class ?? "");
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 overflow-x-auto">
      <div className="min-w-[380px]">
        <div className="grid grid-cols-[1fr_11rem_1fr] gap-1 items-center px-2 py-1.5 border-b border-neutral-800">
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
                  return (
                    <div
                      key={m.key}
                      className="grid grid-cols-[1fr_11rem_1fr] gap-1 items-center px-2 py-1"
                    >
                      <div className="flex justify-end">
                        <div className="w-16">
                          <input
                            defaultValue={row.f1o ?? ""}
                            onBlur={(e) => onSave(m.key, "f1o", e.target.value)}
                            className={matrixCell}
                          />
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-amber-400/90 text-center px-1">
                        {m.label}
                      </span>
                      <div className="flex justify-start">
                        <div className="w-16">
                          <input
                            defaultValue={row.f2o ?? ""}
                            onBlur={(e) => onSave(m.key, "f2o", e.target.value)}
                            className={matrixCell}
                          />
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
