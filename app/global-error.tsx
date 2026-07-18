"use client";

// Root error boundary: any render crash that would white-screen the app is
// captured to Sentry and the user gets a way back instead of a dead page.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#0a0a0a",
          color: "#e5e5e5",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 14, color: "#a3a3a3", marginBottom: 12 }}>
            Something broke - it has been reported.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              border: "1px solid #10b981",
              color: "#34d399",
              background: "transparent",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
