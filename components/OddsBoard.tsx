"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { boutMatch, fetchAllRows, sameFighter } from "@/lib/board";
import { fmtOdds, parseOddsInput, displayTypedOdds, getOddsMode, eventStartISO } from "@/lib/format";
import { LineHistoryModal } from "@/components/LineHistoryModal";
import {
  buildPropSelection,
  propToBetShape,
  buildPropSections,
  propRowLabel,
  marketRank,
} from "@/lib/propBet";
export { marketRank } from "@/lib/propBet"; // QuickBet.tsx imports this from here
import { noteKeyForBoardRow } from "@/lib/manualProps";
import type { EventRow, FightRow, NewBet, UserData, MatrixData } from "@/lib/types";

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
  outcome: string | null;
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
  Oktagon: "text-[#dcc9a6]",
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


// marketRank re-exported below for QuickBet.tsx's existing import path

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
      onClick={(e) => {
        e.stopPropagation(); // MLs open the movement chart, not the props menu
        onOpen();
      }}
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

// One prop price in the fixed odds rail. Colors the same way the ML column
// does - green when the board pays better than the user's own tape-note
// price for this exact outcome, red when it pays worse - via the optional
// noteFor lookup, which each call site wires to this fight's matrix data.
function PropCell({
  row,
  onPick,
  noteFor,
}: {
  row: PropRow | null;
  onPick?: (p: PropRow) => void;
  noteFor?: (row: PropRow) => string | null;
}) {
  const price = row?.odds ?? null;
  if (price === null) {
    return <span className="text-[11px] tabular-nums text-right text-neutral-700">—</span>;
  }
  const note = row && noteFor ? noteFor(row) : null;
  const tone = valueTone(note, price);
  const color =
    tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-red-400" : "text-neutral-300";
  if (onPick && row) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPick(row);
        }}
        title="Tap to bet this price"
        className={`text-[11px] tabular-nums text-right hover:underline ${color}`}
      >
        {fmtOdds(price)}
      </button>
    );
  }
  return <span className={`text-[11px] tabular-nums text-right ${color}`}>{fmtOdds(price)}</span>;
}

// The full BetOnline prop sheet for one fight, rendered the way BetOnline
// itself lays it out: a header bar per market group, outcome rows with price
// chips, favorites first. Section list is built from whatever the bots
// captured, so new markets appear without code changes. Each price carries
// its implied % (hidden in percent display mode, where it's redundant), and
// colors against the user's own tape-note price the same way the fixed
// columns do, via the optional noteFor lookup.
function PropsPanel({
  fightKey,
  f1,
  f2,
  propList,
  onPick,
  noteFor,
}: {
  fightKey: string;
  f1: string;
  f2: string;
  propList: PropRow[];
  onPick?: (p: PropRow) => void;
  noteFor?: (row: PropRow) => string | null;
}) {
  const showPct = getOddsMode() !== "percent";
  const secs = buildPropSections(propList, fightKey);
  if (secs.length === 0) {
    return (
      <p className="mt-2 text-[10px] text-neutral-600">
        No props on the board for this fight yet.
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-neutral-800 overflow-hidden">
      {secs.map((sec) => (
        <div key={sec.title}>
          <div className="bg-neutral-900/80 px-2 py-1 text-[11px] font-bold text-neutral-100 border-b border-neutral-800">
            {sec.title}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 px-2 py-1.5">
            {sec.rows.map((p, i) => {
              const note = noteFor ? noteFor(p) : null;
              const tone = valueTone(note, p.odds);
              const priceColor =
                tone === "pos"
                  ? "text-emerald-300 border-emerald-700"
                  : tone === "neg"
                  ? "text-red-300 border-red-700"
                  : "text-neutral-100 border-neutral-700";
              return (
                <div key={i} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-[11px] text-neutral-300 truncate">
                    {propRowLabel(p)}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {showPct && (
                      <span className="text-[9px] text-neutral-600">
                        {(impliedProb(p.odds) * 100).toFixed(1)}%
                      </span>
                    )}
                    {onPick ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPick(p);
                        }}
                        title="Tap to bet this price"
                        className={`rounded border bg-neutral-900 hover:border-emerald-600 hover:bg-emerald-600/10 px-2 py-0.5 text-[11px] tabular-nums min-w-[3.2rem] text-center ${priceColor}`}
                      >
                        {fmtOdds(p.odds)}
                      </button>
                    ) : (
                      <span
                        className={`rounded border bg-neutral-900 px-2 py-0.5 text-[11px] tabular-nums min-w-[3.2rem] text-center ${priceColor}`}
                      >
                        {fmtOdds(p.odds)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Desktop drag-to-scroll for the wide odds rail: click, hold, and drag
// sideways anywhere (buttons - the MLs and the props chevron - keep their own
// clicks) to slide the columns. A real drag also swallows the click it would
// otherwise fire, so dragging never accidentally opens a props menu. Touch
// devices keep their native swipe scrolling untouched.
function DragScroller({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const st = useRef({ down: false, dragged: false, startX: 0, startLeft: 0 });
  return (
    <div
      ref={ref}
      className={className}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse") return;
        if ((e.target as HTMLElement).closest("button")) return;
        const el = ref.current;
        if (!el) return;
        st.current = { down: true, dragged: false, startX: e.clientX, startLeft: el.scrollLeft };
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
        const g = st.current;
        const el = ref.current;
        if (!g.down || !el) return;
        const dx = e.clientX - g.startX;
        if (!g.dragged && Math.abs(dx) > 4) {
          g.dragged = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* pointer capture unsupported: drag still works inside the rail */
          }
        }
        if (g.dragged) el.scrollLeft = g.startLeft - dx;
      }}
      onPointerUp={() => {
        st.current.down = false;
      }}
      onPointerCancel={() => {
        st.current.down = false;
      }}
      onClickCapture={(e) => {
        if (st.current.dragged) {
          e.preventDefault();
          e.stopPropagation();
          st.current.dragged = false;
        }
      }}
    >
      {children}
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
  matrixData,
  onAdd,
}: {
  events: EventRow[];
  fights: FightRow[];
  userData: Record<string, UserData>;
  // this fight's tape-note prices/lines, keyed the same way NotesPriceMatrix
  // stores them - lets prop cells and the movement chart's "Notes" stat show
  // what was actually typed, the same way the ML column already does
  matrixData?: Record<string, MatrixData>;
  // tap a prop price to place a verified bet at it - omit this prop and the
  // board stays read-only (prices render as plain text, exactly as before)
  onAdd?: (bet: NewBet) => Promise<string | null>;
}) {
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [fdBoard, setFdBoard] = useState<BoardRow[]>([]);
  const [activeBook, setActiveBook] = useState<Book>("betonline");
  const [props, setProps] = useState<PropRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [openPropIds, setOpenPropIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [chart, setChart] = useState
    {
      fightKey: string;
      side?: 1 | 2;
      name: string;
      notePrice: string | null;
      f: FightRow;
      ev: EventRow;
      odds: number | null;
      prop?: PropRow | null;
    } | null
  >(null);

  // this fight's tape-note price/line for a real live board row, or null if
  // the user hasn't typed one (or the row's fighter label doesn't resolve).
  const notePriceFor = useCallback(
    (f: FightRow, row: PropRow): string | null => {
      const key = noteKeyForBoardRow(row, f.fighter1_name, f.fighter2_name);
      if (!key) return null;
      return matrixData?.[f.id]?.[key] ?? null;
    },
    [matrixData]
  );

  // props now open the same chart-first modal MLs do, just keyed to that
  // exact prop's own movement history instead of the fighter's moneyline
  function openPropChart(p: PropRow, f: FightRow, ev: EventRow) {
    setChart({
      fightKey: p.fight_key,
      name: buildPropSelection(p, f.fighter1_name, f.fighter2_name),
      notePrice: notePriceFor(f, p),
      f,
      ev,
      odds: p.odds,
      prop: p,
    });
  }

  const load = useCallback(async () => {
    // fetchAllRows pages past Supabase's 1,000-row-per-request cap - a
    // bare select("*") TRUNCATES SILENTLY once a view outgrows it, which
    // is how the alphabetical tail of the prop board (RJ Harris...,
    // Stewart Nicoll...) vanished during fight week. fd_board still
    // soft-fails to [] until the FanDuel snapshot backend exists.
    const [b, fd, pr] = await Promise.all([
      fetchAllRows<BoardRow>("bol_board", "fight_key"),
      fetchAllRows<BoardRow>("fd_board", "fight_key"),
      fetchAllRows<PropRow>("bol_current_props", "fight_key"),
    ]);
    setBoard(b ?? []);
    setFdBoard(fd ?? []);
    setProps(pr ?? []);
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
    (fightKey: string, name: string, method: string): PropRow | null => {
      const r = props.find(
        (pp) =>
          pp.fight_key === fightKey &&
          pp.market === "method" &&
          !!pp.fighter &&
          sameFighter(pp.fighter, name) &&
          pp.method === method
      );
      return r ?? null;
    },
    [props]
  );

  // fighter wins in round N (market="round"), for the R1-R3 columns
  const roundWinPrice = useCallback(
    (fightKey: string, name: string, rnd: number): PropRow | null => {
      const r = props.find(
        (pp) =>
          pp.fight_key === fightKey &&
          pp.market === "round" &&
          !!pp.fighter &&
          sameFighter(pp.fighter, name) &&
          pp.round === rnd
      );
      return r ?? null;
    },
    [props]
  );

  // fighter wins round N on the scorecard or by finish
  // (market="scorecard_winner_or_finish"), for the ML R1-R3 columns
  const scorecardRoundPrice = useCallback(
    (fightKey: string, name: string, rnd: number): PropRow | null => {
      const r = props.find(
        (pp) =>
          pp.fight_key === fightKey &&
          pp.market === "scorecard_winner_or_finish" &&
          !!pp.fighter &&
          sameFighter(pp.fighter, name) &&
          pp.round === rnd
      );
      return r ?? null;
    },
    [props]
  );

  // a fighter's price in a head-to-head stat matchup (the SS / TD columns) -
  // what the SS and TD rail columns show
  const matchupPrice = useCallback(
    (fightKey: string, name: string, market: string): PropRow | null => {
      const r = props.find(
        (pp) =>
          pp.fight_key === fightKey &&
          pp.market === market &&
          !pp.ou_side &&
          !!pp.fighter &&
          sameFighter(pp.fighter, name)
      );
      return r ?? null;
    },
    [props]
  );


  // a fighter's own O/U stat totals (significant strikes / takedowns)
  const statTotalsFor = useCallback(
    (fightKey: string, name: string, market: string) => {
      const lines = new Map<number, { over: number | null; under: number | null }>();
      for (const pp of props) {
        if (pp.fight_key !== fightKey || pp.market !== market || pp.ou_line === null) continue;
        if (!pp.fighter || !sameFighter(pp.fighter, name)) continue;
        const e = lines.get(pp.ou_line) ?? { over: null, under: null };
        if (pp.ou_side === "over") e.over = pp.odds;
        else if (pp.ou_side === "under") e.under = pp.odds;
        lines.set(pp.ou_line, e);
      }
      return [...lines.entries()].map(([line, v]) => ({ line, ...v })).sort((a, b) => a.line - b.line);
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
                  <DragScroller className="border-t border-neutral-800 overflow-x-auto md:cursor-grab md:select-none">
                    <div className="grid grid-cols-[minmax(10rem,1fr)_1.75rem_3.2rem_3.4rem_3.8rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3.2rem_3.2rem_3.2rem] items-center gap-x-1 px-2 sm:px-3 py-1 border-b border-neutral-800 text-[9px] uppercase tracking-wide text-neutral-600">
                      <span />
                      <span />
                      <span className="text-right text-emerald-600">Notes</span>
                      <span className="text-right">ML</span>
                      <span className="text-right">Total</span>
                      <span className="text-right" title="Fighter wins inside the distance">ITD</span>
                      <span className="text-right">KO</span>
                      <span className="text-right">Sub</span>
                      <span className="text-right">Dec</span>
                      <span className="text-right" title="Win inside distance / goes the distance / no action">FML</span>
                      <span className="text-right">R1</span>
                      <span className="text-right">R2</span>
                      <span className="text-right">R3</span>
                      <span className="text-right" title="Most significant strikes landed (head-to-head)">SS</span>
                      <span className="text-right" title="Most takedowns landed (head-to-head)">TD</span>
                      <span className="text-right" title="Round 1 winner - scorecard or finish">ML R1</span>
                      <span className="text-right" title="Round 2 winner - scorecard or finish">ML R2</span>
                      <span className="text-right" title="Round 3 winner - scorecard or finish">ML R3</span>
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
                          totalSide: "over" | "under",
                          midSlot: ReactNode
                        ) => (
                          <div className="grid grid-cols-[minmax(10rem,1fr)_1.75rem_3.2rem_3.4rem_3.8rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3.2rem_3.2rem_3.2rem] items-center gap-x-1 py-0.5">
                            <span className={`text-sm truncate ${dim ? "text-neutral-300" : ""}`}>
                              {name}
                            </span>
                            <div className="relative">{midSlot}</div>
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
                                      f,
                                      ev,
                                      odds: sp.cur,
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
                                  const totalRow: PropRow | null =
                                    o !== null && fk
                                      ? {
                                          fight_key: fk,
                                          market: "total",
                                          fighter: null,
                                          method: null,
                                          round: null,
                                          ou_side: totalSide,
                                          ou_line: t.line,
                                          odds: o,
                                          outcome: null,
                                        }
                                      : null;
                                  const totalNote = totalRow ? notePriceFor(f, totalRow) : null;
                                  const totalTone = totalRow ? valueTone(totalNote, totalRow.odds) : null;
                                  const totalColor =
                                    totalTone === "pos"
                                      ? "text-emerald-400"
                                      : totalTone === "neg"
                                      ? "text-red-400"
                                      : "text-neutral-300";
                                  return (
                                    <div key={t.line}>
                                      {totalSide === "over" ? "O" : "U"}
                                      {t.line}{" "}
                                      {totalRow && onAdd ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openPropChart(totalRow, f, ev);
                                          }}
                                          title="Tap to bet this price"
                                          className={`text-[11px] hover:underline ${totalColor}`}
                                        >
                                          {fmtOdds(o as number)}
                                        </button>
                                      ) : (
                                        <span className={`text-[11px] ${totalColor}`}>
                                          {o === null ? "—" : fmtOdds(o)}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                            <PropCell
                              row={
                                fk && sp && showProps
                                  ? matchupPrice(fk, sp.name, "fighter_wins_inside_distance")
                                  : null
                              }
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? methodPrice(fk, sp.name, "ko_tko") : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? methodPrice(fk, sp.name, "submission") : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? methodPrice(fk, sp.name, "decision") : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={
                                fk && sp && showProps
                                  ? matchupPrice(fk, sp.name, "win_inside_distance_goes_distance_no_action")
                                  : null
                              }
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? roundWinPrice(fk, sp.name, 1) : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? roundWinPrice(fk, sp.name, 2) : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? roundWinPrice(fk, sp.name, 3) : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={
                                fk && sp && showProps
                                  ? matchupPrice(fk, sp.name, "most_significant_strikes_landed")
                                  : null
                              }
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={
                                fk && sp && showProps
                                  ? matchupPrice(fk, sp.name, "most_takedowns_landed")
                                  : null
                              }
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? scorecardRoundPrice(fk, sp.name, 1) : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? scorecardRoundPrice(fk, sp.name, 2) : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                            <PropCell
                              row={fk && sp && showProps ? scorecardRoundPrice(fk, sp.name, 3) : null}
                              onPick={onAdd ? (row) => openPropChart(row, f, ev) : undefined}
                              noteFor={(row) => notePriceFor(f, row)}
                            />
                          </div>
                        );
                        const canProps =
                          showProps && !!fk && props.some((p) => p.fight_key === fk);
                        // the expand chevron now lives in the gutter between the
                        // fighter names and the NOTES column, centered on the
                        // seam between the two fighter rows
                        const chevronEl = canProps ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleProps(f.id);
                            }}
                            title="All props for this fight"
                            className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 z-10 rounded border border-emerald-500/50 bg-neutral-950 text-emerald-400 hover:bg-emerald-500/10 p-0.5"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className={`w-3 h-3 transition-transform ${
                                openPropIds.has(f.id) ? "rotate-180" : ""
                              }`}
                            >
                              <path
                                fillRule="evenodd"
                                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        ) : null;
                        return (
                          <div key={f.id} className="px-2 sm:px-3 py-2">
                            {/* the whole matchup is a tap target for the props
                                menu - only the ML prices carve themselves out
                                (they open the movement chart instead) */}
                            <div
                              onClick={canProps ? () => toggleProps(f.id) : undefined}
                              className={canProps ? "cursor-pointer" : undefined}
                              title={canProps ? "Tap for all props" : undefined}
                            >
                              <div className="text-[10px] mb-0.5">
                                <span
                                  className={
                                    isMain
                                      ? "text-amber-400 font-semibold uppercase tracking-wide"
                                      : "text-neutral-600"
                                  }
                                >
                                  {isMain ? "Main Event" : f.weight_class || ""}
                                </span>
                              </div>
                              <div className="flex items-stretch">
                                <div className="min-w-0 grow">
                                  {fighterRow(f.fighter1_name, m?.a, false, ud?.price1 ?? null, "over", chevronEl)}
                                  {fighterRow(f.fighter2_name, m?.b, true, ud?.price2 ?? null, "under", null)}
                                </div>
                              </div>
                            </div>
                            {showProps && fk && openPropIds.has(f.id) && (
                              <PropsPanel
                                fightKey={fk}
                                f1={f.fighter1_name}
                                f2={f.fighter2_name}
                                propList={props}
                                onPick={onAdd ? (p) => openPropChart(p, f, ev) : undefined}
                                noteFor={(row) => notePriceFor(f, row)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </DragScroller>
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
          f={chart.f}
          ev={chart.ev}
          odds={chart.odds}
          prop={chart.prop}
          onAdd={onAdd}
          onClose={() => setChart(null)}
        />
      )}
    </div>
  );
}
