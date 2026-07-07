"use client";

import { useEffect, useState } from "react";
import type { FightRow, NewBet } from "@/lib/types";
import { eventStartISO, parseBetInputs, sideBtn } from "@/lib/format";
import {
  fetchFightBoard,
  fetchFightProps,
  matchPropOdds,
  boardTotalLine,
  fmtAmerican,
  freshness,
  type FightBoard,
  type PropLine,
} from "@/lib/board";

const BET_TYPE_OPTIONS = [
  { key: "moneyline", label: "ML" },
  { key: "method", label: "Methods" },
  { key: "round", label: "Rounds" },
  { key: "method_round", label: "Methods+Rounds" },
  { key: "totals", label: "Totals" },
];

export function QuickBet({
  fight,
  eventLabel,
  eventDate,
  eventTime,
  eventSourceUrl,
  onAdd,
  embedded = false,
}: {
  fight: FightRow;
  eventLabel: string;
  eventDate: string | null;
  eventTime: string | null;
  eventSourceUrl: string | null;
  onAdd: (bet: NewBet) => void;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(embedded);
  const [side, setSide] = useState<1 | 2>(1);
  const [betType, setBetType] = useState("moneyline");
  const [ouSide, setOuSide] = useState<"over" | "under">("over");
  const [method, setMethod] = useState("ko_tko");
  const [round, setRound] = useState("");
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [error, setError] = useState("");
  const [board, setBoard] = useState<FightBoard>(null);
  const [props, setProps] = useState<PropLine[] | null>(null);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [nowTs] = useState(() => Date.now()); // frozen per open; keeps render pure

  const needsSide = betType !== "totals";
  const needsMethod = betType === "method" || betType === "method_round";
  const needsRound = betType === "round" || betType === "method_round";
  const needsLine = betType === "totals";

  // A verified moneyline is priced off the BetOnline board, not typed:
  // you accept the line the bots see, or - if BetOnline hasn't posted it,
  // or the fight has started - the moneyline path is closed.
  // Every verified bet - moneyline and every prop - is priced off the
  // BetOnline board, read-only. The user picks the outcome; its price fills
  // from the ledger, or (if BetOnline hasn't posted it, or the fight has
  // started) the path is closed. The book is always BetOnline, the oracle.
  const isML = betType === "moneyline";
  const evStart = eventStartISO(eventDate, eventTime);
  const started = evStart ? new Date(evStart).getTime() <= nowTs : false;
  const sideName = side === 1 ? fight.fighter1_name : fight.fighter2_name;
  const propList = props ?? [];
  const mlPrice = !board ? null : side === 1 ? board.side1 : board.side2;
  const totalLine = betType === "totals" ? boardTotalLine(propList) : null;
  const boardPrice = isML
    ? mlPrice
    : matchPropOdds(propList, betType, sideName, method, round, ouSide, totalLine);
  const priceReady = boardLoaded && boardPrice !== null && !started;
  const effectiveBook = "BetOnline.ag";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([
      fetchFightBoard(fight.fighter1_name, fight.fighter2_name),
      fetchFightProps(fight.fighter1_name, fight.fighter2_name),
    ]).then(([b, pr]) => {
      if (!alive) return;
      setBoard(b);
      setProps(pr);
      setBoardLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [open, fight.fighter1_name, fight.fighter2_name]);

  function pickType(t: string) {
    setBetType(t);
    setError("");
    if (t === "method_round" && method === "decision") setMethod("ko_tko");
  }

  async function submit() {
    if (!priceReady) {
      setError(
        started
          ? "This fight has started - verified logging is closed."
          : "BetOnline hasn't posted this price yet - check back, or try another market."
      );
      return;
    }
    // every verified price is the board's, not the user's
    const oddsInput = boardPrice !== null ? fmtAmerican(boardPrice) : odds;
    const parsed = parseBetInputs(oddsInput, stake);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    let propRound: number | null = null;
    if (needsRound) {
      propRound = parseInt(round, 10);
      if (isNaN(propRound) || propRound < 1 || propRound > 5) {
        setError("Round must be 1-5.");
        return;
      }
    }
    const ouLine = needsLine ? totalLine : null;
    const name = side === 1 ? fight.fighter1_name : fight.fighter2_name;
    const fid = side === 1 ? fight.fighter1_id : fight.fighter2_id;
    const effectiveType = betType === "totals" ? ouSide : betType;

    // Trust marks are the server's to write: the insert trigger nulls any
    // price_check/market_* sent from here, and the morning scrape stamps the
    // verdict from the bot ledger at the server-stamped log time.
    const methodLabel =
      method === "ko_tko" ? "KO/TKO" : method === "submission" ? "Submission" : "Decision";
    let selection = name;
    if (betType === "method") selection = `${name} by ${methodLabel}`;
    else if (betType === "round") selection = `${name} in R${propRound}`;
    else if (betType === "method_round") selection = `${name} by ${methodLabel} in R${propRound}`;
    else if (betType === "totals")
      selection = `${ouSide === "over" ? "Over" : "Under"} ${ouLine} — ${fight.fighter1_name} vs ${fight.fighter2_name}`;
    onAdd({
      selection,
      event_context: eventLabel,
      event_date: eventDate,
      event_start: eventStartISO(eventDate, eventTime),
      book: effectiveBook,
      price_check: null,
      market_best: null,
      market_book: null,
      market_checked_at: null,
      close_odds: null,
      clv: null,
      // for over/under bets the fighter id is just a bout locator for the grader
      fighter_id: needsSide ? fid : fight.fighter1_id ?? fight.fighter2_id,
      bet_type: effectiveType,
      prop_method: needsMethod ? method : null,
      prop_round: propRound,
      ou_line: ouLine,
      event_source_url: eventSourceUrl,
      odds: parsed.odds,
      stake: parsed.stake,
    });
    setBoardLoaded(false);
    setBoard(null);
    setOpen(embedded);
    setSide(1);
    setBetType("moneyline");
    setOuSide("over");
    setOdds("");
    setStake("");
    setRound("");
    setError("");
  }

  if (!open) {
    return (
      <div className="text-center">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-neutral-500 hover:text-emerald-400"
        >
          + Log bet
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 space-y-2">
      <div className="flex flex-wrap gap-1">
        {BET_TYPE_OPTIONS.map((t) => (
          <button key={t.key} onClick={() => pickType(t.key)} className={sideBtn(betType === t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {needsSide && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setSide(1)} className={sideBtn(side === 1)}>
            {fight.fighter1_name}
          </button>
          <button onClick={() => setSide(2)} className={sideBtn(side === 2)}>
            {fight.fighter2_name}
          </button>
        </div>
      )}
      {needsLine && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setOuSide("over")} className={sideBtn(ouSide === "over")}>
            Over
          </button>
          <button onClick={() => setOuSide("under")} className={sideBtn(ouSide === "under")}>
            Under
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <span
          title="Verified bets are priced and graded off the BetOnline board"
          className="rounded-md border border-emerald-800 bg-emerald-600/10 px-2 py-1 text-xs text-emerald-300"
        >
          BetOnline.ag
        </span>
        {needsMethod && (
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
          >
            <option value="ko_tko">KO/TKO</option>
            <option value="submission">Submission</option>
            {betType !== "method_round" && <option value="decision">Decision</option>}
          </select>
        )}
        {needsRound && (
          <input
            value={round}
            onChange={(e) => setRound(e.target.value)}
            placeholder="Rd (1-5)"
            className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
          />
        )}
        {needsLine && (
          <span className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200">
            {totalLine !== null ? `${totalLine} rds` : "no total"}
          </span>
        )}
        {!boardLoaded ? (
          <span className="px-2 py-1 text-xs text-neutral-600">reading board…</span>
        ) : priceReady && boardPrice !== null ? (
          <span
            title={board ? `BetOnline board, ${freshness(board.capturedAt)}` : "BetOnline board"}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
          >
            {fmtAmerican(boardPrice)}
            <span className="text-neutral-500"> · board</span>
          </span>
        ) : (
          <span className="px-2 py-1 text-xs text-amber-400">
            {started ? "event started" : "not on BetOnline yet"}
          </span>
        )}
        <input
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          placeholder="Units"
          className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
        />
        <button
          onClick={submit}
          disabled={!priceReady}
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
        >
          Save
        </button>
        {!embedded && (
          <button
            onClick={() => {
              setOpen(false);
              setError("");
            }}
            className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  );
}
