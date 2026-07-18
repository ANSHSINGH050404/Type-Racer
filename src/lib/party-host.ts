/** PartyKit host for browser clients. Override with NEXT_PUBLIC_PARTYKIT_HOST. */
export function getPartyHost(): string {
  if (process.env.NEXT_PUBLIC_PARTYKIT_HOST) {
    return process.env.NEXT_PUBLIC_PARTYKIT_HOST;
  }
  if (typeof window !== "undefined") {
    // Local PartyKit dev server default
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      return "127.0.0.1:1999";
    }
  }
  // Deployed PartyKit project: type-racer.<user>.partykit.dev — set env in production
  return "127.0.0.1:1999";
}

export const PARTY_NAME = "main";
