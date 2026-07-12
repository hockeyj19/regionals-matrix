import { ImageResponse } from "next/og";
import { getPublicProfile } from "@/lib/publicProfile";
import { fmtUnits } from "@/lib/format";

/**
 * The card that renders when a profile link is pasted into Discord, iMessage or
 * anywhere else that unfurls a URL. This is what makes a verified record
 * travel: the receiver sees the number before they ever click.
 *
 * Rendered by satori, which supports only inline styles and needs an explicit
 * display on every element that has more than one child.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Verified record on Tape Notes";

export default async function OgImage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const p = await getPublicProfile(username);

  const record = p ? `${p.wins}-${p.losses}-${p.pushes}` : "—";
  const units = p ? fmtUnits(p.units) : "—";
  const roi = p && p.roi !== null ? `${p.roi >= 0 ? "+" : ""}${p.roi.toFixed(1)}%` : "—";
  const name = p ? p.username : "Tape Notes";
  const good = !p || p.units >= 0;
  const tone = good ? "#10b981" : "#f87171";
  const verified = p?.verified ?? 0;

  const cell = (label: string, value: string, color: string) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "28px 36px",
        borderRadius: 20,
        border: "2px solid #262626",
        background: "#111111",
        minWidth: 260,
      }}
    >
      <div style={{ display: "flex", fontSize: 22, color: "#737373", letterSpacing: 2 }}>
        {label}
      </div>
      <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color }}>{value}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          padding: 64,
          border: "8px solid #10b981",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", fontSize: 28, color: "#10b981", letterSpacing: 4 }}>
            TAPE NOTES
          </div>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, color: "#fafafa" }}>
            {name}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#a3a3a3" }}>
            {verified > 0
              ? `${verified} pick${verified === 1 ? "" : "s"} price-verified against the sharp board`
              : "Verified picks, priced off the sharp board"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 24 }}>
          {cell("RECORD", record, "#fafafa")}
          {cell("UNITS", units, tone)}
          {cell("ROI", roi, tone)}
        </div>
      </div>
    ),
    { ...size }
  );
}
