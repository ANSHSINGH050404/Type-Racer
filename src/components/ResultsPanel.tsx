"use client";

import type { PlayerPublic } from "../../shared/types";

type Props = {
  players: PlayerPublic[];
  winnerId: string | null;
  selfId: string | null;
  onRematch: () => void;
  rematchPending: boolean;
  opponentRematchReady: boolean;
};

export function ResultsPanel({
  players,
  winnerId,
  selfId,
  onRematch,
  rematchPending,
  opponentRematchReady,
}: Props) {
  const winner = players.find((p) => p.id === winnerId);
  const youWon = winnerId === selfId;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
        Race complete
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
        {winner
          ? youWon
            ? "You win"
            : `${winner.name} wins`
          : "Race over"}
      </h2>

      <ul className="mt-6 space-y-3">
        {players.map((p) => {
          const isWinner = p.id === winnerId;
          return (
            <li
              key={p.id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                isWinner
                  ? "border-cyan-500/40 bg-cyan-500/10"
                  : "border-zinc-800 bg-zinc-950/50"
              }`}
            >
              <div>
                <p className="font-medium text-zinc-100">
                  {p.name}
                  {p.id === selfId ? (
                    <span className="ml-2 text-xs text-zinc-500">you</span>
                  ) : null}
                  {isWinner ? (
                    <span className="ml-2 text-xs text-cyan-300">1st</span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {p.finishedAt
                    ? `${((p.timeMs ?? 0) / 1000).toFixed(1)}s`
                    : p.connected
                      ? "still typing…"
                      : "disconnected"}
                </p>
              </div>
              <div className="text-right font-mono text-sm">
                <p className="text-zinc-100">{p.wpm != null ? `${p.wpm} wpm` : "—"}</p>
                <p className="text-zinc-500">
                  {p.accuracy != null ? `${p.accuracy}% acc` : "—"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onRematch}
          disabled={rematchPending}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-cyan-400 px-5 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-default disabled:opacity-70"
        >
          {rematchPending ? "Waiting for opponent…" : "Rematch"}
        </button>
        {opponentRematchReady && !rematchPending ? (
          <p className="text-sm text-zinc-400">Opponent wants a rematch</p>
        ) : null}
      </div>
    </div>
  );
}
