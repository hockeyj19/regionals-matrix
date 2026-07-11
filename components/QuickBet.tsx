"use client";

import { useEffect, useState } from "react";
import type { FightRow, NewBet } from "@/lib/types";
import { bookLabel, eventStartISO, parseBetInputs, sideBtn, fmtOdds } from "@/lib/format";
import { marketRank } from "@/components/OddsBoard";
import {
  fetchFightBoard,
  fetchFightProps,
  matchPropLine,
  fmtAmerican,
  freshness,
  sameFighter,
  type FightBoard,
  type PropLine,
} from "@/lib/board";

/**
 * The verified-bet slip, price-first: every market, fighter, method, round,
 * line, and outcome renders as a chip carrying its live BetOnline price, built
 * from the bots' ledger. Nothing is typed by hand and nothing appears that
 * isn't actually on the board - picking IS seeing the price. Stat markets
 * (takedowns, significant strikes, scorecards, specials) generate their own
 * chips from whatever BetOnline is serving, no hardcoded list. The book is
 * always BetOnline; the price is always the board's; the caps, opener embargo,
 * and server-side verification all apply from the first tap.
 */

const CORE_KEYS = ["moneyline", "totals", "method", "round", "method_round"];
const CORE_OPTIONS = [
  { key: "moneyline", label: "ML" },
  { key: "totals", label: "Totals" },
  { key: "method", label: "Methods" },
  { key: "round", label: "Rounds" },
  { key: "method_round", label: "Methods+Rounds" },
];
const METHODS = [
  { key: "ko_tko", label: "KO/TKO" },
  { key: "submission", label: "Sub" },
  { key: "decision", label: "Dec" },
];

const titleCase = (mk: string) =>
  mk.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Chip({
  active,
  onClick,
  label,
  price,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  price: number | null;
}) {
  return (
    <button onClick={onClick} className={sideBtn(active)}>
      {label}
      {price !== null && (
        <span className={active ? " opacity-80" : " text-emerald-400"}> {fmtOdds(price)}</span>
      )}
    </button>
  );
}

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
  const [method, setMethod] = useState("ko_tko");
  const [roundSel, setRoundSel] = useState<number | null>(null);
  const [ouSide, setOuSide] = useState<"over" | "under">("over");
  const [totalLineSel, setTotalLineSel] = useState<number | null>(null);
  const [statLineSel, setStatLineSel] = useState<number | null>(null);
  const [outcomeSel, setOutcomeSel] = useState<string | null>(null);
  const [stake, setStake] = useState("");
  const [error, setError] = useState("");
  const [board, setBoard] = useState<FightBoard>(null);
  const [props, setProps] = useState<PropLine[] | null>(null);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [nowTs] = useState(() => Date.now()); // frozen per open; keeps render pure

  const f1 = fight.fighter1_name;
  const f2 = fight.fighter2_name;
  const sideName = side === 1 ? f1 : f2;
  const propList = props ?? [];
  const isML = betType === "moneyline";

  // ---- market shape ----
  const statMarkets = [
    ...new Set(
      propList
        .filter((p) => !["method", "round", "method_round", "total"].includes(p.market))
        .map((p) => p.market)
    ),
  ].sort((a, b) => marketRank(a) - marketRank(b) || a.localeCompare(b)); // BetOnline's order
  const isStat = statMarkets.includes(betType);
  const statRows = isStat ? propList.filter((p) => p.market === betType) : [];
  const statIsOU = statRows.some((p) => p.ou_side !== null);
  const statPlain = isStat && !statIsOU && !statRows.some((p) => p.round !== null);
  // A market that mixes fighter outcomes with fight-level ones ("Fighter Wins
  // Inside Distance": each fighter, plus "Goes to Decision") can't be picked
  // with fighter buttons - the fight-level side would be unreachable. Every
  // outcome becomes a chip instead; its text already says who it's on.
  const statMixed =
    statPlain &&
    statRows.some((p) => p.fighter !== null) &&
    statRows.some((p) => p.fighter === null);
  const statFighterScoped = statRows.some((p) => p.fighter !== null) && !statMixed;
  const forSide = (rows: PropLine[], nm: string) =>
    rows.filter((p) => !p.fighter || sameFighter(p.fighter, nm));
  const sideStatRows = forSide(statRows, sideName);
  const statRounds = [
    ...new Set(sideStatRows.filter((p) => p.round !== null).map((p) => p.round as number)),
  ].sort((a, b) => a - b);
  const statLines = statIsOU
    ? [
        ...new Set(
          sideStatRows
            .filter((p) => p.ou_line !== null && p.ou_line !== 0)
            .map((p) => p.ou_line as number)
        ),
      ].sort((a, b) => a - b)
    : [];
  // multiple plain outcomes for one fighter (BetOnline's specials bucket):
  // the outcome text itself is the pick
  const statMulti =
    isStat && !statIsOU && statRounds.length === 0 &&
    (statMixed ||
      sideStatRows.filter((p) => p.fighter).length > 1 ||
      (!statFighterScoped && statRows.filter((p) => p.outcome !== null).length > 1));
  const outcomeOpts = statMulti
    ? (statMixed ? statRows : sideStatRows)
        .filter((p) => p.outcome !== null)
        .map((p) => p.outcome as string)
    : [];

  const needsSide = isStat ? statFighterScoped : betType !== "totals";
  const needsMethod = betType === "method" || betType === "method_round";
  const coreNeedsRound = betType === "round" || betType === "method_round";
  const needsRound = coreNeedsRound || (isStat && statRounds.length > 0);
  const needsLine = betType === "totals";
  const stakeCap = isML ? 5 : betType === "totals" ? 2.5 : 1.25;

  const evStart = eventStartISO(eventDate, eventTime);
  const started = evStart ? new Date(evStart).getTime() <= nowTs : false;
  const mlPrice = !board ? null : side === 1 ? board.side1 : board.side2;

  // ---- pricing helper: what would the board pay for this exact pick? ----
  const priceOf = (q: {
    side?: 1 | 2;
    method?: string;
    round?: number | null;
    ou?: "over" | "under";
    line?: number | null;
    outcome?: string | null;
  }): number | null => {
    const sN = q.side ?? side;
    const nm = sN === 1 ? f1 : f2;
    if (isML) return !board ? null : sN === 1 ? board.side1 : board.side2;
    const rnd = q.round !== undefined ? q.round : needsRound ? roundSel : null;
    const line =
      q.line !== undefined ? q.line : needsLine ? totalLine : isStat && statIsOU ? statLine : null;
    const out = q.outcome !== undefined ? q.outcome : statMulti ? outcomeSel : null;
    const hit = matchPropLine(
      propList,
      betType,
      needsSide ? nm : "",
      q.method ?? method,
      rnd === null ? "" : String(rnd),
      q.ou ?? ouSide,
      line,
      out
    );
    return hit ? hit.odds : null;
    // (outcome-keyed lookups short-circuit inside matchPropLine)
  };

  // ---- board-derived option lists (only what actually exists) ----
  const coreRowsForSide = (mk: string) =>
    propList.filter((p) => p.market === mk && p.fighter && sameFighter(p.fighter, sideName));
  const methodOpts = needsMethod
    ? METHODS.filter(
        (m) =>
          !(betType === "method_round" && m.key === "decision") &&
          coreRowsForSide(betType).some((p) => p.method === m.key)
      )
    : [];
  const roundOpts = coreNeedsRound
    ? [
        ...new Set(
          coreRowsForSide(betType)
            .filter((p) => p.round !== null && (betType === "round" || p.method === method))
            .map((p) => p.round as number)
        ),
      ].sort((a, b) => a - b)
    : statRounds;
  const totalLineOpts = needsLine
    ? [
        ...new Set(
          propList
            .filter((p) => p.market === "total" && p.ou_line !== null)
            .map((p) => p.ou_line as number)
        ),
      ].sort((a, b) => a - b)
    : [];
  const totalLine = needsLine ? totalLineSel ?? totalLineOpts[0] ?? null : null;
  const statLine = isStat && statIsOU ? statLineSel ?? statLines[0] ?? null : null;
  // "o42.5" / "u0.5" - the book's own line, never a bare "Over 0"
  const ouLabel = (p: "o" | "u") => {
    const ln = needsLine ? totalLine : statLine;
    return ln === null ? (p === "o" ? "Over" : "Under") : `${p}${ln}`;
  };

  // keep selections pointing at things that exist on the board
  useEffect(() => {
    if (!boardLoaded) return;
    if (needsMethod && methodOpts.length && !methodOpts.some((m) => m.key === method)) {
      setMethod(methodOpts[0].key);
    }
    if (needsRound) {
      if (roundOpts.length && (roundSel === null || !roundOpts.includes(roundSel))) {
        setRoundSel(roundOpts[0]);
      }
    } else if (roundSel !== null) {
      setRoundSel(null);
    }
    if (statMulti) {
      if (outcomeOpts.length && (outcomeSel === null || !outcomeOpts.includes(outcomeSel))) {
        setOutcomeSel(outcomeOpts[0]);
      }
    } else if (outcomeSel !== null) {
      setOutcomeSel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betType, side, method, boardLoaded, propList.length]);

  const matchedProp = isML
    ? null
    : matchPropLine(
        propList,
        betType,
        needsSide ? sideName : "",
        method,
        needsRound && roundSel !== null ? String(roundSel) : "",
        ouSide,
        needsLine ? totalLine : isStat && statIsOU ? statLine : null,
        statMulti ? outcomeSel : null
      );
  const boardPrice = isML ? mlPrice : matchedProp ? matchedProp.odds : null;

  // Opener embargo: a brand-new BetOnline market can't take verified bets for
  // its first 30 minutes, so nobody snipes soft early numbers for the
  // leaderboard. The clock starts when the bots first record the market.
  const EMBARGO_MS = 30 * 60 * 1000;
  const openerIso = isML ? board?.openedAt ?? null : matchedProp?.openedAt ?? null;
  const opensAtMs = openerIso ? Date.parse(openerIso) + EMBARGO_MS : null;
  const embargoed = boardPrice !== null && opensAtMs !== null && nowTs < opensAtMs;
  const embargoMins =
    opensAtMs === null ? 0 : Math.max(1, Math.ceil((opensAtMs - nowTs) / 60000));
  const priceReady = boardLoaded && boardPrice !== null && !started && !embargoed;
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
      setTotalLineSel(null);
      setStatLineSel(null);
      setBoardLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [open, fight.fighter1_name, fight.fighter2_name]);

  function pickType(t: string) {
    setBetType(t);
    setError("");
    setRoundSel(null);
    setStatLineSel(null);
    setOutcomeSel(null);
    if (t === "method_round" && method === "decision") setMethod("ko_tko");
  }

  // fighter buttons carry the price when it's unambiguous for this market
  const sidePrice = (sN: 1 | 2): number | null => {
    if (isML) return !board ? null : sN === 1 ? board.side1 : board.side2;
    if (isStat && !statIsOU && statRounds.length === 0) {
      const nm = sN === 1 ? f1 : f2;
      const rows = statRows.filter(
        (p) => p.fighter && sameFighter(p.fighter, nm) && p.round === null && !p.ou_side
      );
      return rows.length === 1 ? rows[0].odds : null;
    }
    return null;
  };

  async function submit() {
    if (!priceReady) {
      setError(
        started
          ? "This fight has started - verified logging is closed."
          : embargoed
          ? `This market just opened on BetOnline - verified betting unlocks ${embargoMins}m from now.`
          : "BetOnline hasn't posted this price yet - check back, or try another market."
      );
      return;
    }
    if (needsRound && roundSel === null) {
      setError("Pick a round from the board.");
      return;
    }
    if (statMulti && outcomeSel === null) {
      setError("Pick an outcome from the board.");
      return;
    }
    const ouLine = needsLine ? totalLine : isStat && statIsOU ? statLine : null;
    if ((needsLine || (isStat && statIsOU)) && ouLine === null) {
      setError("No line for this market on the board yet.");
      return;
    }
    // every verified price is the board's, not the user's
    const parsed = parseBetInputs(fmtAmerican(boardPrice as number), stake);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    if (parsed.stake > stakeCap) {
      setError(`Verified limit for this market is ${stakeCap}u - BetOnline's real limit.`);
      return;
    }
    // on a mixed market the chosen OUTCOME decides the fighter, not the buttons
    const mixedRow =
      statMixed && outcomeSel !== null
        ? statRows.find((p) => p.outcome === outcomeSel) ?? null
        : null;
    const mixedSide: 1 | 2 | null =
      mixedRow && mixedRow.fighter
        ? sameFighter(mixedRow.fighter, f1)
          ? 1
          : 2
        : null;
    const effSide: 1 | 2 = mixedSide ?? side;
    const name = statMixed ? (mixedRow?.fighter ?? f1) : sideName;
    const fid =
      (statMixed ? effSide : side) === 1 ? fight.fighter1_id : fight.fighter2_id;
    const effectiveType = betType === "totals" ? ouSide : betType;
    const methodLabel =
      method === "ko_tko" ? "KO/TKO" : method === "submission" ? "Submission" : "Decision";

    let selection = name;
    if (betType === "method") selection = `${name} by ${methodLabel}`;
    else if (betType === "round") selection = `${name} in R${roundSel}`;
    else if (betType === "method_round") selection = `${name} by ${methodLabel} in R${roundSel}`;
    else if (betType === "totals")
      selection = `${ouSide === "over" ? "Over" : "Under"} ${ouLine} — ${f1} vs ${f2}`;
    else if (isStat) {
      const title = titleCase(betType);
      if (statMulti)
        selection = statFighterScoped
          ? (outcomeSel as string) // specials: BetOnline's exact outcome text
          : `${outcomeSel} — ${title}`; // fight-level / mixed, e.g. "Goes to Decision — Fighter Wins Inside Distance"
      else if (statIsOU) {
        const who = statFighterScoped ? name : `${f1} vs ${f2}`;
        selection = `${who} ${ouSide === "over" ? "Over" : "Under"} ${ouLine} — ${title}`;
      } else selection = `${name}${needsRound ? ` R${roundSel}` : ""} — ${title}`;
    }

    // Trust marks are the server's to write: the insert trigger nulls any
    // price_check/market_* sent from here, and the morning scrape stamps the
    // verdict from the bot ledger at the server-stamped log time.
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
      // for fight-level bets the fighter id is just a bout locator for the grader
      fighter_id:
        needsSide || (statMixed && mixedRow?.fighter)
          ? fid
          : fight.fighter1_id ?? fight.fighter2_id,
      bet_type: effectiveType,
      prop_method: needsMethod ? method : isStat && statIsOU ? ouSide : null,
      prop_round: needsRound ? roundSel : null,
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
    setMethod("ko_tko");
    setRoundSel(null);
    setOuSide("over");
    setTotalLineSel(null);
    setStatLineSel(null);
    setOutcomeSel(null);
    setStake("");
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
      {/* markets: core + whatever stat markets BetOnline is serving */}
      <div className="flex flex-wrap gap-1">
        {CORE_OPTIONS.map((t) => (
          <button key={t.key} onClick={() => pickType(t.key)} className={sideBtn(betType === t.key)}>
            {t.label}
          </button>
        ))}
        {statMarkets.map((mk) => (
          <button key={mk} onClick={() => pickType(mk)} className={sideBtn(betType === mk)}>
            {titleCase(mk)}
          </button>
        ))}
      </div>

      {/* fighters, priced where the market makes the price unambiguous */}
      {needsSide && (
        <div className="grid grid-cols-2 gap-2">
          <Chip active={side === 1} onClick={() => setSide(1)} label={f1} price={sidePrice(1)} />
          <Chip active={side === 2} onClick={() => setSide(2)} label={f2} price={sidePrice(2)} />
        </div>
      )}

      {/* methods as priced chips - only the ones on the board */}
      {needsMethod && methodOpts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {methodOpts.map((m) => (
            <Chip
              key={m.key}
              active={method === m.key}
              onClick={() => setMethod(m.key)}
              label={m.label}
              price={priceOf({ method: m.key })}
            />
          ))}
        </div>
      )}

      {/* rounds as priced chips - core and stat markets alike */}
      {needsRound && roundOpts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {roundOpts.map((r) => (
            <Chip
              key={r}
              active={roundSel === r}
              onClick={() => setRoundSel(r)}
              label={`R${r}`}
              price={priceOf({ round: r })}
            />
          ))}
        </div>
      )}

      {/* totals + stat over/unders: line picker + priced O/U chips */}
      {(needsLine || (isStat && statIsOU)) && (
        <div className="flex flex-wrap items-center gap-1">
          {(needsLine ? totalLineOpts : statLines).length > 1 && (
            <select
              value={(needsLine ? totalLine : statLine) ?? ""}
              onChange={(e) =>
                needsLine
                  ? setTotalLineSel(parseFloat(e.target.value))
                  : setStatLineSel(parseFloat(e.target.value))
              }
              className="rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs outline-none focus:border-emerald-500"
            >
              {(needsLine ? totalLineOpts : statLines).map((ln) => (
                <option key={ln} value={ln}>
                  {ln}
                  {needsLine ? " rds" : ""}
                </option>
              ))}
            </select>
          )}
          <Chip
            active={ouSide === "over"}
            onClick={() => setOuSide("over")}
            label={ouLabel("o")}
            price={priceOf({ ou: "over" })}
          />
          <Chip
            active={ouSide === "under"}
            onClick={() => setOuSide("under")}
            label={ouLabel("u")}
            price={priceOf({ ou: "under" })}
          />
        </div>
      )}

      {/* specials: BetOnline's exact outcomes as priced chips */}
      {statMulti && outcomeOpts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {outcomeOpts.map((o) => (
            <Chip
              key={o}
              active={outcomeSel === o}
              onClick={() => setOutcomeSel(o)}
              label={o}
              price={priceOf({ outcome: o })}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <span
          title="Verified bets are priced and graded off the BetOnline board"
          className="rounded-md border border-emerald-800 bg-emerald-600/10 px-2 py-1 text-xs text-emerald-300"
        >
          {bookLabel(effectiveBook)}
        </span>
        {!boardLoaded ? (
          <span className="px-2 py-1 text-xs text-neutral-600">reading board…</span>
        ) : boardPrice !== null && !started && embargoed ? (
          <span
            title="New BetOnline market: verified betting opens 30 minutes after the opener"
            className="rounded-md border border-amber-700/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-400"
          >
            fresh opener · verified in {embargoMins}m
          </span>
        ) : priceReady && boardPrice !== null ? (
          <span
            title={board ? `BetOnline board, ${freshness(board.capturedAt)}` : "BetOnline board"}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
          >
            {fmtOdds(boardPrice)}
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
