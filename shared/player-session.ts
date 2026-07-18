const nameKey = (roomId: string) => `tr-name-${roomId}`;
const playerKey = (roomId: string) => `tr-player-${roomId}`;
const lastNameKey = "tr-last-name";

export function getOrCreatePlayerId(roomId: string): string {
  if (typeof window === "undefined") return "";
  const existing = sessionStorage.getItem(playerKey(roomId));
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `p_${Math.random().toString(36).slice(2, 12)}`;
  sessionStorage.setItem(playerKey(roomId), id);
  return id;
}

export function getRoomName(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(nameKey(roomId)) ?? sessionStorage.getItem(lastNameKey);
}

export function setRoomName(roomId: string, name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim().slice(0, 20);
  sessionStorage.setItem(nameKey(roomId), trimmed);
  sessionStorage.setItem(lastNameKey, trimmed);
}

export function getLastName(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(lastNameKey) ?? "";
}
