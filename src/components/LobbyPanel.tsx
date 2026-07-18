"use client";

import type { PlayerPublic } from "../../shared/types";

type Props = {
  players: PlayerPublic[];
  selfId: string | null;
  roomUrl: string;
  onToggleReady: () => void;
  selfReady: boolean;
  canReady: boolean;
};

export function LobbyPanel({
  players,
  selfId,
  roomUrl,
  onToggleReady,
  selfReady,
  canReady,
}: Props) {
  const slots = [0, 1].map((i) => players[i] ?? null);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Lobby
        </p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-50">
          Waiting for both racers to ready up
        </h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {slots.map((p, i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-4"
          >
            {p ? (
              <>
                <p className="font-medium text-zinc-100">
                  {p.name}
                  {p.id === selfId ? (
                    <span className="ml-2 text-xs text-zinc-500">you</span>
                  ) : null}
                  {p.isHost ? (
                    <span className="ml-2 text-xs text-zinc-500">host</span>
                  ) : null}
                </p>
                <p
                  className={`mt-2 text-sm font-medium ${
                    p.ready ? "text-emerald-400" : "text-zinc-500"
                  }`}
                >
                  {p.ready ? "Ready" : "Not ready"}
                  {!p.connected ? " · reconnecting" : ""}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-zinc-500">Empty seat</p>
                <p className="mt-2 text-sm text-zinc-600">Share the link</p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Invite link
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <code className="flex-1 truncate rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs text-cyan-200/90 sm:text-sm">
            {roomUrl}
          </code>
          <button
            type="button"
            className="h-10 shrink-0 rounded-lg border border-zinc-700 px-4 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
            onClick={() => {
              void navigator.clipboard.writeText(roomUrl);
            }}
          >
            Copy
          </button>
        </div>
      </div>

      <button
        type="button"
        disabled={!canReady}
        onClick={onToggleReady}
        className={`inline-flex h-12 w-full items-center justify-center rounded-lg text-sm font-semibold transition sm:w-auto sm:min-w-[160px] ${
          selfReady
            ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            : "bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {selfReady ? "Unready" : "Ready"}
      </button>
      {players.length < 2 ? (
        <p className="text-sm text-zinc-500">
          Ready unlocks when your opponent joins.
        </p>
      ) : null}
    </div>
  );
}
