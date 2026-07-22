export type EventRow = {
  id: string;
  org: string;
  event_name: string;
  event_date: string | null;
  event_time: string | null;
  location: string | null;
  source_url: string | null;
};

export type FightRow = {
  id: string;
  event_id: string;
  fighter1_name: string;
  fighter2_name: string;
  fighter1_id: string | null;
  fighter2_id: string | null;
  weight_class: string | null;
  is_main_event: boolean;
  bout_order: number | null;
};

export type UserData = {
  fight_id: string;
  price1: string | null;
  price2: string | null;
  notes1: string | null;
  notes2: string | null;
};

export type FighterNote = {
  fighter_id: string;
  fighter_name: string | null;
  notes: string | null;
  tags: string[] | null;
  updated_at: string | null;
};

export type NoteHistoryRow = {
  id: string;
  fighter_id: string;
  notes: string | null;
  event_context: string | null;
  created_at: string;
};

export type NewBet = {
  selection: string;
  event_context: string | null;
  event_date: string | null;
  event_start: string | null;
  fighter_id: string | null;
  book: string | null;
  price_check: string | null;
  market_best: number | null;
  market_book: string | null;
  market_checked_at: string | null;
  close_odds: number | null;
  clv: number | null;
  bet_type: string;
  prop_method: string | null;
  prop_round: number | null;
  ou_line: number | null;
  event_source_url: string | null;
  odds: number;
  stake: number;
};

export type BetRow = NewBet & {
  id: string;
  result: string;
  placed_at: string;
  grade_note: string | null;
  settled_by: string | null; // 'auto' (scraper) | 'user' | null - server-controlled
  delete_requested_at: string | null;
  delete_reason: string | null; // owner asked for removal (verified bets)
  published_at: string | null; // owner made the pick public before event start
  // Unrealized CLV against the board's CURRENT price, moneyline-only, and
  // only ever set while result === "pending" - the database guarantees this
  // is never non-null at the same time as clv, so it can never be summed
  // into a settled-stats average by accident.
  live_clv: number | null;
};

// Notes price matrix: one typed price per exact board row, keyed by that
// row's own identity (propRowKey from lib/propBet.ts, or a synthetic
// moneyline key) - flat by design, since most BetOnline outcomes (Round
// Betting, Method + Round, etc.) are independent single-price rows, not
// left/right fighter pairs.
export type MatrixData = Record<string, string>;

// The old per-market {f1o,f1v,f2v,f2o} shape. Kept only so ReviewArchive.tsx
// can still display already-completed fights that were noted before this
// change - new fights save under MatrixData above, not this.
export type LegacyMatrixData = Record<string, { f1o?: string; f1v?: string; f2v?: string; f2o?: string }>;

export type ReviewRow = {
  id: string;
  fight_id: string;
  org: string | null;
  event_name: string | null;
  event_date: string | null;
  fighter1_name: string | null;
  fighter2_name: string | null;
  weight_class: string | null;
  price1: string | null;
  price2: string | null;
  matrix: LegacyMatrixData | null; // pre-existing archives only; see LegacyMatrixData
  winner_name: string | null;
  f1_result: string | null;
  method: string | null;
  result_round: string | null;
  result_time: string | null;
};

export type LeaderboardRow = {
  username: string;
  tier: string;
  market: string;
  org: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  staked: number;
  profit: number;
  clv_sum: number;
  clv_n: number;
};

export type PublicBet = {
  id: string;
  username: string;
  selection: string;
  bet_type: string | null;
  event_start: string | null;
  published_at: string | null;
  event_context: string | null;
  event_date: string | null;
  odds: number;
  stake: number;
  book: string | null;
  result: string;
  placed_at: string;
  price_check: string | null;
  market_best: number | null;
  market_book: string | null;
  clv: number | null;
  // See BetRow.live_clv - same guarantee, same moneyline/pending-only scope.
  live_clv: number | null;
};
