import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Play, Moon, Sun } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "./resumed-divider.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { Message } from "../../src/features/thread/ProjectMessage";
import type { ChatMessage } from "../../shared/projects";

initAppearance();

const prompt =
  "Continue from where the previous response was stopped. Check what has already been done before repeating any actions.";
const today = new Date();
const at = (hour: number, minute: number) =>
  new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    hour,
    minute,
  ).getTime();

const sample = (
  id: string,
  role: ChatMessage["role"],
  body: string,
  created: number,
): ChatMessage => ({
  id,
  role,
  body,
  created,
  provider: "codex",
  status: "complete",
  version: 1,
});
const before = [
  sample(
    "question",
    "user",
    "Can you fix the sidebar flicker when a thread finishes?",
    at(14, 35),
  ),
  {
    ...sample(
      "stopped",
      "assistant",
      "Found the cause: finishing a turn refreshes the entire thread list. I’ve updated it to patch the affected thread; next I’ll check the sidebar behavior.",
      at(14, 36),
    ),
    status: "cancelled" as const,
  },
];
const resumed = sample("resume", "user", prompt, at(14, 42));
const after = sample(
  "continued",
  "assistant",
  "The sidebar now stays put when a turn finishes. I checked the update path and the sidebar test passes.",
  at(14, 42),
);

const options = [
  {
    id: "line",
    label: "Quiet divider",
    note: "My pick. The same visual language as the date separator, in a neutral color.",
  },
  {
    id: "icon",
    label: "With an icon",
    note: "A little more explicit. The play icon marks an action without turning it into a message.",
  },
  {
    id: "pill",
    label: "Small pill",
    note: "More visible while scrolling, though it adds a little more UI to the conversation.",
  },
] as const;
type Variant = (typeof options)[number]["id"];
const noop = () => {};

function SampleMessage({ message }: { message: ChatMessage }) {
  return (
    <Message
      message={message}
      chatId=""
      projectRoot="/sample/relay"
      onReply={noop}
      onChanges={noop}
      onTurnDiff={noop}
      onOpenFile={noop}
      onRewind={async () => ({ conflicts: [] })}
    />
  );
}

function ResumeMarker({ variant }: { variant: Variant }) {
  if (variant === "line")
    return <SampleMessage message={{ ...resumed, resumed: true }} />;
  return (
    <div
      className={`context-compaction resume-marker resume-marker-${variant}`}
      role="separator"
      aria-label="Resumed at 14:42"
    >
      <span className="resume-marker-label">
        <Play size={11} aria-hidden="true" />
        <span>Resumed</span>
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(at(14, 42)).toISOString()}>14:42</time>
      </span>
    </div>
  );
}

function App() {
  const [variant, setVariant] = useState<Variant>("line");
  const [original, setOriginal] = useState(false);
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark",
  );
  return (
    <main className="resumed-preview">
      <header className="resume-preview-controls">
        <div className="resume-preview-heading">
          <h1>A quieter resume</h1>
          <span>Sample conversation</span>
        </div>
        <div
          className="resume-preview-switcher"
          role="group"
          aria-label="Divider style"
        >
          {options.map((option) => (
            <button
              key={option.id}
              aria-pressed={!original && variant === option.id}
              onClick={() => {
                setVariant(option.id);
                setOriginal(false);
              }}
            >
              {option.label}
            </button>
          ))}
          <button
            aria-pressed={original}
            onClick={() => setOriginal((value) => !value)}
          >
            Original bubble
          </button>
          <button
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => {
              setMode(dark ? "light" : "dark");
              setDark(!dark);
            }}
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
        <p>
          {original
            ? "The current resume prompt appears as a full message from you."
            : options.find((option) => option.id === variant)!.note}
        </p>
      </header>
      <section className="resume-preview-chat" aria-label="Sample thread">
        <header className="resume-preview-thread-title">
          Fix sidebar flicker <span>Relay</span>
        </header>
        <div className="project-messages">
          <div className="thread-message-column">
            {before.map((message) => (
              <SampleMessage key={message.id} message={message} />
            ))}
            {original ? (
              <SampleMessage message={resumed} />
            ) : (
              <ResumeMarker variant={variant} />
            )}
            <SampleMessage message={after} />
          </div>
        </div>
        <footer className="resume-preview-footer">
          {original
            ? "Full generated prompt in the conversation."
            : "Stays in the history. No animation or fade. The generated prompt is hidden."}
        </footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
