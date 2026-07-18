"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import PartySocket from "partysocket";
import {
  getOrCreatePlayerId,
  getRoomName,
  setRoomName,
} from "../../shared/player-session";
import type {
  ClientMessage,
  RacePhase,
  RoomSnapshot,
  ServerMessage,
} from "../../shared/types";
import { PROGRESS_THROTTLE_MS } from "../../shared/types";
import { getPartyHost, PARTY_NAME } from "@/lib/party-host";
import { CountdownOverlay } from "./CountdownOverlay";
import { LobbyPanel } from "./LobbyPanel";
import { ResultsPanel } from "./ResultsPanel";
import { RaceTrack } from "./RaceTrack";
import { TypingPassage } from "./TypingPassage";

type Props = {
  roomId: string;
};

function subscribeNow(onStoreChange: () => void) {
  const id = window.setInterval(onStoreChange, 50);
  return () => window.clearInterval(id);
}

function getNow() {
  return Date.now();
}

function getServerNow() {
  return 0;
}

function resolvePhase(
  state: RoomSnapshot | null,
  now: number
): RacePhase | null {
  if (!state) return null;
  if (
    state.phase === "countdown" &&
    state.countdownEndsAt &&
    now >= state.countdownEndsAt
  ) {
    return "racing";
  }
  return state.phase;
}

function correctPrefixLength(typed: string, passage: string): number {
  let i = 0;
  while (i < typed.length && typed[i] === passage[i]) i += 1;
  return i;
}

export function RaceRoom({ roomId }: Props) {
  const [nameInput, setNameInput] = useState(() =>
    typeof window === "undefined" ? "" : (getRoomName(roomId) ?? "")
  );
  const [joinedName, setJoinedName] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getRoomName(roomId)
  );
  const [playerId] = useState(() =>
    typeof window === "undefined" ? "" : getOrCreatePlayerId(roomId)
  );
  const [state, setState] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [typed, setTyped] = useState("");
  const [totalTyped, setTotalTyped] = useState(0);
  const [copiedHint, setCopiedHint] = useState(false);
  /** Bumps when a new race attempt starts so local typing resets without setState-in-effect */
  const [raceKey, setRaceKey] = useState("");

  const socketRef = useRef<PartySocket | null>(null);
  const lastProgressSent = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastServerPhase = useRef<RacePhase | null>(null);
  const lastRaceStartedAt = useRef<number | null>(null);

  const roomUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/race/${roomId}`
      : `/race/${roomId}`;

  const tickNow = useSyncExternalStore(subscribeNow, getNow, getServerNow);
  const phase = resolvePhase(state, tickNow);

  const self = state?.players.find((p) => p.id === playerId) ?? null;
  const opponent = state?.players.find((p) => p.id !== playerId) ?? null;

  const passage = state?.passage ?? "";
  const correctChars =
    phase === "racing" && passage ? correctPrefixLength(typed, passage) : 0;
  const hasError =
    phase === "racing" &&
    passage.length > 0 &&
    typed.length > correctChars &&
    typed[correctChars] !== passage[correctChars];

  const send = useCallback((msg: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);

  // Socket lifecycle
  useEffect(() => {
    if (!playerId || !joinedName) return;

    const socket = new PartySocket({
      host: getPartyHost(),
      room: roomId,
      party: PARTY_NAME,
    });
    socketRef.current = socket;

    const onOpen = () => {
      setConnected(true);
      setError(null);
      send({ type: "join", playerId, name: joinedName });
    };

    const onClose = () => {
      setConnected(false);
    };

    const onMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        if (msg.type === "state") {
          const next = msg.state;
          const phaseChanged = lastServerPhase.current !== next.phase;
          const raceChanged = lastRaceStartedAt.current !== next.raceStartedAt;

          if (
            (phaseChanged &&
              (next.phase === "lobby" || next.phase === "countdown")) ||
            (raceChanged && next.phase === "racing")
          ) {
            setTyped("");
            setTotalTyped(0);
            lastProgressSent.current = 0;
            setRaceKey(
              `${next.phase}-${next.raceStartedAt ?? "none"}-${next.countdownEndsAt ?? ""}`
            );
          }

          lastServerPhase.current = next.phase;
          lastRaceStartedAt.current = next.raceStartedAt;
          setState(next);
          setError(null);
        } else if (msg.type === "error") {
          setError(msg.message);
        }
      } catch {
        // ignore
      }
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);

    if (socket.readyState === WebSocket.OPEN) onOpen();

    return () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
      socket.close();
      socketRef.current = null;
    };
  }, [playerId, joinedName, roomId, send]);

  // Focus input when racing starts
  useEffect(() => {
    if (phase !== "racing") return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [phase, raceKey]);

  // Throttled progress to server
  useEffect(() => {
    if (!state || phase !== "racing" || !state.passage) return;
    if (self?.finishedAt) return;

    const now = Date.now();
    const finished = correctChars >= state.passage.length;

    if (finished) {
      send({
        type: "finish",
        correctChars,
        totalTyped: Math.max(totalTyped, typed.length),
      });
      return;
    }

    if (now - lastProgressSent.current >= PROGRESS_THROTTLE_MS) {
      lastProgressSent.current = now;
      send({
        type: "progress",
        correctChars,
        totalTyped: Math.max(totalTyped, typed.length),
      });
    }
  }, [
    correctChars,
    totalTyped,
    typed.length,
    state,
    phase,
    self?.finishedAt,
    send,
  ]);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = nameInput.trim().slice(0, 20);
    if (!name) return;
    setRoomName(roomId, name);
    setJoinedName(name);
  };

  const onType = (value: string) => {
    if (!state?.passage || phase !== "racing") return;
    if (self?.finishedAt) return;

    if (value.length > typed.length + 1) return;
    if (value.length > state.passage.length + 8) return;

    if (value.length > typed.length) {
      setTotalTyped((t) => t + (value.length - typed.length));
    }

    setTyped(value.slice(0, state.passage.length + 1));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
  };

  const onBeforeInput = (e: React.FormEvent<HTMLInputElement>) => {
    const ne = e.nativeEvent as InputEvent;
    if (ne.inputType === "insertFromPaste") {
      e.preventDefault();
      return;
    }
    if (
      typeof ne.data === "string" &&
      ne.data.length > 1 &&
      ne.inputType.startsWith("insert")
    ) {
      e.preventDefault();
    }
  };

  if (!playerId) {
    return <div className="text-sm text-zinc-500">Loading room…</div>;
  }

  if (!joinedName) {
    return (
      <div className="mx-auto w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl">
        <h1 className="text-xl font-semibold text-zinc-50">Join race</h1>
        <p className="mt-1 text-sm text-zinc-500">Room {roomId}</p>
        <form onSubmit={handleJoinSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Display name
            </span>
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value.slice(0, 20))}
              maxLength={20}
              placeholder="Your name"
              className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none ring-cyan-400/40 placeholder:text-zinc-600 focus:ring-2"
            />
          </label>
          <button
            type="submit"
            disabled={!nameInput.trim()}
            className="flex h-11 w-full items-center justify-center rounded-lg bg-cyan-400 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-40"
          >
            Enter lobby
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Type Racer · 1v1
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
            Race room
          </h1>
          <p className="mt-1 font-mono text-xs text-zinc-600">{roomId}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              connected
                ? "border-emerald-500/30 text-emerald-400"
                : "border-amber-500/30 text-amber-400"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                connected ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {connected ? "Live" : "Reconnecting"}
          </span>
          <button
            type="button"
            className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
            onClick={() => {
              void navigator.clipboard.writeText(roomUrl).then(() => {
                setCopiedHint(true);
                window.setTimeout(() => setCopiedHint(false), 1500);
              });
            }}
          >
            {copiedHint ? "Copied" : "Copy link"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {state &&
      (phase === "racing" || phase === "countdown" || phase === "finished") ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <RaceTrack players={state.players} selfId={playerId} />
        </div>
      ) : null}

      {phase === "lobby" && state ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <LobbyPanel
            players={state.players}
            selfId={playerId}
            roomUrl={roomUrl}
            selfReady={Boolean(self?.ready)}
            canReady={Boolean(self) && state.players.length === 2}
            onToggleReady={() =>
              send({ type: "set_ready", ready: !self?.ready })
            }
          />
        </div>
      ) : null}

      {state &&
      (phase === "countdown" || phase === "racing") &&
      state.passage ? (
        <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          {phase === "countdown" && state.countdownEndsAt ? (
            <CountdownOverlay endsAt={state.countdownEndsAt} />
          ) : null}

          <div className="mb-4 flex items-center justify-between text-xs text-zinc-500">
            <span className="uppercase tracking-wider">Passage</span>
            {phase === "racing" && self ? (
              <span className="font-mono">
                {self.wpm != null ? `${self.wpm} wpm` : "—"} ·{" "}
                {Math.round(self.progress * 100)}%
              </span>
            ) : (
              <span>Get ready</span>
            )}
          </div>

          <TypingPassage
            passage={state.passage}
            correctChars={phase === "racing" ? correctChars : 0}
            caretIndex={phase === "racing" ? correctChars : 0}
            hasError={phase === "racing" && hasError}
          />

          <input
            key={raceKey || "race-input"}
            ref={inputRef}
            value={phase === "racing" ? typed : ""}
            onChange={(e) => onType(e.target.value)}
            onPaste={onPaste}
            onBeforeInput={onBeforeInput}
            disabled={phase !== "racing" || Boolean(self?.finishedAt)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="mt-6 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 font-mono text-zinc-100 outline-none ring-cyan-400/30 placeholder:text-zinc-600 focus:ring-2 disabled:opacity-50"
            placeholder={
              phase === "countdown"
                ? "Wait for GO…"
                : self?.finishedAt
                  ? "Finished"
                  : "Type the passage here"
            }
            aria-label="Race typing input"
          />
        </div>
      ) : null}

      {phase === "finished" && state ? (
        <ResultsPanel
          players={state.players}
          winnerId={state.winnerId}
          selfId={playerId}
          rematchPending={Boolean(self?.ready)}
          opponentRematchReady={Boolean(opponent?.ready)}
          onRematch={() => send({ type: "rematch" })}
        />
      ) : null}

      {!state && connected ? (
        <p className="text-sm text-zinc-500">Syncing room state…</p>
      ) : null}
    </div>
  );
}
