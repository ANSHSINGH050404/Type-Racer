"use client";

type Props = {
  passage: string;
  correctChars: number;
  /** Index of current (next) character — usually correctChars while typing cleanly */
  caretIndex: number;
  hasError: boolean;
};

export function TypingPassage({ passage, correctChars, caretIndex, hasError }: Props) {
  return (
    <p className="font-mono text-lg leading-relaxed tracking-wide text-zinc-500 sm:text-xl">
      {passage.split("").map((ch, i) => {
        let className = "text-zinc-600";
        if (i < correctChars) {
          className = "text-zinc-100";
        } else if (i === caretIndex && hasError) {
          className = "bg-red-500/30 text-red-300";
        } else if (i === caretIndex) {
          className = "border-b-2 border-cyan-400 text-zinc-300";
        }
        return (
          <span key={i} className={className}>
            {ch}
          </span>
        );
      })}
    </p>
  );
}
