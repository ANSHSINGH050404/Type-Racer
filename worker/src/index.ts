import { pickPassage } from "../../shared/passages";
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
} from "../../shared/types";
import { calcAccuracy, calcWpm, clampProgress } from "../../shared/wpm";

export interface Env {
  RACE_ROOM: DurableObjectNamespace;
  APP_NAME?: string;
}

/** Entry worker: route /parties/:party/:room → Durable Object */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight for browser tooling
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Health
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "type-racer-room" });
    }

    // Match PartySocket path: /parties/main/<roomId>
    const match = url.pathname.match(/^\/parties\/[^/]+\/([^/]+)\/?$/);
    if (!match) {
      return json({ error: "Not found. Use /parties/main/:roomId" }, 404);
    }

    const roomId = decodeURIComponent(match[1]!);
    if (!roomId || roomId.length > 64) {
      return json({ error: "Invalid room id" }, 400);
    }

    const id = env.RACE_ROOM.idFromName(roomId);
    const stub = env.RACE_ROOM.get(id);

    // Forward roomId so the DO can include it without relying on request URL alone
    const headers = new Headers(request.headers);
    headers.set("X-Room-Id", roomId);
    return stub.fetch(
      new Request(request.url, {
        method: request.method,
        headers,
        body: request.body,
        // @ts-expect-error duplex required for streaming bodies in some runtimes
        duplex: "half",
      })
    );
  },
};

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
  roomId: string;
  phase: RacePhase;
  players: PlayerInternal[];
  passage: string | null;
  lastPassage: string | null;
  countdownEndsAt: number | null;
  raceStartedAt: number | null;
  winnerId: string | null;
};

type ConnMeta = {
  playerId?: string;
};

export class RaceRoom implements DurableObject {
  private roomData: RoomData = emptyRoom("");
  private sessions = new Map<WebSocket, ConnMeta>();
  private loaded = false;

  constructor(
    private readonly ctx: DurableObjectState,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly env: Env
  ) {
    // Hibernate-friendly: restore accepted sockets
    this.ctx.getWebSockets().forEach((ws) => {
      const meta = (ws.deserializeAttachment() as ConnMeta | null) ?? {};
      this.sessions.set(ws, meta);
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded(request.headers.get("X-Room-Id") ?? "");

    if (request.headers.get("Upgrade") !== "websocket") {
      return json({
        roomId: this.roomData.roomId,
        phase: this.roomData.phase,
        players: this.roomData.players.length,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    this.sessions.set(server, {});
    server.serializeAttachment({});

    // Initial state (no player yet)
    this.send(server, { type: "state", state: this.snapshot(null) });
    await this.scheduleIdle();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.ensureLoaded(this.roomData.roomId);
    if (typeof message !== "string") return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "Invalid message" });
      return;
    }

    await this.scheduleIdle();

    switch (msg.type) {
      case "join":
        await this.handleJoin(ws, msg.playerId, msg.name);
        break;
      case "set_ready":
        await this.handleReady(ws, msg.ready);
        break;
      case "progress":
        await this.handleProgress(ws, msg.correctChars, msg.totalTyped);
        break;
      case "finish":
        await this.handleFinish(ws, msg.correctChars, msg.totalTyped);
        break;
      case "rematch":
        await this.handleRematch(ws);
        break;
      default:
        this.send(ws, { type: "error", message: "Unknown message" });
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.ensureLoaded(this.roomData.roomId);
    const meta = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (!meta?.playerId) return;
    const player = this.roomData.players.find((p) => p.id === meta.playerId);
    if (!player) return;

    // Only mark disconnected if this was still their active socket
    if (player.connectionId === meta.playerId || player.connected) {
      // connectionId stores a synthetic id; match by playerId on the socket meta
      const stillOpen = [...this.sessions.entries()].some(
        ([socket, m]) => m.playerId === player.id && socket !== ws
      );
      if (stillOpen) return;

      player.connectionId = null;
      player.connected = false;
      player.disconnectDeadline = Date.now() + RECONNECT_MS;
      await this.persist();
      this.broadcastState();
      await this.scheduleReconnectAlarm();
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    await this.ensureLoaded(this.roomData.roomId);
    const now = Date.now();

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

    let changed = false;
    for (const p of [...this.roomData.players]) {
      if (!p.connected && p.disconnectDeadline && now >= p.disconnectDeadline) {
        if (this.roomData.phase === "racing" || this.roomData.phase === "countdown") {
          this.applyForfeit(p.id);
          changed = true;
        } else if (this.roomData.phase === "lobby") {
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

    const anyConnected = this.roomData.players.some((p) => p.connected);
    if (!anyConnected && this.sessions.size === 0) {
      this.roomData = emptyRoom(this.roomData.roomId);
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.scheduleReconnectAlarm();
    await this.scheduleCountdownAlarm();
    await this.scheduleIdle();
  }

  private async ensureLoaded(roomId: string) {
    if (this.loaded) return;
    const stored = await this.ctx.storage.get<RoomData>("state");
    if (stored) {
      this.roomData = stored;
    } else if (roomId) {
      this.roomData = emptyRoom(roomId);
    }
    if (roomId && !this.roomData.roomId) {
      this.roomData.roomId = roomId;
    }
    this.loaded = true;
  }

  private async handleJoin(ws: WebSocket, playerId: string, name: string) {
    const cleanName = sanitizeName(name);
    if (!cleanName) {
      this.send(ws, { type: "error", message: "Name is required (1–20 characters)" });
      return;
    }
    if (!playerId || playerId.length > 64) {
      this.send(ws, { type: "error", message: "Invalid player id" });
      return;
    }

    const existing = this.roomData.players.find((p) => p.id === playerId);
    if (existing) {
      // Drop previous sockets for this player
      for (const [socket, meta] of this.sessions) {
        if (meta.playerId === playerId && socket !== ws) {
          try {
            socket.close(4000, "Replaced by reconnect");
          } catch {
            // ignore
          }
          this.sessions.delete(socket);
        }
      }
      existing.connectionId = playerId;
      existing.connected = true;
      existing.disconnectDeadline = null;
      existing.name = cleanName;
      this.sessions.set(ws, { playerId });
      ws.serializeAttachment({ playerId });
      await this.persist();
      this.broadcastState();
      return;
    }

    if (this.roomData.phase !== "lobby") {
      this.send(ws, { type: "error", message: "Race already in progress" });
      return;
    }

    if (this.roomData.players.length >= MAX_PLAYERS) {
      this.send(ws, { type: "error", message: "Room is full (1v1 only)" });
      return;
    }

    const isHost = this.roomData.players.length === 0;
    this.roomData.players.push({
      id: playerId,
      name: cleanName,
      connectionId: playerId,
      ready: false,
      correctChars: 0,
      totalTyped: 0,
      finishedAt: null,
      connected: true,
      isHost,
      disconnectDeadline: null,
    });
    this.sessions.set(ws, { playerId });
    ws.serializeAttachment({ playerId });
    await this.persist();
    this.broadcastState();
  }

  private async handleReady(ws: WebSocket, ready: boolean) {
    const player = this.playerFromWs(ws);
    if (!player) {
      this.send(ws, { type: "error", message: "Join the room first" });
      return;
    }
    if (this.roomData.phase !== "lobby") {
      this.send(ws, { type: "error", message: "Cannot change ready now" });
      return;
    }

    player.ready = Boolean(ready);
    await this.persist();

    if (
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

  private async handleProgress(ws: WebSocket, correctChars: number, totalTyped: number) {
    const player = this.playerFromWs(ws);
    this.promoteCountdownIfDue();
    if (!player || this.roomData.phase !== "racing" || !this.roomData.passage) return;
    if (player.finishedAt !== null) return;

    const max = this.roomData.passage.length;
    const cc = clampInt(correctChars, 0, max);
    const tt = clampInt(totalTyped, cc, max * 4);
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

  private async handleFinish(ws: WebSocket, correctChars: number, totalTyped: number) {
    const player = this.playerFromWs(ws);
    this.promoteCountdownIfDue();
    if (!player || !this.roomData.passage) return;
    if (this.roomData.phase !== "racing" && this.roomData.phase !== "finished") return;
    if (player.finishedAt !== null) return;

    const max = this.roomData.passage.length;
    if (correctChars < max) {
      await this.handleProgress(ws, correctChars, totalTyped);
      return;
    }

    player.correctChars = max;
    player.totalTyped = clampInt(totalTyped, max, max * 4);
    await this.completePlayer(player);
  }

  private async completePlayer(player: PlayerInternal) {
    if (!this.roomData.passage || !this.roomData.raceStartedAt) return;
    if (player.finishedAt !== null) return;

    player.finishedAt = Date.now();
    player.correctChars = this.roomData.passage.length;
    if (!this.roomData.winnerId) {
      this.roomData.winnerId = player.id;
    }
    if (this.roomData.phase === "racing") {
      this.roomData.phase = "finished";
    }
    await this.persist();
    this.broadcastState();
  }

  private applyForfeit(playerId: string) {
    if (this.roomData.phase === "countdown") {
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
      const other = this.roomData.players.find((p) => p.id !== playerId && p.connected);
      if (other && !this.roomData.winnerId) {
        this.roomData.winnerId = other.id;
      }
      this.roomData.phase = "finished";
      for (const p of this.roomData.players) p.ready = false;
    }
  }

  private async handleRematch(ws: WebSocket) {
    const player = this.playerFromWs(ws);
    if (!player) {
      this.send(ws, { type: "error", message: "Join the room first" });
      return;
    }
    if (this.roomData.phase !== "finished" && this.roomData.phase !== "lobby") {
      this.send(ws, { type: "error", message: "Rematch only after a race" });
      return;
    }

    player.ready = true;
    const active = this.roomData.players.filter((p) => p.connected);
    if (active.length >= 1 && active.every((p) => p.ready)) {
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

  private playerFromWs(ws: WebSocket): PlayerInternal | undefined {
    const meta = this.sessions.get(ws) ?? (ws.deserializeAttachment() as ConnMeta | null);
    if (!meta?.playerId) return undefined;
    return this.roomData.players.find((p) => p.id === meta.playerId);
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

    if (
      started &&
      (p.finishedAt ||
        this.roomData.phase === "racing" ||
        this.roomData.phase === "finished")
    ) {
      const end = p.finishedAt ?? Date.now();
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

  private snapshot(forPlayerId: string | null): RoomSnapshot {
    const showPassage =
      this.roomData.phase === "countdown" ||
      this.roomData.phase === "racing" ||
      this.roomData.phase === "finished";

    return {
      roomId: this.roomData.roomId,
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

  private broadcastState() {
    for (const [ws, meta] of this.sessions) {
      try {
        this.send(ws, {
          type: "state",
          state: this.snapshot(meta.playerId ?? null),
        });
      } catch {
        // socket may be closing
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    ws.send(JSON.stringify(msg));
  }

  private async persist() {
    await this.ctx.storage.put("state", this.roomData);
  }

  private async scheduleCountdownAlarm() {
    if (this.roomData.phase === "countdown" && this.roomData.countdownEndsAt) {
      await this.ctx.storage.setAlarm(this.roomData.countdownEndsAt);
    }
  }

  private async scheduleReconnectAlarm() {
    const deadlines = this.roomData.players
      .map((p) => p.disconnectDeadline)
      .filter((d): d is number => d !== null);
    if (deadlines.length === 0) return;
    const next = Math.min(...deadlines);
    const existing = await this.ctx.storage.getAlarm();
    if (!existing || existing > next) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  private async scheduleIdle() {
    const when = Date.now() + IDLE_ROOM_MS;
    if (this.roomData.phase === "countdown" && this.roomData.countdownEndsAt) {
      await this.ctx.storage.setAlarm(this.roomData.countdownEndsAt);
      return;
    }
    const reconnects = this.roomData.players
      .map((p) => p.disconnectDeadline)
      .filter((d): d is number => d !== null);
    if (reconnects.length > 0) {
      await this.ctx.storage.setAlarm(Math.min(...reconnects));
      return;
    }
    const existing = await this.ctx.storage.getAlarm();
    if (existing && existing < when) return;
    await this.ctx.storage.setAlarm(when);
  }
}

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

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}
