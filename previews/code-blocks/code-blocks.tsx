// Code blocks in chat: ▶ types a command into the thread's terminal, the
// buttons stay in reach on a tall block, and ```mermaid draws its diagram.
// Open http://127.0.0.1:5177/previews/code-blocks/
import "../_shared/desktop-stub";
import "../_shared/app-styles";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { RunCommand } from "../../src/ui/CodeBlock";
import { RichText } from "../../src/ui/ui";

initAppearance();
initWindowFocus();

const longBlock = Array.from(
  { length: 70 },
  (_, i) => `  step${i + 1}: run the ${i % 2 ? "linter" : "tests"} again`,
).join("\n");

const ANSWER = `Install and check it, then run \`npm run typecheck\` and \`git status --short\`. The file \`src/ui/CodeBlock.tsx\` and the word \`git\` stay plain.

\`\`\`bash
# install first
npm ci
npm run typecheck   # renderer, main, preload, tests
\`\`\`

\`\`\`console
$ npm test

> relay@0.1.0 test
 ✓ 12 passed
\`\`\`

\`\`\`
npx vite --config vite.scratch.config.ts --port 5191
\`\`\`

\`\`\`ts
const notACommand = "npm install";
\`\`\`

How a message gets to the agent:

\`\`\`mermaid
flowchart LR
  C[Composer] -->|send| M[Main process]
  M --> H{Agent host}
  H -->|Claude| A[Answer]
  H -->|Codex| A
  A --> T[Thread]
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant P as Phone
  participant D as Desktop
  P->>D: queued message
  D-->>P: answer streams back
\`\`\`

This one is broken on purpose:

\`\`\`mermaid
flowchart LR
  A -->
  B -->> C ((
\`\`\`

A tall block, to scroll past with its buttons:

\`\`\`yaml
pipeline:
${longBlock}
\`\`\`

The end.`;

/** Streams the answer in, a few characters at a time, to see fences close. */
function useStreamed(text: string, streaming: boolean) {
  const [length, setLength] = useState(text.length);
  useEffect(() => {
    if (!streaming) return setLength(text.length);
    setLength(0);
    const timer = window.setInterval(
      () =>
        setLength((n) => {
          if (n >= text.length) window.clearInterval(timer);
          return Math.min(text.length, n + 9);
        }),
      30,
    );
    return () => window.clearInterval(timer);
  }, [text, streaming]);
  return text.slice(0, length);
}

function Preview() {
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [typed, setTyped] = useState<string[]>([]);
  const text = useStreamed(ANSWER, streaming);
  const run = async (command: string) => {
    if (busy) return false;
    setTyped((all) => [...all, command]);
    return true;
  };
  return (
    <div style={{ display: "flex", height: "100vh", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "8px 28px",
          fontSize: 11,
          color: "var(--muted)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span>Sample data · the real chat renderer</span>
        <button className="text-button" onClick={() => setMode("light")}>
          Light
        </button>
        <button className="text-button" onClick={() => setMode("dark")}>
          Dark
        </button>
        <label>
          <input
            type="checkbox"
            checked={busy}
            onChange={(e) => setBusy(e.target.checked)}
          />{" "}
          Terminal busy
        </label>
        <button className="text-button" onClick={() => setStreaming((s) => !s)}>
          {streaming ? "Show whole answer" : "Stream it in"}
        </button>
      </div>
      <section className="project-chat">
        <RunCommand.Provider value={run}>
          <div className="project-messages">
            <div className="thread-message-column">
              <article className="project-message">
                <RichText text={text} />
              </article>
            </div>
          </div>
        </RunCommand.Provider>
      </section>
      <pre
        data-testid="typed"
        style={{
          margin: 0,
          padding: "8px 28px",
          fontSize: 11,
          borderTop: "1px solid var(--border)",
          maxHeight: 90,
          overflow: "auto",
        }}
      >
        {typed.length
          ? typed.map((t) => `terminal ← ${JSON.stringify(t)}`).join("\n")
          : "Nothing typed into the terminal yet."}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
