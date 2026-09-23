import { useEffect, useState, type CSSProperties } from "react";
import type { ThemedToken } from "@pierre/diffs";
import { tokens, type ResolvedAppearance } from "../lib/themes";
import { tokenize, tokenStyle } from "./CodeBlock";

// Two sides of a small change; the middle lines differ.
const before = [
  "export function latest(thread: Thread) {",
  "  const done = thread.turns.slice(0, -1);",
  "  // Newest first",
  "  return done.reverse()[0] ?? null;",
  "}",
];
const after = [
  "export function latest(thread: Thread) {",
  "  const done = thread.turns.filter(isDone);",
  "  // The running turn has no result yet",
  '  return done.at(-1)?.title ?? "Untitled";',
  "}",
];
const changed = (line: number) => line > 0 && line < before.length - 1;

/** A split diff in `look`'s colours, so a theme can be judged on real code. */
export function ThemeCodePreview({ look }: { look: ResolvedAppearance }) {
  const syntax = look.palette.syntax;
  // Keeps the previous theme's colours while the next one loads.
  const [highlighted, setHighlighted] = useState<ThemedToken[][][]>();
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      [before, after].map((lines) =>
        tokenize(lines.join("\n"), "typescript", syntax),
      ),
    ).then(
      (sides) => {
        if (!cancelled) setHighlighted(sides);
      },
      // The preview stays plain.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [syntax]);
  return (
    <div
      className="theme-code"
      aria-hidden="true"
      style={
        { ...tokens(look), colorScheme: look.palette.kind } as CSSProperties
      }
    >
      {[before, after].map((lines, side) => (
        <div key={side} className="theme-code-side">
          {lines.map((text, line) => (
            <div
              key={line}
              className={`theme-code-line ${
                changed(line) ? (side ? "added" : "removed") : ""
              }`}
            >
              <span className="theme-code-number">{line + 1}</span>
              <code>
                {highlighted?.[side][line]?.map((token, i) => (
                  <span key={i} style={tokenStyle(token)}>
                    {token.content}
                  </span>
                )) ?? text}
              </code>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
