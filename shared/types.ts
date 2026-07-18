export type RacePhase = "lobby" | "countdown" | "racing" | "finished";

export type PlayerPublic = {
  id: string;
  name: string;
  ready: boolean;
  correctChars: number;
  progress: number;
  finishedAt: number | null;
  connected: boolean;
  isHost: boolean;
  wpm: number | null;
  accuracy: number | null;
  timeMs: number | null;
};

export type RoomSnapshot = {
  roomId: string;
  phase: RacePhase;
  players: PlayerPublic[];
  maxPlayers: number;
  /** Only present from countdown onward */
  passage: string | null;
  countdownEndsAt: number | null;
  raceStartedAt: number | null;
  winnerId: string | null;
  youArePlayerId: string | null;
};

export type ClientMessage =
  | { type: "join"; playerId: string; name: string }
  | { type: "set_ready"; ready: boolean }
  | { type: "progress"; correctChars: number; totalTyped: number }
  | { type: "finish"; correctChars: number; totalTyped: number }
  | { type: "rematch" };

export type ServerMessage =
  | { type: "state"; state: RoomSnapshot }
  | { type: "error"; message: string };

export const COUNTDOWN_MS = 3000;
export const RECONNECT_MS = 45_000;
export const IDLE_ROOM_MS = 15 * 60 * 1000;
export const PROGRESS_THROTTLE_MS = 150;
export const MAX_PLAYERS = 2;
