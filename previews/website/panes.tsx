// The two panes the window opens beside and under the thread, drawn by hand in
// the app's colours: the working tree with a diff, and the thread's terminal.
import { useEffect, useState, type CSSProperties } from "react";
import { Check, GitCompareArrows, SquareTerminal, X } from "lucide-react";
import { FileEntryIcon } from "../../src/ui/FileEntryIcon";
import { reducedMotion } from "./motion";

type Line = [kind: " " | "+" | "-", n: number, text: string];

const files: { path: string; add: number; del: number; lines: Line[] }[] = [
  {
    path: "shared/shortcuts.ts",
    add: 24,
    del: 3,
    lines: [
      [" ", 108, '  terminal: {'],
      [" ", 109, '    title: "Show or hide the terminal",'],
      [" ", 110, '    group: "General",'],
      [" ", 111, "  },"],
      ["+", 112, '  "jump-thread": {'],
      ["+", 113, '    title: "Open one of the first nine activity threads",'],
      ["+", 114, '    group: "Threads",'],
      ["+", 115, "    digits: true,"],
      ["+", 116, '    defaults: one("mod+Digit1"),'],
      ["+", 117, "  },"],
      [" ", 118, "  settle: {"],
      ["-", 119, '    title: "Settle thread",'],
      ["+", 119, '    title: "Settle the open thread",'],
      [" ", 120, '    group: "Threads",'],
    ],
  },
  {
    path: "src/features/sidebar/useActivityKeys.ts",
    add: 41,
    del: 0,
    lines: [
      ["+", 1, "/** ⌘1–9 open the Nth Activity card; holding ⌘ shows the numbers. */"],
      ["+", 2, "export function useActivityKeys(cards: ChatSummary[], open: Open) {"],
      ["+", 3, "  const [held, setHeld] = useState(false);"],
      ["+", 4, "  useEffect(() => {"],
      ["+", 5, "    const down = (event: KeyboardEvent) => {"],
      ["+", 6, "      const slot = digitOf(event);"],
      ["+", 7, "      if (slot && matches(event, \"jump-thread\")) open(cards[slot - 1]);"],
      ["+", 8, "    };"],
      ["+", 9, '    window.addEventListener("keydown", down);'],
      ["+", 10, '    return () => window.removeEventListener("keydown", down);'],
      ["+", 11, "  }, [cards, open]);"],
      ["+", 12, "  return held;"],
      ["+", 13, "}"],
    ],
  },
  {
    path: "src/lib/shortcuts.test.ts",
    add: 38,
    del: 0,
    lines: [
      ["+", 1, 'import { describe, expect, it } from "vitest";'],
      ["+", 2, 'import { slotFor } from "./shortcuts";'],
      ["+", 3, ""],
      ["+", 4, 'describe("jump-thread", () => {'],
      ["+", 5, '  it("opens the Nth Activity card with ⌘N", () => {'],
      ["+", 6, '    expect(slotFor("3", threads)).toBe(threads[2]);'],
      ["+", 7, "  });"],
      ["+", 8, '  it("skips settled threads", () => {'],
      ["+", 9, '    expect(slotFor("2", withSettled)).toBe(open[1]);'],
      ["+", 10, "  });"],
      ["+", 11, '  it("ignores an empty slot", () => {'],
      ["+", 12, '    expect(slotFor("9", threads)).toBeUndefined();'],
      ["+", 13, "  });"],
    ],
  },
];

const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const folder = (path: string) => path.slice(0, path.lastIndexOf("/"));

export function ChangesPane() {
  const [open, setOpen] = useState(0);
  const [staged, setStaged] = useState<boolean[]>([true, false, false]);
  const count = staged.filter(Boolean).length;
  const file = files[open];
  return (
    <section className="rw-changes" aria-label="Changes">
      <header>
        <GitCompareArrows size={14} />
        <strong>Changes</strong>
        <span>main · {files.length} files</span>
      </header>
      <ul>
        {files.map((entry, index) => (
          <li key={entry.path} data-open={index === open || undefined}>
            <button
              type="button"
              className="rw-check"
              role="checkbox"
              aria-checked={staged[index]}
              aria-label={`Stage ${name(entry.path)}`}
              data-rw-stage={index}
              onClick={() => setStaged(staged.map((value, i) => (i === index ? !value : value)))}
            >
              {staged[index] ? <Check size={11} strokeWidth={3} /> : null}
            </button>
            <button type="button" className="rw-file" data-rw-file={index} onClick={() => setOpen(index)}>
              <FileEntryIcon path={entry.path} directory={false} />
              <code>{name(entry.path)}</code>
              <small>{folder(entry.path)}</small>
              <span className="rw-delta">
                <b>+{entry.add}</b> {entry.del ? <i>−{entry.del}</i> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rw-diff" key={file.path}>
        {file.lines.map(([kind, n, text], index) => (
          <div key={index} data-kind={kind === "+" ? "add" : kind === "-" ? "del" : undefined}>
            <span>{n}</span>
            <code>{text}</code>
          </div>
        ))}
      </div>
      <footer>
        <span>{count ? `${count} staged` : "Nothing staged"}</span>
        <button type="button" className="primary" disabled={!count}>
          Commit
        </button>
      </footer>
    </section>
  );
}

const command = "npm run dev";
const output = ["> relay dev", "> vite --host 127.0.0.1", "", "  VITE  ready in 412 ms", "", "  ➜  Local:   http://127.0.0.1:5177/"];
/** The output line after which the server counts as up. */
const READY = 4;

/** The thread's shell, starting a dev server; `onServing` fires once it is listening. */
export function TerminalDrawer({ onServing }: { onServing: () => void }) {
  // 0 types the command, then one output line per step.
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return setStep(output.length);
    if (step >= output.length) return;
    const timer = window.setTimeout(() => setStep(step + 1), step === 0 ? 1500 : 240);
    return () => window.clearTimeout(timer);
  }, [step]);
  const serving = step >= READY;
  useEffect(() => {
    if (serving) onServing();
  }, [serving]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="rw-terminal" aria-label="Terminal">
      <header>
        <SquareTerminal size={14} />
        <strong>Terminal</strong>
        <span>relay</span>
        <X size={14} />
      </header>
      <pre>
        <b>~/relay main* ❯ </b>
        <span className="rw-typed" style={{ "--chars": command.length } as CSSProperties}>
          {command}
        </span>
        {"\n\n"}
        {output.slice(0, step).map((line, index) => (
          <span key={index} data-ok={line.includes("ready") || undefined}>
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}
