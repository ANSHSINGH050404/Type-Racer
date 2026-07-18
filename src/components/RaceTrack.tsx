"use client";

import type { PlayerPublic } from "../../shared/types";

const COLORS = ["#22d3ee", "#a78bfa"];

type Props = {
  players: PlayerPublic[];
  selfId: string | null;
};

export function RaceTrack({ players, selfId }: Props) {
  return (
    <div className="space-y-3">
      {players.map((p, i) => {
        const pct = Math.round(p.progress * 100);
        const color = COLORS[i % COLORS.length]!;
        const isYou = p.id === selfId;
        return (
          <div key={p.id} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-zinc-200">
                {p.name}
                {isYou ? (
                  <span className="ml-2 text-xs font-normal text-zinc-500">you</span>
                ) : null}
                {!p.connected ? (
                  <span className="ml-2 text-xs font-normal text-amber-400/90">
                    reconnecting…
                  </span>
                ) : null}
                {p.finishedAt ? (
                  <span className="ml-2 text-xs font-normal text-emerald-400">done</span>
                ) : null}
              </span>
              <span className="font-mono text-xs text-zinc-500">{pct}%</span>
            </div>
            <div className="relative h-3 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150 ease-out"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
              <div
                className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-zinc-950 shadow transition-[left] duration-150 ease-out"
                style={{
                  left: `calc(${pct}% - 8px)`,
                  backgroundColor: color,
                }}
                title={p.name}
              />
            </div>
          </div>
        );
      })}
      {players.length === 0 ? (
        <p className="text-sm text-zinc-500">Waiting for racers…</p>
      ) : null}
    </div>
  );
}
