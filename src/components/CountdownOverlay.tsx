"use client";

import { useSyncExternalStore } from "react";

type Props = {
  endsAt: number;
};

function subscribe(onStoreChange: () => void) {
  const id = window.setInterval(onStoreChange, 50);
  return () => window.clearInterval(id);
}

function getSnapshot() {
  return Date.now();
}

function getServerSnapshot() {
  return 0;
}

export function CountdownOverlay({ endsAt }: Props) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const left = Math.max(0, endsAt - now);
  const seconds = Math.ceil(left / 1000);
  const label = seconds > 0 ? String(seconds) : "GO";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-zinc-950/70 backdrop-blur-[2px]">
      <div
        key={label}
        className="animate-pulse font-mono text-7xl font-bold tracking-tighter text-cyan-300 sm:text-8xl"
      >
        {label}
      </div>
    </div>
  );
}
