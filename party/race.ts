import type * as Party from "partykit/server";
import { pickPassage } from "../shared/passages";
import {
  COUNTDOWN_MS,
  IDLE_ROOM_MS,
  MAX_PLAYERS,
  RECONNECT_MS,
  type ClientMessage,
  type PlayerPublic,
  type RacePhase,
  type RoomSnapshot,
  type ServerMessage,
} from "../shared/types";
import { calcAccuracy, calcWpm, clampProgress } from "../shared/wpm";

type PlayerInternal = {
  id: string;
  name: string;
  connectionId: string | null;
  ready: boolean;
  correctChars: number;
  totalTyped: number;
  finishedAt: number | null;
  connected: boolean;
  isHost: boolean;
  disconnectDeadline: number | null;
};

type RoomData = {
  /** Cached because Party.id is unavailable inside onAlarm */
  roomId: string;
  phase: RacePhase;
  players: PlayerInternal[];
  passage: string | null;
  lastPassage: string | null;
  countdownEndsAt: number | null;
  raceStartedAt: number | null;
  winnerId: string | null;
};

export default class RaceRoom implements Party.Server {
  roomData: RoomData = emptyRoom("");
  private roomIdSafe = "";

  constructor(readonly room: Party.Room) {
    try {
      this.roomIdSafe = room.id;
    } catch {
      this.roomIdSafe = "";
    }
  }

  async onStart() {
    try {
      this.roomIdSafe = this.room.id;
    } catch {
      // ignore — may be alarm context in some runtimes
    }
    const stored = await this.room.storage.get<RoomData>("state");
    if (stored) {
      this.roomData = stored;
      if (stored.roomId) this.roomIdSafe = stored.roomId;
    } else if (this.roomIdSafe) {
      this.roomData.roomId = this.roomIdSafe;
    }
    await this.scheduleIdle();
  }

  async onConnect(conn: Party.Connection) {
    this.ensureRoomId();
    await this.scheduleIdle();
    this.send(conn, {
      type: "state",
      state: this.snapshot(null),
    });
  }

  async onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    if (typeof message !== "string") return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      this.send(sender, { type: "error", message: "Invalid message" });
      return;
    }

    this.ensureRoomId();
    await this.scheduleIdle();

    switch (msg.type) {
      case "join":
        await this.handleJoin(sender, msg.playerId, msg.name);
        break;
      case "set_ready":
        await this.handleReady(sender, msg.ready);
        break;
      case "progress":
        await this.handleProgress(sender, msg.correctChars, msg.totalTyped);
        break;
      case "finish":
        await this.handleFinish(sender, msg.correctChars, msg.totalTyped);
        break;
      case "rematch":
        await this.handleRematch(sender);
        break;
      default:
        this.send(sender, { type: "error", message: "Unknown message" });
    }
  }

  async onClose(conn: Party.Connection) {
    const player = this.roomData.players.find((p) => p.connectionId === conn.id);
    if (!player) return;

    player.connectionId = null;
    player.connected = false;
    player.disconnectDeadline = Date.now() + RECONNECT_MS;
    await this.persist();
    this.broadcastState();
    await this.scheduleReconnectAlarm();
  }

  async onAlarm() {
    const now = Date.now();

    // Countdown → racing
    if (
      this.roomData.phase === "countdown" &&
      this.roomData.countdownEndsAt &&
      now >= this.roomData.countdownEndsAt
    ) {
      this.roomData.phase = "racing";
      this.roomData.raceStartedAt = this.roomData.countdownEndsAt;
      this.roomData.countdownEndsAt = null;
      await this.persist();
      this.broadcastState();
    }

    // Disconnect forfeits
    let changed = false;
    for (const p of this.roomData.players) {
      if (
        !p.connected &&
        p.disconnectDeadline &&
        now >= p.disconnectDeadline &&
        (this.roomData.phase === "racing" || this.roomData.phase === "countdown")
      ) {
        // Forfeit: mark as finished last / other wins if racing
        if (this.roomData.phase === "racing" || this.roomData.phase === "countdown") {
          this.applyForfeit(p.id);
          changed = true;
        }
        p.disconnectDeadline = null;
      } else if (!p.connected && p.disconnectDeadline && now >= p.disconnectDeadline) {
        // Lobby: drop disconnected player after timeout
        if (this.roomData.phase === "lobby") {
          this.roomData.players = this.roomData.players.filter((x) => x.id !== p.id);
          this.ensureHost();
          changed = true;
        }
        p.disconnectDeadline = null;
      }
    }

    if (changed) {
      await this.persist();
      this.broadcastState();
    }

    // Idle empty room cleanup
    const anyConnected = this.roomData.players.some((p) => p.connected);
    const connections = [...this.room.getConnections()];
    if (!anyConnected && connections.length === 0) {
      this.roomData = emptyRoom(this.roomIdSafe || this.roomData.roomId);
      await this.room.storage.deleteAll();
      return;
    }

    await this.scheduleReconnectAlarm();
    await this.scheduleCountdownAlarm();
    await this.scheduleIdle();
  }

  private async handleJoin(conn: Party.Connection, playerId: string, name: string) {
    const cleanName = sanitizeName(name);
    if (!cleanName) {
      this.send(conn, { type: "error", message: "Name is required (1–20 characters)" });
      return;
    }
    if (!playerId || playerId.length > 64) {
      this.send(conn, { type: "error", message: "Invalid player id" });
      return;
    }

    // Reconnect existing player
    const existing = this.roomData.players.find((p) => p.id === playerId);
    if (existing) {
      // Drop any other connection that claimed this player
      if (existing.connectionId && existing.connectionId !== conn.id) {
        const old = this.room.getConnection(existing.connectionId);
        old?.close(4000, "Replaced by reconnect");
      }
      existing.connectionId = conn.id;
      existing.connected = true;
      existing.disconnectDeadline = null;
      existing.name = cleanName;
      conn.setState({ playerId });
      await this.persist();
      this.broadcastState();
      return;
    }

    if (this.roomData.phase !== "lobby") {
      this.send(conn, { type: "error", message: "Race already in progress" });
      return;
    }

    if (this.roomData.players.length >= MAX_PLAYERS) {
      this.send(conn, { type: "error", message: "Room is full (1v1 only)" });
      return;
    }

    const isHost = this.roomData.players.length === 0;
    this.roomData.players.push({
      id: playerId,
      name: cleanName,
      connectionId: conn.id,
      ready: false,
      correctChars: 0,
      totalTyped: 0,
      finishedAt: null,
      connected: true,
      isHost,
      disconnectDeadline: null,
    });
    conn.setState({ playerId });
    await this.persist();
    this.broadcastState();
  }

  private async handleReady(conn: Party.Connection, ready: boolean) {
    const player = this.playerFromConn(conn);
    if (!player) {
      this.send(conn, { type: "error", message: "Join the room first" });
      return;
    }
    if (this.roomData.phase !== "lobby") {
      this.send(conn, { type: "error", message: "Cannot change ready now" });
      return;
    }

    player.ready = Boolean(ready);
    await this.persist();

    const connected = this.roomData.players.filter((p) => p.connected);
    if (
      connected.length === MAX_PLAYERS &&
      this.roomData.players.length === MAX_PLAYERS &&
      this.roomData.players.every((p) => p.ready && p.connected)
    ) {
      await this.startCountdown();
    } else {
      this.broadcastState();
    }
  }

  private async startCountdown() {
    this.roomData.passage = pickPassage(this.roomData.lastPassage);
    this.roomData.lastPassage = this.roomData.passage;
    this.roomData.phase = "countdown";
    this.roomData.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    this.roomData.raceStartedAt = null;
    this.roomData.winnerId = null;
    for (const p of this.roomData.players) {
      p.correctChars = 0;
      p.totalTyped = 0;
      p.finishedAt = null;
    }
    await this.persist();
    this.broadcastState();
    await this.scheduleCountdownAlarm();
  }

  private promoteCountdownIfDue() {
    if (
      this.roomData.phase === "countdown" &&
      this.roomData.countdownEndsAt &&
      Date.now() >= this.roomData.countdownEndsAt
    ) {
      this.roomData.phase = "racing";
      this.roomData.raceStartedAt = this.roomData.countdownEndsAt;
      this.roomData.countdownEndsAt = null;
    }
  }

  private async handleProgress(
    conn: Party.Connection,
    correctChars: number,
    totalTyped: number
  ) {
    const player = this.playerFromConn(conn);
    this.promoteCountdownIfDue();
    if (!player || this.roomData.phase !== "racing" || !this.roomData.passage) return;
    if (player.finishedAt !== null) return;

    const max = this.roomData.passage.length;
    const cc = clampInt(correctChars, 0, max);
    const tt = clampInt(totalTyped, cc, max * 4);

    // Reject implausible jumps (anti-burst)
    if (cc > player.correctChars + 24) return;

    player.correctChars = Math.max(player.correctChars, cc);
    player.totalTyped = Math.max(player.totalTyped, tt);

    if (player.correctChars >= max) {
      await this.completePlayer(player);
      return;
    }

    await this.persist();
    this.broadcastState();
  }

  private async handleFinish(
    conn: Party.Connection,
    correctChars: number,
    totalTyped: number
  ) {
    const player = this.playerFromConn(conn);
    this.promoteCountdownIfDue();
    if (!player || !this.roomData.passage) return;
    if (this.roomData.phase !== "racing" && this.roomData.phase !== "finished") return;
    if (player.finishedAt !== null) return;

    const max = this.roomData.passage.length;
    if (correctChars < max) {
      // Not actually finished — treat as progress
      await this.handleProgress(conn, correctChars, totalTyped);
      return;
    }

    player.correctChars = max;
    player.totalTyped = clampInt(totalTyped, max, max * 4);
    await this.completePlayer(player);
  }

  private async completePlayer(player: PlayerInternal) {
    if (!this.roomData.passage || !this.roomData.raceStartedAt) return;
    if (player.finishedAt !== null) return;

    const now = Date.now();
    player.finishedAt = now;
    player.correctChars = this.roomData.passage.length;

    if (!this.roomData.winnerId) {
      this.roomData.winnerId = player.id;
    }

    const allDone = this.roomData.players.every(
      (p) => p.finishedAt !== null || !p.connected
    );
    // End race when someone wins (first finish) — others can still complete for stats
    if (this.roomData.phase === "racing") {
      this.roomData.phase = "finished";
    }
    if (allDone) {
      // unready for clarity
      for (const p of this.roomData.players) p.ready = false;
    }

    await this.persist();
    this.broadcastState();
  }

  private applyForfeit(playerId: string) {
    const player = this.roomData.players.find((p) => p.id === playerId);
    if (!player) return;

    if (this.roomData.phase === "countdown") {
      // Abort to lobby
      this.roomData.phase = "lobby";
      this.roomData.passage = null;
      this.roomData.countdownEndsAt = null;
      this.roomData.raceStartedAt = null;
      this.roomData.winnerId = null;
      for (const p of this.roomData.players) {
        p.ready = false;
        p.correctChars = 0;
        p.totalTyped = 0;
        p.finishedAt = null;
      }
      return;
    }

    if (this.roomData.phase === "racing") {
      // Other connected player wins
      const other = this.roomData.players.find((p) => p.id !== playerId && p.connected);
      if (other && !this.roomData.winnerId) {
        this.roomData.winnerId = other.id;
        if (other.finishedAt === null && this.roomData.passage) {
          // They win without finishing text — leave progress as-is
        }
      }
      this.roomData.phase = "finished";
      for (const p of this.roomData.players) p.ready = false;
    }
  }

  private async handleRematch(conn: Party.Connection) {
    const player = this.playerFromConn(conn);
    if (!player) {
      this.send(conn, { type: "error", message: "Join the room first" });
      return;
    }
    if (this.roomData.phase !== "finished" && this.roomData.phase !== "lobby") {
      this.send(conn, { type: "error", message: "Rematch only after a race" });
      return;
    }

    // Mark requester ready for rematch; when both ready (or only one left wants lobby reset)
    player.ready = true;

    const active = this.roomData.players.filter((p) => p.connected);
    if (active.length >= 1 && active.every((p) => p.ready)) {
      // Reset room to lobby with both un-ready... Design: rematch un-readies both then they ready again.
      // Better UX: rematch click = "I want rematch"; when both clicked, go to lobby unready? 
      // Locked design: "Rematch resets ready state, picks new passage when both ready again"
      this.roomData.phase = "lobby";
      this.roomData.passage = null;
      this.roomData.countdownEndsAt = null;
      this.roomData.raceStartedAt = null;
      this.roomData.winnerId = null;
      for (const p of this.roomData.players) {
        p.ready = false;
        p.correctChars = 0;
        p.totalTyped = 0;
        p.finishedAt = null;
      }
    }

    await this.persist();
    this.broadcastState();
  }

  private playerFromConn(conn: Party.Connection): PlayerInternal | undefined {
    const state = conn.state as { playerId?: string } | null;
    if (state?.playerId) {
      return this.roomData.players.find((p) => p.id === state.playerId);
    }
    return this.roomData.players.find((p) => p.connectionId === conn.id);
  }

  private ensureHost() {
    if (this.roomData.players.length === 0) return;
    if (!this.roomData.players.some((p) => p.isHost)) {
      this.roomData.players[0]!.isHost = true;
    }
  }

  private toPublic(p: PlayerInternal): PlayerPublic {
    const passageLen = this.roomData.passage?.length ?? 0;
    const started = this.roomData.raceStartedAt;
    let wpm: number | null = null;
    let accuracy: number | null = null;
    let timeMs: number | null = null;

    if (started && (p.finishedAt || this.roomData.phase === "racing" || this.roomData.phase === "finished")) {
      const end = p.finishedAt ?? (this.roomData.phase === "finished" ? Date.now() : Date.now());
      timeMs = Math.max(0, end - started);
      wpm = calcWpm(p.correctChars, timeMs);
      accuracy = calcAccuracy(p.correctChars, Math.max(p.totalTyped, p.correctChars));
    }

    return {
      id: p.id,
      name: p.name,
      ready: p.ready,
      correctChars: p.correctChars,
      progress: clampProgress(p.correctChars, passageLen || 1),
      finishedAt: p.finishedAt,
      connected: p.connected,
      isHost: p.isHost,
      wpm,
      accuracy,
      timeMs: p.finishedAt && started ? p.finishedAt - started : timeMs,
    };
  }

  private ensureRoomId() {
    if (this.roomData.roomId) {
      this.roomIdSafe = this.roomData.roomId;
      return;
    }
    try {
      this.roomIdSafe = this.room.id;
      this.roomData.roomId = this.roomIdSafe;
    } catch {
      // onAlarm cannot read room.id
    }
  }

  private snapshot(forPlayerId: string | null): RoomSnapshot {
    const showPassage =
      this.roomData.phase === "countdown" ||
      this.roomData.phase === "racing" ||
      this.roomData.phase === "finished";

    return {
      roomId: this.roomData.roomId || this.roomIdSafe,
      phase: this.roomData.phase,
      players: this.roomData.players.map((p) => this.toPublic(p)),
      maxPlayers: MAX_PLAYERS,
      passage: showPassage ? this.roomData.passage : null,
      countdownEndsAt: this.roomData.countdownEndsAt,
      raceStartedAt: this.roomData.raceStartedAt,
      winnerId: this.roomData.winnerId,
      youArePlayerId: forPlayerId,
    };
  }

  private async persist() {
    this.ensureRoomId();
    await this.room.storage.put("state", this.roomData);
  }

  private broadcastState() {
    for (const conn of this.room.getConnections()) {
      const state = conn.state as { playerId?: string } | null;
      const playerId = state?.playerId ?? null;
      this.send(conn, {
        type: "state",
        state: this.snapshot(playerId),
      });
    }
  }

  private send(conn: Party.Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private async scheduleCountdownAlarm() {
    if (this.roomData.phase === "countdown" && this.roomData.countdownEndsAt) {
      await this.room.storage.setAlarm(this.roomData.countdownEndsAt);
    }
  }

  private async scheduleReconnectAlarm() {
    const deadlines = this.roomData.players
      .map((p) => p.disconnectDeadline)
      .filter((d): d is number => d !== null);
    if (deadlines.length === 0) return;
    const next = Math.min(...deadlines);
    const existing = await this.room.storage.getAlarm();
    if (!existing || existing > next) {
      await this.room.storage.setAlarm(next);
    }
  }

  private async scheduleIdle() {
    const when = Date.now() + IDLE_ROOM_MS;
    const existing = await this.room.storage.getAlarm();
    // Don't push idle past sooner alarms
    if (existing && existing < when) return;
    // Only set idle if no sooner work — if countdown pending, countdown wins
    if (this.roomData.phase === "countdown" && this.roomData.countdownEndsAt) {
      await this.room.storage.setAlarm(this.roomData.countdownEndsAt);
      return;
    }
    const reconnects = this.roomData.players
      .map((p) => p.disconnectDeadline)
      .filter((d): d is number => d !== null);
    if (reconnects.length > 0) {
      await this.room.storage.setAlarm(Math.min(...reconnects));
      return;
    }
    await this.room.storage.setAlarm(when);
  }
}

RaceRoom satisfies Party.Worker;

function emptyRoom(roomId: string): RoomData {
  return {
    roomId,
    phase: "lobby",
    players: [],
    passage: null,
    lastPassage: null,
    countdownEndsAt: null,
    raceStartedAt: null,
    winnerId: null,
  };
}

function sanitizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 20);
}

function clampInt(n: number, min: number, max: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
