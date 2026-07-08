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
  "Every upcoming card across the promotions we track, pulled in automatically and kept current. Expand any fight to log your own prices, notes, and a handicapping matrix — it all saves as you go and follows each fighter to their next booking.",
];

export const FIGHTERS_README = [
  "Your scouting library: every fighter you've written on, searchable by name, note, or tag. Notes are tied to the fighter rather than the event, so they resurface on their own the next time that fighter is booked.",
];

export const BETS_README = [
  "Your bet log. Verified bets are tied to a fight and priced off the sharp board, then graded automatically from the result — proof, not self-reporting. Unverified bets are your own book and price, graded by you and kept off the leaderboard.",
];

export const LEADERBOARD_README = [
  "A public ranking built only from verified bets logged before the event started — nothing self-reported, nothing after the fact. Sort by profit, ROI, or closing-line value, the sharpest read on who's actually beating the market. Five settled bets earns a spot.",
];
