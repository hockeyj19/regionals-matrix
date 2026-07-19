import { createClient } from "@supabase/supabase-js";
import { betProfit } from "@/lib/format";
import type { PublicBet } from "@/lib/types";

/**
 * The data behind a public tipster page.
 *
 * Read with the anonymous key through two SECURITY DEFINER functions, so a
 * stranger with no account sees exactly what `public_bets` already exposes to
 * signed-in users - and nothing else. No RLS is loosened to make this work.
 *
 * The record is computed from the same public bets the page lists, using the
 * same betProfit() the app uses, so the headline can never disagree with the
 * picks printed under it.
 */

export type PublicProfile = {
  username: string;
  avatarUrl: string | null;
  bio: string;
  joined: string | null;
  picks: PublicBet[];
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  settled: number;
  units: number;
  staked: number;
  roi: number | null; // null until something has settled
  verified: number; // picks whose price was confirmed against the sharp board
  clv: number | null; // avg closing-line value across picks that have a close
};

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

type ProfileRow = {
  username?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  created_at?: string | null;
};

export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const name = (username || "").trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return null;

  const sb = anonClient();
  const [profRes, betsRes] = await Promise.all([
    sb.rpc("public_profile", { uname: name }),
    sb.rpc("public_profile_bets", { uname: name }),
  ]);
  const prof = (profRes.data ?? null) as ProfileRow | null;
  if (!prof || !prof.username) return null;

  const picks = ((betsRes.data ?? []) as PublicBet[]).filter(Boolean);

  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;
  let units = 0;
  let staked = 0;
  let verified = 0;
  let clvSum = 0;
  let clvN = 0;

  for (const b of picks) {
    if (b.price_check === "verified") verified += 1;
    if (b.clv !== null && b.clv !== undefined) {
      clvSum += Number(b.clv);
      clvN += 1;
    }
    if (b.result === "win") wins += 1;
    else if (b.result === "loss") losses += 1;
    else if (b.result === "push") pushes += 1;
    else {
      pending += 1;
      continue; // pending bets move no units and risk nothing yet
    }
    units += betProfit(b);
    staked += Number(b.stake) || 0;
  }

  const settled = wins + losses + pushes;
  return {
    username: prof.username,
    avatarUrl: prof.avatar_url ?? null,
    bio: typeof prof.bio === "string" ? prof.bio : "",
    joined: typeof prof.created_at === "string" ? prof.created_at : null,
    picks,
    wins,
    losses,
    pushes,
    pending,
    settled,
    units,
    staked,
    roi: staked > 0 ? (units / staked) * 100 : null,
    verified,
    clv: clvN > 0 ? clvSum / clvN : null,
  };
}
