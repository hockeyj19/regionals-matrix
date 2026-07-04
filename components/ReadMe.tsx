"use client";

import { InfoIcon } from "@/components/icons";

export function InfoButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="How this tab works"
      className={`rounded-md border p-1.5 ${
        open
          ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
          : "border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900"
      }`}
    >
      <InfoIcon />
    </button>
  );
}

export function ReadMePanel({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
        How this tab works
      </p>
      {paragraphs.map((p, i) => (
        <p key={i} className="text-xs text-neutral-400 leading-relaxed">
          {p}
        </p>
      ))}
    </div>
  );
}

export const EVENTS_README = [
  "Every upcoming card across UFC (plus DWCS and Road to UFC), PFL, LFA, Cage Warriors, KSW, Oktagon, CFFC, Brave CF, UAE Warriors, Rizin, ACA, and ONE — pulled automatically, two weeks out (a month for UFC), with first-prelim start times in ET. Cards stay current: changed matchups and cancellations are pruned on every refresh.",
  "Per fight: the small boxes beside each name are your prices — write whatever you want, they save when you click away. The two big boxes are fighter notes — each note is tied to the booking you wrote it for. When a fighter turns up on a future card, the box starts empty for the new matchup, and everything you've written about him before appears right beneath it, stamped with the event it came from. His full dossier lives in the Fighters tab. The grid icon opens a 13-market handicapping matrix for that bout; the $ icon logs a verified bet. Both icons stay lit when a fight has saved work.",
  "One rule worth knowing: prices and matrix entries are per-matchup — when the event passes (or the bout falls apart), they're archived to your Review section and cleared. Your permanent read on a fighter belongs in his notes. Fighter names link to Tapology.",
];

export const FIGHTERS_README = [
  "Your scouting library — every fighter you've ever written a note on, in one place, whether or not they're currently booked. Notes are keyed to stable fighter IDs, so they survive event deletion and reattach automatically the moment a fighter shows up on any future card.",
  "Search covers names, note text, and tags. Tags are comma-separated and become clickable chips — tag your southpaws, your fading-cardio guys, your live dogs, then filter by chip. Every booking gets its own history entry — edits during fight week update that entry rather than stacking duplicates — so expanding History shows how your read on a fighter evolved matchup by matchup, each entry stamped with where it was written. Trash any entry you don't want kept. Fighters with nothing left (no note, no tags, no history) hide themselves until you write about them again.",
];

export const BETS_README = [
  "Two kinds of bets. Verified bets are logged through the $ icon on a fight card (or the event-then-fight picker here): they're tied to a real bout, require a book, carry a server timestamp, and are auto-graded from official results after the event — moneylines, methods, rounds, and method+round combos fully automatically; totals automatically too, with rare edge cases (a fight ending exactly on the number) flagged for you. ONE Championship totals are graded manually since round lengths vary by discipline. Unverified bets are free text — anything goes, you grade them yourself with the W/L/P buttons (tap again to un-settle). Unverified bets never touch the leaderboards.",
  "Odds are American; stakes are units. Grading runs on each site refresh — pending just means results aren't posted yet, and auto-grade never overrides a result you set yourself. The stats, bankroll curve, monthly and per-org breakdowns all respect the Verified/All toggle. Leaderboard rule: only verified bets logged before the event's start time count publicly — anything logged late is flagged on the row and stays private to you. The Review archive below stores every fight you priced or matrixed, with the result, so you can grade your own lines. Moneyline bets also get a market check at log time when the odds feed is connected: your price is compared against the live sportsbook board — matched-or-worse earns a market ✓, better-than-board is noted alongside the best price that was showing. Exchange bets on Polymarket and Kalshi are exempt; the feed can't see them.",
];

export const LEADERBOARD_README = [
  "Two boards, because beating Pinnacle limits and clipping DraftKings promos are different sports. Sharp tracks BetOnline.ag, Pinnacle, Polymarket, and Kalshi. Soft tracks Bet365, DraftKings, FanDuel, BetMGM, Caesars, BetRivers, and Bovada. Filter either to UFC only; sort by profit or ROI. Ranking requires 5+ settled bets — under that you're in building-a-record.",
  "What counts: verified bets only, logged before the event started (server clock, no exceptions), at a listed book, settled, and not voided. Your picks stay private until the event starts, then go public — click any name to see their full record on that board, book included. See a price that never existed? Hit the flag on the bet and say why; the admin reviews every report, and voided bets vanish from the boards instantly. Claim a username to appear — your email is never shown. Moneylines carry a market check too — market ✓ means the odds feed confirmed that price (or better) was live on the board the moment the bet was logged.",
  "The CLV column is the sharp-money metric: closing line value. Just before each event the closing board is snapshotted, and every moneyline bet is scored on whether you got a better number than the market's final price — averaged into a per-bettor figure you can sort by. Consistently positive CLV over a real sample is the truest sign someone is beating the market rather than running hot. Sportsbook moneylines only; exchange and prop bets aren't scored.",
];
