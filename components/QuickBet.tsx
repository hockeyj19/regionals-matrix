"use client";

import { useState } from "react";
import type { FightRow, NewBet } from "@/lib/types";
import { BOOKS, eventStartISO, parseBetInputs, sideBtn } from "@/lib/format";

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
  const [line, setLine] = useState("2.5");
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [book, setBook] = useState("");
  const [error, setError] = useState("");

  const needsSide = betType !== "totals";
  const needsMethod = betType === "method" || betType === "method_round";
  const needsRound = betType === "round" || betType === "method_round";
  const needsLine = betType === "totals";

  function pickType(t: string) {
    setBetType(t);
    setError("");
    if (t === "method_round" && method === "decision") setMethod("ko_tko");
  }

  function submit() {
    if (!book) {
      setError("Pick the book you bet at.");
      return;
    }
    const parsed = parseBetInputs(odds, stake);
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
    let ouLine: number | null = null;
    if (needsLine) {
      ouLine = parseFloat(line);
      if (isNaN(ouLine) || ouLine <= 0 || Math.round(ouLine * 2) % 2 !== 1) {
        setError("Use a half line like 1.5 or 2.5.");
        return;
      }
    }
    const name = side === 1 ? fight.fighter1_name : fight.fighter2_name;
    const fid = side === 1 ? fight.fighter1_id : fight.fighter2_id;
    const effectiveType = betType === "totals" ? ouSide : betType;
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
      book,
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
    setOpen(embedded);
    setSide(1);
    setBetType("moneyline");
    setOuSide("over");
    setOdds("");
    setStake("");
    setRound("");
    setLine("2.5");
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
      <div className="flex flex-wrap gap-2">
        <select
          value={book}
          onChange={(e) => setBook(e.target.value)}
          className="rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
        >
          <option value="">Book</option>
          {BOOKS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
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
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="Line (2.5)"
            className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
          />
        )}
        <input
          value={odds}
          onChange={(e) => setOdds(e.target.value)}
          placeholder="Odds (-150)"
          className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
        />
        <input
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          placeholder="Units"
          className="w-20 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
        />
        <button
          onClick={submit}
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-medium"
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
