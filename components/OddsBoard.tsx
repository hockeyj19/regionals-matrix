"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { boutMatch, sameFighter } from "@/lib/board";
import { fmtOdds, parseOddsInput, displayTypedOdds, getOddsMode } from "@/lib/format";
import { LineHistoryModal } from "@/components/LineHistoryModal";
import type { EventRow, FightRow, UserData } from "@/lib/types";

/**
 * The Odds board: moneylines laid over the app's own fight cards, with a book
 * toggle sitting above the board. BetOnline is the sharp board this platform
 * grades against - its prices carry open->current movement (tap any price for
 * history) plus the method/total props from the bots' ledger. FanDuel is a
 * soft-book comparison pulled from the market feed (moneyline only for now);
 * its prices are for line-shopping and don't carry movement history yet, so
 * they render plain and non-clickable. Events are one column of collapsible
 * cards, the soonest UFC card pinned to the top and open by default.
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

type PropRow = {
  fight_key: string;
  market: string;
  fighter: string | null;
  method: string | null;
  round: number | null;
  ou_side: string | null;
  ou_line: number | null;
  odds: number;
};

type SidePrice = { open: number | null; cur: number | null; side: 1 | 2; name: string };
type Matched = { fightKey: string; a: SidePrice; b: SidePrice };
type Book = "betonline" | "fanduel";

function isUFC(e: EventRow): boolean {
  return (e.org || "").toUpperCase().includes("UFC");
}

// Same per-promotion color system as the Notes page, so an event reads the same
// on both screens.
const ORG_COLORS: Record<string, string> = {
  UFC: "text-red-400",
  "Road to UFC": "text-red-300",
  "Dana White's Contender Series": "text-red-300",
  PFL: "text-blue-400",
  LFA: "text-sky-400",
  "Cage Warriors": "text-yellow-400",
  KSW: "text-orange-400",
  Oktagon: "text-pink-400",
  CFFC: "text-purple-400",
  "Brave CF": "text-amber-400",
  "UAE Warriors": "text-teal-400",
  Rizin: "text-rose-400",
  ACA: "text-lime-400",
  "ONE Championship": "text-cyan-400",
};

function orgColor(org: string): string {
  return ORG_COLORS[org] ?? "text-emerald-400";
}


const CORE_MARKETS = new Set(["method", "round", "method_round", "total"]);

function impliedProb(o: number): number {
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}

// green when the board pays BETTER than the user's own line (positive value),
// red when it pays worse; null when they agree or the user has no note
function valueTone(note: string | null, board: number | null): "pos" | "neg" | null {
  const mo = parseOddsInput(note);
  if (mo === null || board === null || mo === board) return null;
  return impliedProb(board) < impliedProb(mo) ? "pos" : "neg";
}

function PriceButton({
  price,
  onOpen,
  tone,
}: {
  price: number | null;
  onOpen: () => void;
  tone: "pos" | "neg" | null;
}) {
  const color =
    price === null
      ? "text-neutral-600 cursor-default"
      : tone === "pos"
      ? "text-emerald-400 hover:underline"
      : tone === "neg"
      ? "text-red-400 hover:underline"
      : "text-neutral-200 hover:bg-neutral-800 hover:underline";
  return (
    <button
      onClick={onOpen}
      disabled={price === null}
      title={price === null ? "No BetOnline line" : "Chart this line's movement"}
      className={`rounded px-1.5 py-0.5 text-sm font-semibold tabular-nums text-right ${color}`}
    >
      {price === null ? "—" : fmtOdds(price)}
    </button>
  );
}

// FanDuel (any book without a movement ledger) shows a plain, non-clickable
// price - same value coloring as the sharp board, but nothing to chart yet.
function StaticPrice({ price, tone }: { price: number | null; tone: "pos" | "neg" | null }) {
  const color =
    price === null
      ? "text-neutral-600"
      : tone === "pos"
      ? "text-emerald-400"
      : tone === "neg"
      ? "text-red-400"
      : "text-neutral-200";
  return (
    <span
      title={price === null ? "No FanDuel line" : "FanDuel"}
      className={`px-1.5 py-0.5 text-sm font-semibold tabular-nums text-right ${color}`}
    >
      {price === null ? "—" : fmtOdds(price)}
    </span>
  );
}

function PropCell({ price }: { price: number | null }) {
  return (
    <span
      className={`text-[11px] tabular-nums text-right ${
        price === null ? "text-neutral-700" : "text-neutral-300"
      }`}
    >
      {price === null ? "—" : fmtOdds(price)}
    </span>
  );
}

// Everything the bots capture beyond the summary columns: round betting,
// method+round combos, and every total line - each price with its implied %
// (the market's own projection), hidden in percent mode where it's redundant.
function PropsPanel({
  fightKey,
  f1,
  f2,
  propList,
}: {
  fightKey: string;
  f1: string;
  f2: string;
  propList: PropRow[];
}) {
  const rows = propList.filter((p) => p.fight_key === fightKey);
  const showPct = getOddsMode() !== "percent";
  const cell = (o: number | null) =>
    o === null ? (
      <span className="text-neutral-700">—</span>
    ) : (
      <span className="tabular-nums text-neutral-200">
        {fmtOdds(o)}
        {showPct && (
          <span className="text-neutral-600"> {(impliedProb(o) * 100).toFixed(1)}%</span>
        )}
      </span>
    );
  const roundPrice = (name: string, rnd: number) =>
    rows.find(
      (p) =>
        p.market === "round" && p.fighter !== null &&
        sameFighter(p.fighter, name) && p.round === rnd
    )?.odds ?? null;
  const mrPrice = (name: string, rnd: number, meth: string) =>
    rows.find(
      (p) =>
        p.market === "method_round" && p.fighter !== null &&
        sameFighter(p.fighter, name) && p.round === rnd && p.method === meth
    )?.odds ?? null;
  const roundsPresent = [
    ...new Set(
      rows
        .filter((p) => (p.market === "round" || p.market === "method_round") && p.round !== null)
        .map((p) => p.round as number)
    ),
  ].sort((a, b) => a - b);
  const totalLines = (() => {
    const m = new Map<number, { over: number | null; under: number | null }>();
    for (const p of rows) {
      if (p.market !== "total" || p.ou_line === null) continue;
      const e = m.get(p.ou_line) ?? { over: null, under: null };
      if (p.ou_side === "over") e.over = p.odds;
      else if (p.ou_side === "under") e.under = p.odds;
      m.set(p.ou_line, e);
    }
    return [...m.entries()].map(([line, v]) => ({ line, ...v })).sort((a, b) => a.line - b.line);
  })();
  const hasRounds = rows.some((p) => p.market === "round");
  const hasMR = rows.some((p) => p.market === "method_round");
  const extraMarkets = [...new Set(rows.filter((p) => !CORE_MARKETS.has(p.market)).map((p) => p.market))].sort();
  if (!hasRounds && !hasMR && totalLines.length === 0 && extraMarkets.length === 0) {
    return (
      <p className="mt-2 text-[10px] text-neutral-600">
        No deeper props on the board for this fight yet.
      </p>
    );
  }
  const last = (n: string) => n.trim().split(/\s+/).slice(-1)[0];
  return (
    <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-2 space-y-3 text-[11px]">
      {hasRounds && roundsPresent.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-wide text-neutral-600 mb-1">Wins in round</p>
          <div className="grid grid-cols-[2.2rem_1fr_1fr] gap-x-2 gap-y-0.5">
            <span />
            <span className="text-[9px] text-neutral-500 truncate">{last(f1)}</span>
            <span className="text-[9px] text-neutral-500 truncate">{last(f2)}</span>
            {roundsPresent.map((r) => (
              <>
                <span key={`rl${r}`} className="text-neutral-500">R{r}</span>
                <span key={`r1${r}`}>{cell(roundPrice(f1, r))}</span>
                <span key={`r2${r}`}>{cell(roundPrice(f2, r))}</span>
              </>
            ))}
          </div>
        </div>
      )}
      {hasMR &&
        [f1, f2].map((name) => (
          <div key={name}>
            <p className="text-[9px] uppercase tracking-wide text-neutral-600 mb-1">
              {name} — method + round
            </p>
            <div className="grid grid-cols-[2.2rem_1fr_1fr_1fr] gap-x-2 gap-y-0.5">
              <span />
              <span className="text-[9px] text-neutral-500">KO</span>
              <span className="text-[9px] text-neutral-500">Sub</span>
              <span className="text-[9px] text-neutral-500">Dec</span>
              {roundsPresent.map((r) => (
                <>
                  <span key={`ml${r}`} className="text-neutral-500">R{r}</span>
                  <span key={`mk${r}`}>{cell(mrPrice(name, r, "ko_tko"))}</span>
                  <span key={`ms${r}`}>{cell(mrPrice(name, r, "submission"))}</span>
                  <span key={`md${r}`}>{cell(mrPrice(name, r, "decision"))}</span>
                </>
              ))}
            </div>
          </div>
        ))}
      {totalLines.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-wide text-neutral-600 mb-1">Total rounds</p>
          <div className="grid grid-cols-[2.2rem_1fr_1fr] gap-x-2 gap-y-0.5">
            <span />
            <span className="text-[9px] text-neutral-500">Over</span>
            <span className="text-[9px] text-neutral-500">Under</span>
            {totalLines.map((t) => (
              <>
                <span key={`tl${t.line}`} className="text-neutral-500">{t.line}</span>
                <span key={`to${t.line}`}>{cell(t.over)}</span>
                <span key={`tu${t.line}`}>{cell(t.under)}</span>
              </>
            ))}
          </div>
        </div>
      )}
      {extraMarkets.map((mk) => {
        const mrows = rows.filter((p) => p.market === mk);
        const rowLabel = (p: PropRow) => {
          const parts: string[] = [];
          if (p.fighter) parts.push(last(p.fighter));
          if (p.ou_side) parts.push(`${p.ou_side === "over" ? "O" : "U"}${p.ou_line ?? ""}`);
          if (parts.length === 0) parts.push("Tie");
          return parts.join(" ");
        };
        const ord = (p: PropRow) =>
          (p.fighter ? (sameFighter(p.fighter, f1) ? 0 : 1) : 2) * 100 +
          (p.ou_line ?? 0) * 2 +
          (p.ou_side === "under" ? 1 : 0);
        return (
          <div key={mk}>
            <p className="text-[9px] uppercase tracking-wide text-neutral-600 mb-1">
              {mk.replace(/_/g, " ")}
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
              {mrows
                .slice()
                .sort((a, b) => ord(a) - ord(b))
                .map((p, i) => (
                  <>
                    <span key={`gl${mk}${i}`} className="text-neutral-400 truncate">
                      {rowLabel(p)}
                    </span>
                    <span key={`gv${mk}${i}`} className="text-right">{cell(p.odds)}</span>
                  </>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`w-4 h-4 shrink-0 text-neutral-500 transition-transform ${
        open ? "rotate-180" : ""
      }`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function OddsBoard({
  events,
  fights,
  userData,
}: {
  events: EventRow[];
  fights: FightRow[];
  userData: Record<string, UserData>;
}) {
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [fdBoard, setFdBoard] = useState<BoardRow[]>([]);
  const [activeBook, setActiveBook] = useState<Book>("betonline");
  const [props, setProps] = useState<PropRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [openPropIds, setOpenPropIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [chart, setChart] = useState<
    { fightKey: string; side: 1 | 2; name: string; notePrice: string | null } | null
  >(null);

  const load = useCallback(async () => {
    // fd_board soft-fails to [] until the FanDuel snapshot backend exists.
    const [b, fd, pr] = await Promise.all([
      supabase.from("bol_board").select("*"),
      supabase.from("fd_board").select("*"),
      supabase.from("bol_current_props").select("*"),
    ]);
    setBoard((b.data as BoardRow[]) ?? []);
    setFdBoard((fd.data as BoardRow[]) ?? []);
    setProps((pr.data as PropRow[]) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Near-real-time: re-read the boards on an interval so the FanDuel worker's
  // fresh lines (and any BetOnline movement) surface without a manual refresh.
  // Polls only while the tab is visible; expand/collapse state is untouched.
  useEffect(() => {
    const tick = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        load();
      }
    };
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [load]);

  // rows for whichever book is selected; props + movement only mean anything
  // on the sharp (BetOnline) board
  const activeBoard = useMemo(
    () => (activeBook === "fanduel" ? fdBoard : board),
    [activeBook, fdBoard, board]
  );
  const showProps = activeBook === "betonline";

  // match one app fight to a ledger row (order-insensitive), keeping each
  // side's ledger side-number so the movement chart can be opened
  const matchFight = useCallback(
    (f: FightRow): Matched | null => {
      for (const row of activeBoard) {
        const parts = String(row.fight_key).split(" vs ");
        if (parts.length !== 2) continue;
        const [ra, rb] = parts;
        if (boutMatch(ra, rb, f.fighter1_name, f.fighter2_name)) {
          return {
            fightKey: row.fight_key,
            a: { open: row.open1, cur: row.cur1, side: 1, name: row.fighter1 },
            b: { open: row.open2, cur: row.cur2, side: 2, name: row.fighter2 },
          };
        }
        if (boutMatch(rb, ra, f.fighter1_name, f.fighter2_name)) {
          return {
            fightKey: row.fight_key,
            a: { open: row.open2, cur: row.cur2, side: 2, name: row.fighter2 },
            b: { open: row.open1, cur: row.cur1, side: 1, name: row.fighter1 },
          };
        }
      }
      return null;
    },
    [activeBoard]
  );

  const methodPrice = useCallback(
    (fightKey: string, name: string, method: string): number | null => {
      const r = props.find(
        (pp) =>
          pp.fight_key === fightKey &&
          pp.market === "method" &&
          !!pp.fighter &&
          sameFighter(pp.fighter, name) &&
          pp.method === method
      );
      return r ? r.odds : null;
    },
    [props]
  );

  const totalsFor = useCallback(
    (fightKey: string) => {
      const lines = new Map<number, { over: number | null; under: number | null }>();
      for (const pp of props) {
        if (pp.fight_key !== fightKey || pp.market !== "total" || pp.ou_line === null)
          continue;
        const e = lines.get(pp.ou_line) ?? { over: null, under: null };
        if (pp.ou_side === "over") e.over = pp.odds;
        else if (pp.ou_side === "under") e.under = pp.odds;
        lines.set(pp.ou_line, e);
      }
      // pick'em first: the line whose over sits closest to an even-money 50%
      return [...lines.entries()]
        .map(([line, v]) => ({ line, ...v }))
        .sort((a, b) => {
          const da = a.over === null ? 1 : Math.abs(impliedProb(a.over) - 0.5);
          const db = b.over === null ? 1 : Math.abs(impliedProb(b.over) - 0.5);
          return da - db;
        });
    },
    [props]
  );

  // events that actually carry lines on the active book, UFC first then the
  // rest, each in date order; and the fights per event, main event first
  const { tabs, topUfcId } = useMemo(() => {
    const fightsByEvent: Record<string, FightRow[]> = {};
    for (const f of fights) (fightsByEvent[f.event_id] ??= []).push(f);

    const priced = events
      .map((ev) => {
        const evFights = (fightsByEvent[ev.id] ?? [])
          .slice()
          .sort((a, b) => (a.bout_order ?? 999) - (b.bout_order ?? 999));
        const withPrice = evFights.filter((f) => matchFight(f) !== null).length;
        return { ev, evFights, withPrice };
      })
      .filter((x) => x.withPrice > 0);

    // chronological, then pin the soonest UFC card to the very top
    priced.sort((x, y) =>
      (x.ev.event_date || "").localeCompare(y.ev.event_date || "")
    );
    const ufcIdx = priced.findIndex((p) => isUFC(p.ev));
    const topUfcId = ufcIdx >= 0 ? priced[ufcIdx].ev.id : null;
    if (ufcIdx > 0) priced.unshift(priced.splice(ufcIdx, 1)[0]);
    return { tabs: priced, topUfcId };
  }, [events, fights, activeBoard, matchFight]);

  // start with only the soonest UFC card open; respect toggles after that
  useEffect(() => {
    if (initialized || tabs.length === 0) return;
    setOpenIds(new Set(topUfcId ? [topUfcId] : []));
    setInitialized(true);
  }, [tabs, topUfcId, initialized]);

  function toggleProps(id: string) {
    setOpenPropIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggle(id: string) {
    setOpenIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-4">
      <div className="mb-3">
        <div className="inline-flex rounded-lg border border-neutral-800 bg-neutral-900/40 p-0.5">
          {(["betonline", "fanduel"] as const).map((bk) => (
            <button
              key={bk}
              onClick={() => setActiveBook(bk)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                activeBook === bk
                  ? "border border-emerald-500/50 bg-black text-emerald-400"
                  : "border border-transparent text-neutral-400 hover:text-emerald-400"
              }`}
            >
              {bk === "betonline" ? "BetOnline" : "FanDuel"}
            </button>
          ))}
        </div>
      </div>

      {!loaded && <p className="text-neutral-500">Reading the board…</p>}

      {loaded && tabs.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-4">
          <p className="text-sm text-neutral-300">
            {activeBook === "fanduel" ? "No FanDuel lines yet." : "The board is warming up."}
          </p>
          <p className="text-xs text-neutral-600 mt-1">
            {activeBook === "fanduel"
              ? "FanDuel prices appear once the scraper's market-feed pull runs. If this stays empty, check that ODDS_API_KEY is set and the snapshot step has run at least once."
              : "Cards appear here as the BetOnline monitors post their lines. If this stays empty, check that both line-movement workers are running."}
          </p>
        </div>
      )}

      {loaded && tabs.length > 0 && (
        <div className="space-y-2">
          {tabs.map(({ ev, evFights }) => {
            const open = openIds.has(ev.id);
            return (
              <div
                key={ev.id}
                className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden"
              >
                <button
                  onClick={() => toggle(ev.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-neutral-900/60"
                >
                  <div className="text-left min-w-0">
                    <span className={`block text-[10px] font-semibold uppercase tracking-wide truncate ${orgColor(ev.org)}`}>
                      {ev.org}
                    </span>
                    <span className="block text-sm font-semibold text-neutral-200 truncate">
                      {ev.event_name}
                    </span>
                    {ev.event_date && (
                      <span className="block text-[10px] text-neutral-600">
                        {ev.event_date}
                      </span>
                    )}
                  </div>
                  <Chevron open={open} />
                </button>
                {open && (
                  <div className="border-t border-neutral-800 overflow-x-auto">
                    <div className="grid grid-cols-[minmax(10rem,1fr)_3.2rem_3.4rem_3.8rem_3rem_3rem_3rem] items-center gap-x-1 px-2 sm:px-3 py-1 border-b border-neutral-800 text-[9px] uppercase tracking-wide text-neutral-600">
                      <span />
                      <span className="text-right text-emerald-600">Mine</span>
                      <span className="text-right">ML</span>
                      <span className="text-right">Total</span>
                      <span className="text-right">KO</span>
                      <span className="text-right">Sub</span>
                      <span className="text-right">Dec</span>
                    </div>
                    <div className="divide-y divide-neutral-900">
                      {evFights.map((f, i) => {
                        const m = matchFight(f);
                        const fk = m?.fightKey ?? null;
                        const isMain =
                          f.is_main_event ||
                          (i === 0 && !evFights.some((x) => x.is_main_event));
                        const totals = fk && showProps ? totalsFor(fk) : [];
                        const ud = userData[f.id];
                        const fighterRow = (
                          name: string,
                          sp: SidePrice | undefined,
                          dim: boolean,
                          myPrice: string | null,
                          totalSide: "over" | "under"
                        ) => (
                          <div className="grid grid-cols-[minmax(10rem,1fr)_3.2rem_3.4rem_3.8rem_3rem_3rem_3rem] items-center gap-x-1 py-0.5">
                            <span className={`text-sm truncate ${dim ? "text-neutral-300" : ""}`}>
                              {name}
                            </span>
                            <span className="text-[11px] tabular-nums text-right text-neutral-400">
                              {myPrice && myPrice.trim() ? displayTypedOdds(myPrice) : "—"}
                            </span>
                            <div className="flex justify-end">
                              {activeBook === "betonline" ? (
                                <PriceButton
                                  price={sp ? sp.cur : null}
                                  tone={valueTone(myPrice, sp ? sp.cur : null)}
                                  onOpen={() =>
                                    m &&
                                    sp &&
                                    setChart({
                                      fightKey: m.fightKey,
                                      side: sp.side,
                                      name,
                                      notePrice: myPrice,
                                    })
                                  }
                                />
                              ) : (
                                <StaticPrice
                                  price={sp ? sp.cur : null}
                                  tone={valueTone(myPrice, sp ? sp.cur : null)}
                                />
                              )}
                            </div>
                            <div className="text-[10px] tabular-nums text-right leading-tight text-neutral-400">
                              {totals.length === 0 ? (
                                <span className="text-neutral-700">—</span>
                              ) : (
                                totals.map((t) => {
                                  const o = totalSide === "over" ? t.over : t.under;
                                  return (
                                    <div key={t.line}>
                                      {totalSide === "over" ? "O" : "U"}
                                      {t.line}{" "}
                                      <span className="text-[11px] text-neutral-300">
                                        {o === null ? "—" : fmtOdds(o)}
                                      </span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                            <PropCell
                              price={fk && sp && showProps ? methodPrice(fk, sp.name, "ko_tko") : null}
                            />
                            <PropCell
                              price={fk && sp && showProps ? methodPrice(fk, sp.name, "submission") : null}
                            />
                            <PropCell
                              price={fk && sp && showProps ? methodPrice(fk, sp.name, "decision") : null}
                            />
                          </div>
                        );
                        return (
                          <div key={f.id} className="px-2 sm:px-3 py-2">
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                              <span
                                className={
                                  isMain
                                    ? "text-amber-400 font-semibold uppercase tracking-wide"
                                    : "text-neutral-600"
                                }
                              >
                                {isMain ? "Main Event" : f.weight_class || ""}
                              </span>
                              {showProps && fk && props.some((p) => p.fight_key === fk) && (
                                <button
                                  onClick={() => toggleProps(f.id)}
                                  className="text-[10px] text-neutral-500 hover:text-emerald-400"
                                  title="Round betting, method + round, and every total line"
                                >
                                  props {openPropIds.has(f.id) ? "▴" : "▾"}
                                </button>
                              )}
                            </div>
                            {fighterRow(f.fighter1_name, m?.a, false, ud?.price1 ?? null, "over")}
                            {fighterRow(f.fighter2_name, m?.b, true, ud?.price2 ?? null, "under")}
                            {showProps && fk && openPropIds.has(f.id) && (
                              <PropsPanel
                                fightKey={fk}
                                f1={f.fighter1_name}
                                f2={f.fighter2_name}
                                propList={props}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loaded && tabs.length > 0 && (
        <p className="text-[11px] text-neutral-600 mt-3">
          {activeBook === "fanduel"
            ? "FanDuel's moneylines, here to line-shop against the sharp board. Grading still runs on BetOnline — this is the market for comparison."
            : "One book by design — BetOnline's lines, the sharp board this platform grades against. Movement (open → current) is the edge a static table doesn't show."}
        </p>
      )}

      {chart && (
        <LineHistoryModal
          fightKey={chart.fightKey}
          side={chart.side}
          fighterName={chart.name}
          notePrice={chart.notePrice}
          onClose={() => setChart(null)}
        />
      )}
    </div>
  );
}
