"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { customAlphabet } from "nanoid";
import {
  getLastName,
  setRoomName,
  getOrCreatePlayerId,
} from "../../shared/player-session";

const makeRoomId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

export function CreateRaceForm() {
  const router = useRouter();
  const [name, setName] = useState(() =>
    typeof window === "undefined" ? "" : getLastName()
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) return;
    const id = makeRoomId();
    getOrCreatePlayerId(id);
    setRoomName(id, trimmed);
    router.push(`/race/${id}`);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Your name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          maxLength={20}
          placeholder="e.g. Ansh"
          className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none ring-cyan-400/40 placeholder:text-zinc-600 focus:ring-2"
          autoComplete="nickname"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim()}
        className="flex h-12 w-full items-center justify-center rounded-lg bg-cyan-400 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Create race
      </button>
      <p className="text-center text-xs text-zinc-600">
        Share the room link with your friend. Both click Ready to start.
      </p>
    </form>
  );
}
