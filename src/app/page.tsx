import { CreateRaceForm } from "@/components/CreateRaceForm";

export default function HomePage() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-20 size-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -right-16 bottom-10 size-80 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="mb-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400/80">
            Private 1v1
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
            Type Racer
          </h1>
          <p className="mx-auto mt-3 max-w-md text-balance text-zinc-400">
            Challenge a friend to a typing duel. Same passage, first to finish
            wins. No accounts — just a link.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl backdrop-blur">
          <CreateRaceForm />
        </div>

        <ul className="mt-8 grid gap-3 text-sm text-zinc-500 sm:grid-cols-3">
          <li className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-3 text-center">
            Share a room link
          </li>
          <li className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-3 text-center">
            Both ready up
          </li>
          <li className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-3 text-center">
            Race & rematch
          </li>
        </ul>
      </div>
    </main>
  );
}
