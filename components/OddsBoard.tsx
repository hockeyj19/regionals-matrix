"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { boutMatch, fmtAmerican, freshness } from "@/lib/board";
import { LineHistoryModal } from "@/components/LineHistoryModal";
import type { EventRow, FightRow } from "@/lib/types";

/**
 * The Odds board: BetOnline moneylines with movement, laid over the app's own
 * fight cards. The left column is the event list - UFC cards in date order
 * first, every other promotion after; the right column is the selected card,
 * main event at the top down to the first prelim. Prices come from the bots'
 * `bol_board` ledger, matched to each fight by name; every price opens its
 * movement history. Single book by design - this is BetOnline, the sharp board.
 */

type BoardRow = {
  fight_key: string;
  fighter1: string;
  fighter2: string;
  open1: number | null;
  open2: number | null;
  cur1: number | null;
  cur2: number | null;
  updated_at: string;
};

type SidePrice = { open: number | null; cur: number | null; side: 1 | 2 };
type Matched = { fightKey: string; a: SidePrice; b: SidePrice };

function impliedProb(o: number): number {
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}
function pct(o: number | null): string {
  return o === null ? "—" : `${Math.round(impliedProb(o) * 100)}%`;
}
function isUFC(e: EventRow): boolean {
  return (e.org || "").toUpperCase().includes("UFC");
}

function Move({ open, cur }: { open: number | null; cur: number | null }) {
  if (open === null || cur === null || open === cur)
    return <span className="text-[10px] text-neutral-600">—</span>;
  const firmed = impliedProb(cur) > impliedProb(open);
  return (
    <span className={`text-[10px] ${firmed ? "text-emerald-400" : "text-red-400"}`}>
      {firmed ? "▲" : "▼"} {fmtAmerican(open)}
    </span>
  );
}

function PriceButton({
  price,
  onOpen,
  align,
}: {
  price: number | null;
  onOpen: () => void;
  align: "left" | "right";
}) {
  const fav = price !== null && price < 0;
  return (
    <button
      onClick={onOpen}
      disabled={price === null}
      title={price === null ? "No BetOnline line" : "Chart this line's movement"}
      className={`rounded px-1.5 py-0.5 text-sm font-semibold tabular-nums ${
        align === "right" ? "text-right" : "text-left"
      } ${
        price === null
          ? "text-neutral-600 cursor-default"
          : fav
          ? "text-emerald-300 hover:bg-emerald-600/10 hover:underline"
          : "text-neutral-200 hover:bg-neutral-800 hover:underline"
      }`}
    >
      {price === null ? "—" : fmtAmerican(price)}
    </button>
  );
}

export function OddsBoard({
  events,
  fights,
}: {
  events: EventRow[];
  fights: FightRow[];
}) {
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chart, setChart] = useState<
    { fightKey: string; side: 1 | 2; name: string } | null
  >(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("bol_board").select("*");
    setBoard((data as BoardRow[]) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // match one app fight to a ledger row (order-insensitive), keeping each
  // side's ledger side-number so the movement chart can be opened
  const matchFight = useCallback(
    (f: FightRow): Matched | null => {
      for (const row of board) {
        const parts = String(row.fight_key).split(" vs ");
        if (parts.length !== 2) continue;
        const [ra, rb] = parts;
        if (boutMatch(ra, rb, f.fighter1_name, f.fighter2_name)) {
          return {
            fightKey: row.fight_key,
            a: { open: row.open1, cur: row.cur1, side: 1 },
            b: { open: row.open2, cur: row.cur2, side: 2 },
          };
        }
        if (boutMatch(rb, ra, f.fighter1_name, f.fighter2_name)) {
          return {
            fightKey: row.fight_key,
            a: { open: row.open2, cur: row.cur2, side: 2 },
            b: { open: row.open1, cur: row.cur1, side: 1 },
          };
        }
      }
      return null;
    },
    [board]
  );

  // events that actually carry BetOnline lines, UFC first then the rest,
  // each in date order; and the fights per event, main event first
  const { tabs, lastUpdate } = useMemo(() => {
    const fightsByEvent: Record<string, FightRow[]> = {};
    for (const f of fights) (fightsByEvent[f.event_id] ??= []).push(f);
    let last = "";
    for (const r of board) if (r.updated_at > last) last = r.updated_at;

    const priced = events
      .map((ev) => {
        const evFights = (fightsByEvent[ev.id] ?? [])
          .slice()
          .sort((a, b) => (a.bout_order ?? 999) - (b.bout_order ?? 999));
        const withPrice = evFights.filter((f) => matchFight(f) !== null).length;
        return { ev, evFights, withPrice };
      })
      .filter((x) => x.withPrice > 0);

    priced.sort((x, y) => {
      const xu = isUFC(x.ev);
      const yu = isUFC(y.ev);
      if (xu !== yu) return xu ? -1 : 1;
      return (x.ev.event_date || "").localeCompare(y.ev.event_date || "");
    });
    return { tabs: priced, lastUpdate: last };
  }, [events, fights, board, matchFight]);

  // default to the first UFC card (soonest) once data is in
  useEffect(() => {
    if (selected || tabs.length === 0) return;
    const firstUFC = tabs.find((t) => isUFC(t.ev)) ?? tabs[0];
    setSelected(firstUFC.ev.id);
  }, [tabs, selected]);

  const active = tabs.find((t) => t.ev.id === selected) ?? tabs[0] ?? null;

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4">
      <div className="mb-3">
        <h2 className="text-lg font-bold">BetOnline board</h2>
        <p className="text-[11px] text-neutral-500">
          Live moneylines and how they&rsquo;ve moved since open — tap any price for its
          history.
          {lastUpdate ? ` Updated ${freshness(lastUpdate)}.` : ""}
        </p>
      </div>

      {!loaded && <p className="text-neutral-500">Reading the board…</p>}

      {loaded && tabs.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-4">
          <p className="text-sm text-neutral-300">The board is warming up.</p>
          <p className="text-xs text-neutral-600 mt-1">
            Cards appear here as the BetOnline monitors post their lines. If this stays
            empty, check that both line-movement workers are running.
          </p>
        </div>
      )}

      {loaded && tabs.length > 0 && active && (
        <div className="flex gap-3">
          {/* left: event tabs */}
          <div className="w-32 sm:w-44 shrink-0 space-y-1">
            {tabs.map(({ ev }) => {
              const on = ev.id === active.ev.id;
              return (
                <button
                  key={ev.id}
                  onClick={() => setSelected(ev.id)}
                  className={`w-full text-left rounded-lg border px-2 py-1.5 ${
                    on
                      ? "border-emerald-500 bg-emerald-600/15"
                      : "border-neutral-800 hover:bg-neutral-900"
                  }`}
                >
                  <span
                    className={`block text-xs font-semibold truncate ${
                      on ? "text-emerald-300" : "text-neutral-300"
                    }`}
                  >
                    {ev.event_name}
                  </span>
                  {ev.event_date && (
                    <span className="block text-[10px] text-neutral-600">
                      {ev.event_date}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* right: the selected card, main event first */}
          <div className="flex-1 min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
            <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900/60">
              <span className="text-sm font-semibold text-neutral-200">
                {active.ev.event_name}
              </span>
            </div>
            <div className="divide-y divide-neutral-900">
              {active.evFights.map((f, i) => {
                const m = matchFight(f);
                const isMain = f.is_main_event || (i === 0 && !active.evFights.some((x) => x.is_main_event));
                return (
                  <div key={f.id} className="px-2 sm:px-3 py-2">
                    <div className="flex items-center justify-between text-[10px] text-neutral-600 mb-0.5">
                      <span className={isMain ? "text-amber-400 font-semibold uppercase tracking-wide" : ""}>
                        {isMain ? "Main Event" : f.weight_class || ""}
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2">
                      {/* fighter 1 */}
                      <span className="text-sm truncate">{f.fighter1_name}</span>
                      <span className="text-[10px] text-neutral-500 w-9 text-right">
                        {pct(m ? m.a.cur : null)}
                      </span>
                      <div className="flex items-center gap-1 justify-end">
                        <Move open={m ? m.a.open : null} cur={m ? m.a.cur : null} />
                        <PriceButton
                          price={m ? m.a.cur : null}
                          align="right"
                          onOpen={() =>
                            m &&
                            setChart({ fightKey: m.fightKey, side: m.a.side, name: f.fighter1_name })
                          }
                        />
                      </div>
                      {/* fighter 2 */}
                      <span className="text-sm truncate text-neutral-300">{f.fighter2_name}</span>
                      <span className="text-[10px] text-neutral-500 w-9 text-right">
                        {pct(m ? m.b.cur : null)}
                      </span>
                      <div className="flex items-center gap-1 justify-end">
                        <Move open={m ? m.b.open : null} cur={m ? m.b.cur : null} />
                        <PriceButton
                          price={m ? m.b.cur : null}
                          align="right"
                          onOpen={() =>
                            m &&
                            setChart({ fightKey: m.fightKey, side: m.b.side, name: f.fighter2_name })
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {loaded && tabs.length > 0 && (
        <p className="text-[11px] text-neutral-600 mt-3">
          One book by design — BetOnline&rsquo;s lines, the sharp board this platform grades
          against. Movement (open → current) is the edge a static table doesn&rsquo;t show.
        </p>
      )}

      {chart && (
        <LineHistoryModal
          fightKey={chart.fightKey}
          side={chart.side}
          fighterName={chart.name}
          onClose={() => setChart(null)}
        />
      )}
    </div>
  );
}
