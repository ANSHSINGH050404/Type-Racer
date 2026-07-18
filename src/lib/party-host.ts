/**
 * Realtime room host (Cloudflare Worker / local wrangler).
 * Override with NEXT_PUBLIC_PARTYKIT_HOST (legacy name kept for env compatibility).
 */
export function getPartyHost(): string {
  if (process.env.NEXT_PUBLIC_PARTYKIT_HOST) {
    return process.env.NEXT_PUBLIC_PARTYKIT_HOST;
  }
  if (typeof window !== "undefined") {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      // `wrangler dev` default
      return "127.0.0.1:8787";
    }
  }
  // Production Cloudflare Worker (Durable Object rooms)
  return "type-racer-room.anshsingh-typeracer.workers.dev";
}

export const PARTY_NAME = "main";
