// /btw: a side question Claude answers from its context without tools, while
// the main turn keeps going. Asking opens it as a side thread, like a reply;
// the main thread keeps the question, dashed, with a thread bar under it.
// Sample data, the app's own styles. Open http://127.0.0.1:5177/previews/btw.html
import "./desktop-stub";
import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowUp,
  FolderGit2,
  LockKeyhole,
  MessageCircleQuestion,
} from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/composer-model-picker.css";
import "../src/components/code-references.css";
import "./deep-review.css";
import "./btw.css";
import { initAppearance, setMode, useAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import { ProviderIcon } from "../src/components/ComposerModelPicker";
import { AgentTurn } from "../src/components/AgentTurn";
import { MessageActions } from "../src/components/MessageActions";
import { RichText } from "../src/components/ui";
import type { AgentTrace, ChatMessage } from "../shared/projects";

initAppearance();
initWindowFocus();

type TurnState = "running" | "finished";
interface Reply {
  id: string;
  role: "user" | "assistant";
  body: string;
  created: number;
}
interface Aside {
  id: string;
  question: string;
  /** Absent while Claude is answering. */
  answer?: string;
  created: number;
  replies: Reply[];
}

const projectRoot = "/Users/sample/relay";
const started = Date.now() - 4 * 60000;
const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const steps: {
  kind: "commentary" | "read" | "search" | "file" | "command";
  text: string;
}[] = [
  { kind: "commentary", text: "Looking at how slash commands are registered." },
  { kind: "read", text: "shared/commands.ts" },
  { kind: "search", text: "supportedCommands" },
  { kind: "read", text: "electron/rooms/claude-project.ts" },
  { kind: "file", text: "shared/commands.ts" },
  { kind: "command", text: "npx vitest run tests/unit/commands.test.ts" },
];

function mainTurn(state: TurnState): ChatMessage {
  const running = state === "running";
  const trace = steps.map((s, i): AgentTrace => {
    const id = `main-${i}`;
    if (s.kind === "commentary")
      return { kind: "commentary", id, text: s.text };
    return {
      kind: "activity",
      id,
      activity: {
        id,
        kind: s.kind,
        label: s.text,
        status: running && i === steps.length - 1 ? "running" : "complete",
      },
    };
  });
  return {
    id: "main",
    role: "assistant",
    provider: "claude",
    status: running ? "streaming" : "complete",
    body: running
      ? ""
      : "Added `btw` to `relayCommands` in `shared/commands.ts`. The command's tests pass.",
    created: started + 20000,
    ...(running ? {} : { ended: started + 3 * 60000 }),
    trace,
    version: 1,
  };
}

// Sample answers, matched loosely to what was asked.
function answerFor(question: string) {
  if (/sdk|version|pinned/i.test(question))
    return "Yes, `package.json` pins `@anthropic-ai/claude-agent-sdk` at `0.3.276`.";
  if (/fork|reply/i.test(question))
    return "From the answer it replies to. Each Claude answer keeps a `forkPoint`, and `forkFor` in `electron/project-chats.ts` resumes a copy of the session cut right after it.";
  return "(Sample answer.) I answer from what's already in this session's context, without tools, so I can't check a file I haven't read yet. Continue in the side thread if you want me to look.";
}
const replyText =
  "(Sample reply.) Still a side question: I see the main conversation as it stands now plus this thread, but I can't read files or run anything from here.";

const seeded: Aside[] = [
  {
    id: "a1",
    question: "where does a reply thread get its fork point from?",
    answer: answerFor("fork"),
    created: started + 90000,
    replies: [],
  },
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="preview-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function App() {
  const appearance = useAppearance();
  const [turn, setTurn] = useState<TurnState>("running");
  const [asides, setAsides] = useState<Aside[]>(seeded);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState(
    "/btw is the SDK still pinned to 0.3.276?",
  );
  const [dock, setDock] = useState(0);
  const [sent, setSent] = useState(0);
  const [toast, setToast] = useState<string>();
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(undefined), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (ms: number, fn: () => void) =>
    timers.current.push(window.setTimeout(fn, ms));
  const update = (id: string, fn: (a: Aside) => Aside) =>
    setAsides((all) => all.map((a) => (a.id === id ? fn(a) : a)));

  const open = asides.find((a) => a.id === openId);
  const btw = /^\/btw\s+([\s\S]+)$/i.exec(draft.trim());

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (open) {
      const id = crypto.randomUUID();
      update(open.id, (a) => ({
        ...a,
        replies: [
          ...a.replies,
          { id, role: "user", body: text, created: Date.now() },
        ],
      }));
      later(1400, () =>
        update(open.id, (a) => ({
          ...a,
          replies: [
            ...a.replies,
            {
              id: id + "-a",
              role: "assistant",
              body: replyText,
              created: Date.now(),
            },
          ],
        })),
      );
    } else if (btw) {
      const id = crypto.randomUUID();
      const question = btw[1];
      setAsides((all) => [
        ...all,
        { id, question, created: Date.now(), replies: [] },
      ]);
      later(1600, () =>
        update(id, (a) => ({ ...a, answer: answerFor(question) })),
      );
      setOpenId(id);
    } else {
      setToast("Preview: only /btw questions do something in the main thread");
      return;
    }
    setDraft("");
    setSent((n) => n + 1);
  };

  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <MessageCircleQuestion size={14} /> /btw side questions
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Main turn</span>
          <Segmented<TurnState>
            label="Main turn"
            value={turn}
            onChange={setTurn}
            options={[
              { value: "running", label: "Running" },
              { value: "finished", label: "Finished" },
            ]}
          />
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setAsides(seeded);
            setOpenId(null);
            setDraft("/btw is the SDK still pinned to 0.3.276?");
          }}
        >
          Reset
        </button>
        <span className="spacer" />
        <Segmented<string>
          label="Colour mode"
          value={appearance.palette.kind}
          onChange={(v) => setMode(v as "light" | "dark")}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>

      <div className="preview-titlebar">
        <FolderGit2 size={14} />
        <span className="muted">relay</span>
        <span className="muted">/</span>
        <span>Add a /btw command</span>
      </div>

      <div className="project-chat-pane">
        <section
          className="project-chat"
          style={{ "--composer-dock-height": `${dock}px` } as CSSProperties}
        >
          <div className="thread-subheader">
            {open ? (
              <button className="text-button" onClick={() => setOpenId(null)}>
                <ArrowLeft size={14} />
                Back to conversation
              </button>
            ) : (
              <span className="thread-privacy">
                <LockKeyhole size={13} /> Private thread
              </span>
            )}
          </div>

          <Thread sent={sent + (openId ? 1000 : 0)}>
            {open ? (
              <SideThread aside={open} onToast={setToast} />
            ) : (
              <>
                <article className="project-message user">
                  <header>
                    <strong>You</strong>
                    <time>{time(started)}</time>
                  </header>
                  <div className="markdown">
                    <p>
                      Add a <code>/btw</code> command that asks Claude a side
                      question without interrupting the turn it's running.
                    </p>
                  </div>
                </article>
                <MainAnswer turn={turn} onToast={setToast} />
                {asides.map((a) => (
                  <DashedQuestion key={a.id} aside={a} onOpen={setOpenId} />
                ))}
              </>
            )}
          </Thread>

          <Dock onHeight={setDock}>
            <form
              className="project-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                className="composer-prompt-input dr-textarea dr-docked"
                aria-label={open ? "Reply in side thread" : "Message Claude"}
                placeholder={
                  open
                    ? "Reply in this side thread…"
                    : turn === "running"
                      ? "Steer Claude, or /btw to ask on the side…"
                      : "Ask Claude, or /btw to ask on the side…"
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="composer-tools">
                {!open && btw ? (
                  <span className="btw-hint">
                    Side question · answered from context, doesn't interrupt
                    Claude
                  </span>
                ) : open ? (
                  <span className="btw-hint">
                    Each reply is another side question: Claude sees the main
                    conversation and this thread, no tools
                  </span>
                ) : null}
                <span className="spacer" />
                <button
                  type="submit"
                  className="send-message"
                  aria-label="Send"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </form>
          </Dock>
        </section>
      </div>

      {toast && (
        <div className="dr-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function MainAnswer({
  turn,
  onToast,
}: {
  turn: TurnState;
  onToast: (text: string) => void;
}) {
  const message = mainTurn(turn);
  return (
    <article className="project-message assistant">
      <header>
        <strong>
          <ProviderIcon provider="claude" />
          Claude
        </strong>
      </header>
      <AgentTurn
        message={message}
        projectRoot={projectRoot}
        onOpenFile={() => onToast("Opens the file, as in the app")}
        onChanges={() => {}}
      />
      {message.body && (
        <RichText
          text={message.body}
          projectRoot={projectRoot}
          onOpenFile={() => onToast("Opens the file, as in the app")}
        />
      )}
      <MessageActions
        text={message.body}
        sent={message.created}
        pending={message.status === "streaming"}
        onReply={() => onToast("Opens a reply thread, as in the app")}
      />
    </article>
  );
}

/**
 * D: the question as a normal message, outlined dashed with no fill. The
 * answer stays in its side thread; a Slack-style bar under the question
 * opens it.
 */
function DashedQuestion({
  aside: a,
  onOpen,
}: {
  aside: Aside;
  onOpen: (id: string) => void;
}) {
  const replies = (a.answer ? 1 : 0) + a.replies.length;
  const last = a.replies.at(-1)?.created ?? a.created;
  const replied = a.replies.some((r) => r.role === "user");
  return (
    <article className="project-message user btw-dashed">
      <header>
        <strong>You</strong>
        <time>{time(a.created)}</time>
      </header>
      <div className="markdown">
        <p>{a.question}</p>
        <button
          type="button"
          className="btw-thread-bar"
          onClick={() => onOpen(a.id)}
        >
          <span className="btw-thread-faces" aria-hidden>
            <span className="btw-face">
              <ProviderIcon provider="claude" />
            </span>
            {replied && <span className="btw-face you">Y</span>}
          </span>
          {a.answer ? (
            <>
              <strong>
                {replies} {replies === 1 ? "reply" : "replies"}
              </strong>
              <span className="btw-thread-when">
                Last reply {time(Math.max(last, a.created))}
              </span>
              <span className="btw-thread-view">View thread ›</span>
            </>
          ) : (
            <span className="btw-thread-when">Claude is answering…</span>
          )}
        </button>
      </div>
    </article>
  );
}

/** A side thread, like a reply; follow-ups are side questions too. */
function SideThread({
  aside: a,
  onToast,
}: {
  aside: Aside;
  onToast: (text: string) => void;
}) {
  return (
    <>
      <h2 className="reply-heading">Side question</h2>
      <article className="project-message user btw-dashed">
        <header>
          <strong>You</strong>
          <time>{time(a.created)}</time>
        </header>
        <div className="markdown">
          <p>{a.question}</p>
        </div>
      </article>
      <article className="project-message assistant">
        <header>
          <strong>
            <ProviderIcon provider="claude" />
            Claude
          </strong>
          <span className="muted">from context · no tools</span>
        </header>
        {a.answer ? (
          <RichText
            text={a.answer}
            projectRoot={projectRoot}
            onOpenFile={() => {}}
          />
        ) : (
          <p className="btw-answering">Answering from context…</p>
        )}
      </article>
      {a.replies.map((r) => (
        <article key={r.id} className={`project-message ${r.role}`}>
          <header>
            <strong>
              {r.role === "assistant" && <ProviderIcon provider="claude" />}
              {r.role === "user" ? "You" : "Claude"}
            </strong>
            {r.role === "user" ? (
              <time>{time(r.created)}</time>
            ) : (
              <span className="muted">from context · no tools</span>
            )}
          </header>
          {r.role === "user" ? (
            <div className="markdown">
              <p>{r.body}</p>
            </div>
          ) : (
            <>
              <RichText
                text={r.body}
                projectRoot={projectRoot}
                onOpenFile={() => {}}
              />
              <MessageActions
                text={r.body}
                sent={r.created}
                pending={false}
                onReply={() => onToast("Already in the side thread")}
              />
            </>
          )}
        </article>
      ))}
      {a.replies.at(-1)?.role === "user" && (
        <p className="btw-answering">Answering from context…</p>
      )}
    </>
  );
}

function Thread({ children, sent }: { children: ReactNode; sent: number }) {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    follow.current = true;
    const e = scroll.current!;
    e.scrollTop = e.scrollHeight;
  }, [sent]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      const e = scroll.current!;
      if (follow.current) e.scrollTop = e.scrollHeight;
    });
    observer.observe(column.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="project-messages"
      ref={scroll}
      onScroll={() => {
        const e = scroll.current!;
        follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 80;
      }}
    >
      <div className="thread-message-column" ref={column}>
        {children}
      </div>
    </div>
  );
}

function Dock({
  children,
  onHeight,
}: {
  children: ReactNode;
  onHeight: (height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() =>
      onHeight(ref.current!.offsetHeight),
    );
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [onHeight]);
  return (
    <div className="thread-bottom-composer" ref={ref}>
      <div className="thread-compose-wrap">{children}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
