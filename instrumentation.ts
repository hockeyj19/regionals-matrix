import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Every server-side request error - RSC renders, route handlers, server
// actions - lands in Sentry with request context.
export const onRequestError = Sentry.captureRequestError;
