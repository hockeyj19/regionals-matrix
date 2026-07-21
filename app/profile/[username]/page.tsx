import { redirect } from "next/navigation";

/**
 * A shared profile link (tapenotes.vercel.app/profile/<username>) now opens
 * the app itself instead of a standalone read-only page. This route's only
 * job is to hand the username to the app and step aside: it 307-redirects to
 * "/?profile=<username>", where the root page either drops a signed-in
 * visitor straight onto that profile (full tab bar, click anywhere) or shows
 * a signed-out visitor the sign-up form first and resumes there afterward.
 *
 * No data fetching here on purpose - Profile.tsx already knows how to handle
 * a username that turns out not to exist, so this stays a one-line redirect.
 */

type Props = { params: Promise<{ username: string }> };

export default async function PublicProfileRedirect({ params }: Props) {
  const { username } = await params;
  redirect(`/?profile=${encodeURIComponent(username)}`);
}
