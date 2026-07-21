"use client";

import { useState } from "react";
import type { NewBet } from "@/lib/types";
import { SHARP_BOOKS, SOFT_BOOKS, bookLabel, eventStartISO, parseBetInputs } from "@/lib/format";

/**
 * The unverified slip: your book, your number, your grading. Because nothing
 * here is checked against the sharp board, there's no reason to constrain the
 * market - write the bet however you like ("McGregor by KO in R2", "Holloway
 * over 68.5 sig strikes", a parlay leg, anything). These log as "other" bets:
 * out of the verified scope and off the leaderboard, with the market details
 * living in the selection text you type.
 */

// unverified bets can be logged at any book — the soft books plus the sharp ones
const BOOK_OPTIONS = [...SOFT_BOOKS, ...SHARP_BOOKS];

const MAX_SELECTION = 160;

export function ManualBet({
  placeholderName,
  eventLabel,
  eventDate,
  eventTime,
  eventSourceUrl,
  onAdd,
}: {
  // just the placeholder-hint name - a real board fight and a manually
  // typed matchup both work, since nothing here is checked against the board
  placeholderName?: string;
  eventLabel: string;
  eventDate: string | null;
  eventTime: string | null;
  eventSourceUrl: string | null;
  onAdd: (bet: NewBet) => Promise<string | null>;
}) {
  const [selection, setSelection] = useState("");
  const [book, setBook] = useState(SOFT_BOOKS[0]);
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    const sel = selection.trim().replace(/\s+/g, " ");
    if (!sel) {
      setError("Write the bet — anything you like, e.g. “McGregor by KO in R2”.");
      return;
    }
    if (sel.length > MAX_SELECTION) {
      setError(`Keep the bet under ${MAX_SELECTION} characters.`);
      return;
    }
    const parsed = parseBetInputs(odds, stake);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }

    // Unverified: own book, own price, hand-graded. bet_type "other" keeps it
    // out of the verified scope and the leaderboard; the market details live in
    // the selection text.
    const failure = await onAdd({
      selection: sel,
      event_context: eventLabel,
      event_date: eventDate,
      event_start: eventStartISO(eventDate, eventTime),
      book,
      price_check: null,
      market_best: null,
      market_book: null,
      market_checked_at: null,
      close_odds: null,
      clv: null,
      fighter_id: null,
      bet_type: "other",
      prop_method: null,
      prop_round: null,
      ou_line: null,
      event_source_url: eventSourceUrl,
      odds: parsed.odds,
      stake: parsed.stake,
    });
    if (failure) {
      setError(failure);
      return;
    }
    setSelection("");
    setOdds("");
    setStake("");
    setError("");
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 space-y-2">
      <input
        value={selection}
        onChange={(e) => setSelection(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        maxLength={MAX_SELECTION}
        placeholder={`Write the bet — e.g. "${placeholderName ?? "Fighter A"} by KO in R2"`}
        title="Any market, any wording — you grade this one"
        className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-xs outline-none focus:border-emerald-500"
      />
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={book}
          onChange={(e) => setBook(e.target.value)}
          title="Your book"
          className="rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
        >
          {BOOK_OPTIONS.map((bk) => (
            <option key={bk} value={bk}>
              {bookLabel(bk)}
            </option>
          ))}
        </select>
        <input
          value={odds}
          onChange={(e) => setOdds(e.target.value)}
          placeholder="Odds (-150 / 1.67 / 60%)"
          className="w-40 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
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
          Add
        </button>
      </div>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  );
}
