import "../_shared/desktop-stub";
import { useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ChevronDown,
  FileText,
  Folder,
  MoreHorizontal,
  Pin,
  X,
} from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/ui/workspace-panes.css";
import "./audit-usability.css";
import {
  initAppearance,
  setMode,
  useAppearance,
} from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { QueuedMessages } from "../../src/features/thread/QueuedMessages";
import { NotesChip } from "../../src/features/notes/NotesChip";
import { FolderView } from "../../src/features/files/FileViews";
import { MarkdownPreview } from "../../src/features/files/editor/MarkdownPreview";
import {
  addNote,
  arrangeNote,
  removeNote,
  tickNote,
  type ThreadNote,
} from "../../shared/thread-notes";
import type { ThreadNotesHandle } from "../../src/features/notes/useThreadNotes";
import type { ProjectChat } from "../../shared/projects";
import type { DirEntry } from "../../shared/project-files";
import type { QueueDrop } from "../../src/features/thread/chat-queue";

initAppearance();
initWindowFocus();
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const entries: DirEntry[] = [
  { name: "docs", kind: "dir", size: 0, mtime: 1791702000000, ignored: false },
  {
    name: "badge.svg",
    kind: "file",
    size: 168,
    mtime: 1791702000000,
    ignored: false,
  },
  {
    name: "hello.ts",
    kind: "file",
    size: 33,
    mtime: 1791702000000,
    ignored: false,
  },
  {
    name: "README.md",
    kind: "file",
    size: 179,
    mtime: 1791702000000,
    ignored: false,
  },
];
Object.assign(window.relay, {
  projectDirectory: async () => ({ entries, truncated: false }),
  revealProjectPath: async () => {},
  applyAppearance: async () => {},
  phoneAppearance: async () => {},
});
const queueText =
  "Before changing anything, reproduce the issue in the running app, collect screenshots, check the keyboard behaviour, and write down exactly what happened. Keep the report separate so I can review it first.";
const findings = [
  {
    id: "notes",
    title: "A completed note becomes unfinished again",
    impact:
      "Completion state is discarded; finished work goes back into your next prompt.",
    cause:
      "A one-item list is converted to plain text, which clears done and bypasses the quote filter.",
    files: ["shared/thread-notes.ts:93", "shared/thread-notes.ts:228"],
    steps: [
      "Pin a list of two or more items.",
      "Tick one item as done.",
      "Remove every other item.",
      "Quote the remaining note: the completed item is included.",
    ],
    images: ["notes-before.png", "notes-after.png"],
    caption:
      "Before: one completed item remains beside one unfinished item. After removing the unfinished one: its completion is gone.",
    measured:
      "Verified through the actual Notes UI and quote action in isolated Electron.",
  },
  {
    id: "files",
    title: "Files keeps the metadata and loses the filenames",
    impact:
      "At a supported window width, folder rows are unidentified and the editor no longer says which file is open.",
    cause:
      "Folder rows reserve fixed size/date columns. The toolbar gives its spare space to the path, after all the action buttons.",
    files: [
      "src/features/files/file-browser.css:160",
      "src/ui/workspace-panes.css:285",
      "src/ui/workspace-panes.css:410",
    ],
    steps: [
      "Keep sidebar, chat and Files open, including the file tree.",
      "Resize the main window to 1060 × 760 (minimum supported width is 1050).",
      "Browse the project root, then open README.md.",
      "Folder filenames and the editor's path have zero width.",
    ],
    images: ["folder-detail.png", "toolbar-detail.png"],
    caption:
      "Actual 279 px viewer: names get 0 px, but sizes, timestamps and toolbar actions survive.",
    measured:
      "Measured all four filename spans and the editor path: width = 0 px.",
  },
  {
    id: "queue",
    title: "Opening a pane can make queued text impossible to expand",
    impact:
      "A follow-up becomes clipped after a resize, with no way to read its full text in the queue.",
    cause:
      "The fold measurement runs when text or open changes, but not when the bubble's width changes.",
    files: [
      "src/features/thread/QueuedMessages.tsx:89",
      "src/features/thread/QueuedMessages.tsx:109",
    ],
    steps: [
      "Queue a message that fits in three lines in a wide chat.",
      "Open Files or narrow the window until it needs more than three lines.",
      "Click the queued bubble.",
      "It stays clipped; the expand handler still thinks the message is short.",
    ],
    images: ["queue-detail.png"],
    caption:
      "The queue body contains the full message, but the bubble refuses to expand.",
    measured:
      "Wide: 46/46 px visible/full text. Narrow: 74/208 px. After clicking: still 74/208 px; no open class.",
  },
  {
    id: "markdown",
    title: "README links quietly stop being links",
    impact:
      "Relative document links and section anchors cannot be followed from a Markdown preview.",
    cause:
      "MarkdownPreview passes no local-link handler. RichText renders non-external links as spans; headings have no anchor IDs either.",
    files: [
      "src/features/files/editor/MarkdownPreview.tsx:161",
      "src/ui/RichText.tsx:351",
    ],
    steps: [
      "Open a Markdown file containing [Guide](docs/guide.md) and [Features](#features).",
      "Switch to Preview or Split.",
      "Try clicking or tabbing to either link.",
      "Both are plain spans, so neither navigation nor section jumping works.",
    ],
    images: ["readme-detail.png"],
    caption: "Both apparent links are plain text. Local images do work.",
    measured: "Inspected rendered DOM: 0 anchors for the two Markdown links.",
  },
  {
    id: "drag",
    title: "A tall queued message cannot be dragged below a short one",
    impact:
      "Some queue orders are unreachable by dragging the message you want to move.",
    cause:
      "The drag helper bounds the whole row, but chooses its target by the row's centre. A tall row hits its lower bound before that centre crosses the shorter last row.",
    files: ["src/lib/useDragSort.ts:72", "src/lib/useDragSort.ts:77"],
    steps: [
      "Queue a multi-line message, followed by a one-line message.",
      "Drag the first message below the second, even well past its bottom.",
      "Release: the original order remains.",
      "Drag the short second message above the first: that direction works.",
    ],
    images: ["drag-detail.png"],
    caption:
      "Actual desktop queue: the 97.5 px first row cannot pass the 47.1 px last row. The opposite drag works.",
    measured:
      "Even with the pointer 70 px past the last row, movement clamps at 63.1 px and the order stays unchanged. Independently reproduced with the current browser component.",
  },
];
type View = "findings" | "reproduce" | "polish" | "coverage";
function App() {
  const [view, setView] = useState<View>("findings");
  const [zoomImage, setZoomImage] = useState<string>();
  const look = useAppearance();
  return (
    <div className="audit-shell">
      <aside className="audit-nav">
        <div className="audit-brand">
          Relay <span>audit</span>
        </div>
        <p>11 October 2026</p>
        <nav aria-label="Audit sections">
          {(
            [
              ["findings", "5 confirmed bugs"],
              ["reproduce", "Try the current behaviour"],
              ["polish", "Polish ideas"],
              ["coverage", "History & coverage"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="audit-nav-foot">
          <span>Sample data throughout</span>
          <button
            onClick={() =>
              setMode(look.palette.kind === "dark" ? "light" : "dark")
            }
          >
            {look.palette.kind === "dark" ? "Light" : "Dark"} theme
          </button>
          <a href="./report.md" download>
            Download the written report
          </a>
        </div>
      </aside>
      <main className="audit-main">
        <header className="audit-heading">
          <span className="audit-kicker">AUDIT ONLY · NO PRODUCT FIXES</span>
          <h1>
            {view === "findings"
              ? "Real bugs. With receipts."
              : view === "reproduce"
                ? "Try the broken paths"
                : view === "polish"
                  ? "Small changes that earn their space"
                  : "What I checked, and why"}
          </h1>
          <p>
            {view === "findings"
              ? "Five reproduced problems, grouped by user impact. Screenshots use the current renderer in an isolated desktop session."
              : view === "reproduce"
                ? "These mount the app's actual components on local sample data. Nothing here changes your projects or starts an agent."
                : view === "polish"
                  ? "Interactive UI concepts, not changes to Relay. Same visual language; clearer priorities and fewer surprises."
                  : "Recent chat history set the priorities. Code inspection was followed by browser or desktop reproduction."}
          </p>
        </header>
        {view === "findings" && (
          <>
            <div className="audit-summary">
              <b>Fix first:</b> preserve Notes completion, then protect
              filenames, then repair queue sorting, folding and Markdown links.
            </div>
            {findings.map((f, index) => (
              <article className="audit-finding" key={f.id}>
                <div className="audit-finding-title">
                  <span className="audit-number">{index + 1}</span>
                  <h2>{f.title}</h2>
                  <span className="audit-badge">P2 · reproduced</span>
                </div>
                <p>{f.impact}</p>
                <div className="audit-shots">
                  {f.images.map((src) => (
                    <button
                      key={src}
                      className="audit-shot"
                      aria-label={`Expand evidence ${src}`}
                      onClick={() => setZoomImage(src)}
                    >
                      <img src={`./evidence/${src}`} alt={f.caption} />
                    </button>
                  ))}
                </div>
                <p className="audit-caption">{f.caption}</p>
                <details>
                  <summary>Reproduction & cause</summary>
                  <ol>
                    {f.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <p>
                    <b>Cause:</b> {f.cause}
                  </p>
                  <p>{f.measured}</p>
                  <div className="audit-source">
                    {f.files.map((p) => (
                      <code key={p}>{p}</code>
                    ))}
                  </div>
                </details>
              </article>
            ))}
            <button className="primary" onClick={() => setView("reproduce")}>
              Try the actual components
            </button>
          </>
        )}
        {view === "reproduce" && <Reproductions />}
        {view === "polish" && <Polish />}
        {view === "coverage" && <Coverage />}
      </main>
      {zoomImage && (
        <div
          className="audit-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Evidence image"
          onClick={() => setZoomImage(undefined)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setZoomImage(undefined);
          }}
          tabIndex={-1}
        >
          <button
            autoFocus
            aria-label="Close evidence"
            onClick={() => setZoomImage(undefined)}
          >
            <X size={18} />
          </button>
          <img src={`./evidence/${zoomImage}`} alt="Full evidence screenshot" />
        </div>
      )}
    </div>
  );
}
function Block({
  title,
  children,
  description,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="audit-block">
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  );
}
function Reproductions() {
  return (
    <>
      <QueueRepro />
      <NotesRepro />
      <FilesRepro />
      <Block
        title="4. Markdown links"
        description="Try clicking or tabbing to Guide or Jump to features. This is the actual MarkdownPreview component."
      >
        <div className="audit-readme-current">
          <MarkdownPreview
            where="audit-sample"
            path="README.md"
            text={
              "# Sample project\n\n[Guide](docs/guide.md) · [Jump to features](#features)\n\n## Features\n\nThis should be an anchor destination."
            }
          />
        </div>
      </Block>
    </>
  );
}
function sampleQueue(): NonNullable<ProjectChat["queue"]> {
  const settings = {
    choice: { model: "sample", reasoningEffort: "high" as const, fast: false },
    provider: "codex" as const,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
  };
  return [
    {
      input: { ...settings, id: "q1", body: queueText },
      created: 1791702000000,
    },
    {
      input: { ...settings, id: "q2", body: "Then check keyboard navigation." },
      created: 1791702000100,
    },
  ];
}
function QueueRepro() {
  const [width, setWidth] = useState(700),
    [version, setVersion] = useState(0),
    [queue, setQueue] = useState(sampleQueue),
    [action, setAction] = useState("");
  const move = (id: string, target: QueueDrop) =>
    setQueue((current) => {
      const item = current.find((q) => q.input.id === id)!;
      const remaining = current.filter((q) => q.input.id !== id);
      const at = remaining.findIndex((q) => q.input.id === target.id);
      remaining.splice(at + (target.where === "after" ? 1 : 0), 0, item);
      return remaining;
    });
  return (
    <Block
      title="1. Queue folding and sorting"
      description="Start wide, click Narrow, then click the first bubble: its tail stays hidden. Reset, then drag the long first message below the short second one: it snaps back. Moving the short row above the long one works."
    >
      <div className="audit-controls">
        <button aria-pressed={width === 700} onClick={() => setWidth(700)}>
          Wide · 700 px
        </button>
        <button aria-pressed={width === 280} onClick={() => setWidth(280)}>
          Narrow · 280 px
        </button>
        <button
          onClick={() => {
            setWidth(700);
            setVersion((v) => v + 1);
            setQueue(sampleQueue());
            setAction("");
          }}
        >
          Reset sample
        </button>
      </div>
      <div className="audit-width-box" style={{ width }} key={version}>
        <QueuedMessages
          queue={queue}
          paused
          running={false}
          compacting={false}
          busy={false}
          onMove={move}
          onSteer={(id) => {
            setQueue((q) => q.filter((item) => item.input.id !== id));
            setAction("Sample message sent.");
          }}
          onReturn={(input) => {
            setQueue((q) => q.filter((item) => item.input.id !== input.id));
            setAction(`Returned to sample draft: ${input.body}`);
          }}
          onRemove={(id) =>
            setQueue((q) => q.filter((item) => item.input.id !== id))
          }
        />
      </div>
      <p className="audit-status" role="status">
        {action || "Current app component. Width changes do not remount it."}
      </p>
    </Block>
  );
}
const seedNotes = (): ThreadNote[] => [
  {
    id: "n1",
    text: "1. Inspect the menus\n2. Polish the empty states",
    done: [1],
    created: 1791702000000,
    updated: 1791702000000,
  },
];
function NotesRepro() {
  const [list, setList] = useState(seedNotes),
    [quote, setQuote] = useState("");
  const notes: ThreadNotesHandle = useMemo(
    () => ({
      notes: list,
      keep: async (text) => {
        setList((l) => addNote(l, { text }).notes);
      },
      tick: (id, item, done) => setList((l) => tickNote(l, id, item, done)),
      arrange: (id, order) => setList((l) => arrangeNote(l, id, order)),
      remove: (id) => setList((l) => removeNote(l, id)),
      kept: (text) => list.some((n) => n.text === text),
    }),
    [list],
  );
  return (
    <Block
      title="2. Notes completion"
      description="Open the pin, remove Inspect the menus, then quote the remaining note. Polish the empty states starts checked; deleting its neighbour loses that state."
    >
      <div className="audit-controls">
        <div className="thread-context-controls">
          <NotesChip notes={notes} onQuote={setQuote} onJump={() => {}} />
        </div>
        <button
          onClick={() => {
            setList(seedNotes());
            setQuote("");
          }}
        >
          Reset sample
        </button>
      </div>
      <label className="audit-quote-label">
        What the quote action puts in the draft
        <textarea
          readOnly
          aria-label="Quoted note"
          value={quote}
          placeholder="Nothing quoted yet"
        />
      </label>
    </Block>
  );
}
function FilesRepro() {
  const [width, setWidth] = useState(700),
    [opened, setOpened] = useState("");
  return (
    <Block
      title="3. Folder names"
      description="Switch to Narrow. The actual FolderView keeps sizes and dates but gives every filename 0 px."
    >
      <div className="audit-controls">
        <button aria-pressed={width === 700} onClick={() => setWidth(700)}>
          Wide · 700 px
        </button>
        <button aria-pressed={width === 279} onClick={() => setWidth(279)}>
          Narrow · 279 px
        </button>
      </div>
      <div className="audit-folder-current" style={{ width }}>
        <FolderView
          where="audit-sample"
          dir=""
          title="Sample Project"
          onOpen={(path) => setOpened(path)}
        />
      </div>
      <p className="audit-status" role="status">
        {opened
          ? `Sample selection: ${opened}`
          : "The row still opens; its label is what disappears."}
      </p>
    </Block>
  );
}
function Polish() {
  return (
    <>
      <Block
        title="Files: give the name first refusal"
        description="Two options for a 279 px viewer. Both preserve the filename and a compact unsaved marker; secondary actions go behind ⋯."
      >
        <FilesConcept />
      </Block>
      <Block
        title="Queue: say there is more to read"
        description="Keep the unsent-bubble look you picked. A visible expand button is easier to find, works with the keyboard and does not rely on hover."
      >
        <QueueConcept />
      </Block>
      <Block
        title="Notes: undo in place, without another toast"
        description="You explicitly wanted the floating undo toast gone. This stays inside the Notes card, with a reserved footer so nothing jumps."
      >
        <UndoConcept />
      </Block>
      <Block
        title="Project settings: make their scope discoverable"
        description="From a thread, global Settings search for linked currently returns zero results. Project settings do exist, but only after opening them from a project entry point. This is a scope decision, not a reproduced defect."
      >
        <div className="audit-scope">
          <small>Suggested search result · sample</small>
          <b>
            Linked folders <span>in Sample Project</span>
          </b>
          <p>
            Open the current project's settings. Keep other projects out unless
            one is explicitly selected.
          </p>
        </div>
        <img
          className="audit-context-shot"
          src="./evidence/16-global-linked-search.png"
          alt="Actual global settings search returns zero results for linked"
        />
      </Block>
    </>
  );
}
function FilesConcept() {
  const [variant, setVariant] = useState<"compact" | "details">("compact"),
    [selected, setSelected] = useState("README.md"),
    [menu, setMenu] = useState(false),
    [saved, setSaved] = useState(false);
  return (
    <>
      <div
        className="audit-controls"
        role="group"
        aria-label="Folder layout options"
      >
        <button
          aria-pressed={variant === "compact"}
          onClick={() => setVariant("compact")}
        >
          A · Compact rows
        </button>
        <button
          aria-pressed={variant === "details"}
          onClick={() => setVariant("details")}
        >
          B · Details below
        </button>
      </div>
      <div className="audit-file-concept">
        <header>
          <span
            className={!saved ? "audit-dirty" : ""}
            aria-label={!saved ? "Unsaved changes" : "Saved"}
          />
          <strong>{selected}</strong>
          <button
            aria-label="Save sample file"
            onClick={() => setSaved(true)}
            disabled={saved}
          >
            Save
          </button>
          <button
            aria-label="More sample file actions"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={16} />
          </button>
        </header>
        {menu && (
          <div className="audit-inline-menu">
            {["Preview", "Compare", "Reload"].map((label) => (
              <button key={label} onClick={() => setMenu(false)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div>
          {entries.map((e) => (
            <button
              className={`audit-file-row ${variant}`}
              key={e.name}
              aria-pressed={selected === e.name}
              onClick={() => {
                setSelected(e.name);
                setSaved(false);
              }}
            >
              {e.kind === "dir" ? <Folder size={14} /> : <FileText size={14} />}
              <span>
                <strong>{e.name}</strong>
                {variant === "details" && (
                  <small>
                    {e.kind === "file" ? `${e.size} B · ` : ""}11 Oct, 09:07
                  </small>
                )}
              </span>
              {variant === "compact" && (
                <small>{e.kind === "file" ? `${e.size} B` : ""}</small>
              )}
            </button>
          ))}
        </div>
      </div>
      <p className="audit-status">
        A keeps row height. B keeps metadata. Both are UI concepts on sample
        data.
      </p>
    </>
  );
}
function QueueConcept() {
  const [open, setOpen] = useState(false);
  return (
    <div className="audit-queue-concept">
      <small>Queued · sends after this answer</small>
      <div className="audit-queue-bubble">
        <p className={open ? "open" : ""}>{queueText}</p>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Read full message"}
          <ChevronDown size={13} />
        </button>
      </div>
    </div>
  );
}
function UndoConcept() {
  const [rows, setRows] = useState([
    { id: "a", body: "Inspect the menus", done: false },
    { id: "b", body: "Polish the empty states", done: true },
  ]);
  const [before, setBefore] = useState<typeof rows>();
  return (
    <div className="audit-undo-concept">
      <header>
        <Pin size={13} />
        <b>Notes</b>
        <small>Sample</small>
      </header>
      {rows.map((r) => (
        <div className="audit-undo-row" key={r.id}>
          <input
            type="checkbox"
            checked={r.done}
            aria-label={`Mark ${r.body} ${r.done ? "not done" : "done"}`}
            onChange={() =>
              setRows((list) =>
                list.map((item) =>
                  item.id === r.id ? { ...item, done: !item.done } : item,
                ),
              )
            }
          />
          <span className={r.done ? "done" : ""}>{r.body}</span>
          <button
            aria-label={`Remove ${r.body}`}
            onClick={() => {
              setBefore(rows);
              setRows((list) => list.filter((item) => item.id !== r.id));
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <footer>
        <span role="status">
          {before
            ? "Item removed"
            : `${rows.filter((r) => !r.done).length} remaining`}
        </span>
        {before && (
          <button
            onClick={() => {
              setRows(before);
              setBefore(undefined);
            }}
          >
            Undo
          </button>
        )}
      </footer>
    </div>
  );
}
function Coverage() {
  return (
    <>
      <Block
        title="Your recurring gripes"
        description="I read ten relevant project conversations and the latest 200 commit subjects, with implementation details for the affected controls."
      >
        <ul>
          <li>
            <b>Keep the UI still.</b> The scope picker conversation repeatedly
            calls out flashing and height jumps. Commit 539769f2 reserves the
            picker height.
          </li>
          <li>
            <b>Use real controls.</b> The queue variants were rejected when drag
            sorting was fake; the shipped unsent-bubble direction was chosen.
            Commit 3b75d727.
          </li>
          <li>
            <b>Finished means finished.</b> Completed Notes items must stay out
            of quoted prompts. Commit c6d1714e.
          </li>
          <li>
            <b>Do not bury the useful bit.</b> Searchable linked-folder and
            branch pickers, and keeping the file name visible, drove b27c0bc4
            and b989ae9e.
          </li>
          <li>
            <b>Quiet recovery.</b> The restore shortcut was wanted; its
            overlapping toast was explicitly rejected.
          </li>
        </ul>
      </Block>
      <Block
        title="Verification"
        description="The report separates reproduced behaviour from UI concepts."
      >
        <ul>
          <li>
            Isolated Electron session, temporary sample Git project, fixture
            agent. Existing dev server reused.
          </li>
          <li>
            Current checkout renderer at 1440, 1280 and 1060 px widths. Actual
            DOM and measured geometry, plus screenshots.
          </li>
          <li>
            Current components reproduced again in this page, using the preview
            bridge and sample data.
          </li>
          <li>
            Typecheck passed before and after adding the preview. Final browser
            validation is recorded in report.md.
          </li>
          <li>
            29 existing focused tests passed: Notes, RichText, workspace layout
            state and repository layout rules.
          </li>
          <li>
            Checks that passed: Link folder search + Enter-to-select, table
            selection copying to TSV, stopping the fixture turn and retaining
            its paused queue.
          </li>
        </ul>
      </Block>
      <Block
        title="Limits"
        description="This is a focused usability pass, not a claim that every part of Relay is bug-free."
      >
        <p>
          No real provider calls, remote handoff, phone hardware,
          simulator/device hub, network failures or release build were
          exercised. The desktop main-process bundle was the existing
          development build; the renderer was current source. The confirmed bugs
          live in current renderer/shared code, and their causes were checked
          there. Local compaction-stat edits were read and left alone.
          Screenshot sample titles and messages come from the test fixture, not
          your actual conversations.
        </p>
      </Block>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>,
);
