// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

/**
 * How many times each component rendered, by name, read off every commit the
 * way React's DevTools read it: a subtree that bailed out keeps its old
 * fibers, so the walk skips it, and a fiber that rendered has PerformedWork.
 */
const rendered = vi.hoisted(() => {
  const names = new Map<string, number>();
  type Fiber = {
    tag: number;
    flags: number;
    type: {
      name?: string;
      displayName?: string;
      type?: { name?: string };
      render?: { name?: string };
    } | null;
    child: Fiber | null;
    sibling: Fiber | null;
    alternate: Fiber | null;
  };
  const nameOf = (f: Fiber) =>
    f.type?.displayName ||
    f.type?.name ||
    f.type?.type?.name ||
    f.type?.render?.name ||
    "Anonymous";
  // Function, forwardRef and simple memo components.
  const component = (f: Fiber) => [0, 11, 15].includes(f.tag);
  const PERFORMED_WORK = 1;
  const walk = (parent: Fiber) => {
    for (let f = parent.child; f; f = f.sibling) {
      if (component(f) && (!f.alternate || f.flags & PERFORMED_WORK))
        names.set(nameOf(f), (names.get(nameOf(f)) ?? 0) + 1);
      if (!f.alternate || f.child !== f.alternate.child) walk(f);
    }
  };
  Object.assign(globalThis, {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => {},
      onScheduleFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot: (_: number, root: { current: Fiber }) =>
        walk(root.current),
    },
  });
  return names;
});

/** Renders of each message row, by message id. */
const rows = vi.hoisted(() => new Map<string, number>());

const countedRow = vi.hoisted(
  () =>
    <P extends { message: { id: string } }>(inner: (props: P) => unknown) =>
    (props: P) => {
      rows.set(props.message.id, (rows.get(props.message.id) ?? 0) + 1);
      return inner(props);
    },
);

/** What a test has the desktop answer, by call; anything else finds nothing. */
const answers = vi.hoisted(() => new Map<string, unknown>());

/** The desktop bridge, saying nothing: listeners never hear, calls find nothing. */
const bridge = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get: (_, name: string) =>
          name.startsWith("on")
            ? () => () => {}
            : async () => answers.get(name),
      },
    ),
);

/** Elements each ResizeObserver started watching, by their class. */
const watched = vi.hoisted(() => new Map<string, number>());

vi.hoisted(() => {
  const Observer = window.ResizeObserver;
  class CountingObserver extends Observer {
    observe(target: Element, options?: ResizeObserverOptions) {
      watched.set(target.className, (watched.get(target.className) ?? 0) + 1);
      super.observe(target, options);
    }
  }
  Object.assign(window, {
    ResizeObserver: CountingObserver,
    relay: bridge,
    requestIdleCallback: (run: () => void) => setTimeout(run, 0),
    cancelIdleCallback: (id: number) => clearTimeout(id),
  });
  Object.defineProperty(document, "fonts", {
    value: { ready: new Promise(() => {}) },
  });
});

vi.mock("../../lib/api", () => ({ api: bridge }));

// The desktop holds what the cache already does.
vi.mock("../../lib/chat-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/chat-events")>()),
  fetchChat: async (qc: QueryClient, id: string) =>
    qc.getQueryData(["project-chat", id]),
}));

/** Times the thread's reply roots were worked out, a walk over every message. */
const rootsWorkedOut = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../../shared/projects/messages", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../shared/projects/messages")>();
  return {
    ...original,
    replyRoots: (...args: Parameters<typeof original.replyRoots>) => {
      rootsWorkedOut.count++;
      return original.replyRoots(...args);
    },
  };
});

// Its speech model's state comes from the desktop, which says nothing here.
vi.mock("../dictation/DictationButton", () => ({
  DictationButton: () => null,
}));

vi.mock("./AssistantMessage", async (importOriginal) => {
  const original = await importOriginal<typeof import("./AssistantMessage")>();
  return {
    ...original,
    AssistantMessage: countedRow(original.AssistantMessage as never),
  };
});

vi.mock("./UserMessage", async (importOriginal) => {
  const original = await importOriginal<typeof import("./UserMessage")>();
  return {
    ...original,
    UserMessage: countedRow(original.UserMessage as never),
  };
});

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ChatMessage,
  ChatSummary,
  Project,
  ProjectChat as ProjectChatData,
} from "../../../shared/projects";
import { chatKey } from "../../lib/chat-events";
import { notesKey } from "../notes/useThreadNotes";
import { threadDraftKey, writeDraftText } from "../../lib/thread-storage";
import type { ComposerControls } from "../composer/ProjectComposer";
import { ProjectChat } from "./ProjectChat";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const project = {
  id: "p1",
  name: "Sample",
  path: "/sample/relay",
} as unknown as Project;

const summary = {
  id: "c1",
  projectId: "p1",
  title: "Thread",
  scope: { kind: "project" },
  created: 1,
  updated: 1,
} as unknown as ChatSummary;

const message = (
  id: string,
  role: ChatMessage["role"],
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  body,
  created: Number(id.slice(1)),
  provider: "claude",
  status: "complete",
  version: 1,
  ...extra,
});

/** Five finished turns, then a prompt whose answer is streaming. */
const finished = [1, 2, 3, 4, 5]
  .flatMap((n) => [
    message(`u${n * 2}`, "user", `Question ${n}`),
    message(`a${n * 2 + 1}`, "assistant", `Answer ${n}, with **markdown**.`),
  ])
  .concat(message("u20", "user", "Last question"));

// Past the opening the timeline previews, as most of an answer is.
const opening = "Looking into it. ".repeat(30);

let root: Root | undefined;
let container: HTMLElement | undefined;
const composer = createRef<ComposerControls>();
let cache: QueryClient | undefined;
/** Renders the open thread again, its summary as the thread list now has it. */
let showChat: (chat: ChatSummary) => Promise<void> = async () => {};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = undefined;
  rendered.clear();
  rows.clear();
  watched.clear();
  answers.clear();
  writeDraftText(threadDraftKey("c1"), "");
});

const noop = () => {};
const later = async () => {};

/** The open thread, its last answer streaming; returns a streamed piece. */
async function openStreamingThread() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  let answer = message("a21", "assistant", opening, { status: "streaming" });
  qc.setQueryData<ProjectChatData>(chatKey("c1"), {
    ...summary,
    messages: [...finished, answer],
  } as ProjectChatData);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cache = qc;
  showChat = (chat) =>
    act(async () => {
      root!.render(
        <QueryClientProvider client={qc}>
          <ProjectChat
            onCommand={() => false}
            project={project}
            projects={[project]}
            chat={chat}
            draftId="draft"
            draftScope={{ kind: "project" }}
            onContextUsed={noop}
            onCreated={later}
            onForked={later}
            onOpenThread={later}
            scopes={{
              canChoosePR: false,
              onClearScope: noop,
              onSelectPR: noop,
              onDeepReview: noop,
            }}
            onSwitchProject={noop}
            onAddProject={noop}
            onProjectSettings={noop}
            opens={{ onOpenCode: noop, onOpenFile: noop, onOpenTurnDiff: noop }}
            viewing={{ path: null, viewed: 0, total: 0 }}
            ref={composer}
          />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await showChat(summary);
  // As lib/chat-events puts a pushed version of the answer in the cache.
  return async () => {
    answer = {
      ...answer,
      body: `${answer.body} more`,
      version: answer.version + 1,
    };
    await act(async () => {
      qc.setQueryData<ProjectChatData>(chatKey("c1"), (chat) => ({
        ...chat!,
        messages: chat!.messages.map((m) => (m.id === answer.id ? answer : m)),
      }));
      // The cache tells its observers on a timeout.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
}

/** Three streamed pieces into the open thread's answer, counted from scratch. */
async function streamThreePieces() {
  const streamed = await openStreamingThread();
  rendered.clear();
  rows.clear();
  watched.clear();
  rootsWorkedOut.count = 0;
  for (let piece = 0; piece < 3; piece++) await streamed();
}

it("re-renders only the streaming answer's row, not the finished ones", async () => {
  await streamThreePieces();
  expect(Object.fromEntries(rows)).toEqual({ a21: 3 });
});

it("leaves the notes line under every message alone", async () => {
  await streamThreePieces();
  expect(rendered.get("MessageNotes") ?? 0).toBe(0);
});

it("doesn't measure the timeline again while its turns read the same", async () => {
  await streamThreePieces();
  expect(watched.get("project-messages") ?? 0).toBe(0);
  expect(watched.get("thread-message-column") ?? 0).toBe(0);
});

it("leaves the draft and the composer's controls alone", async () => {
  await streamThreePieces();
  expect(rendered.get("ComposerBody") ?? 0).toBe(0);
  expect(rendered.get("ComposerPromptInput") ?? 0).toBe(0);
  expect(rendered.get("ComposerToolbar") ?? 0).toBe(0);
  // Through the memo, the window still reaches it.
  expect(composer.current?.focus).toBeTypeOf("function");
});

it("leaves the context row's chips and the notice alone", async () => {
  await streamThreePieces();
  expect(rendered.get("ScopeButtons") ?? 0).toBe(0);
  expect(rendered.get("StartedChip") ?? 0).toBe(0);
  expect(rendered.get("ThreadNotice") ?? 0).toBe(0);
  expect(rendered.get("NotesChip") ?? 0).toBe(0);
});

it("shows a command's listing once it arrives, though the composer skips its parent's renders", async () => {
  let list = (_: unknown) => {};
  answers.set("terminalSessions", new Promise((resolve) => (list = resolve)));
  writeDraftText(threadDraftKey("c1"), "/resume ");
  await openStreamingThread();
  expect(document.body.textContent).toContain("Looking for sessions");
  await act(async () => {
    list([
      {
        provider: "claude",
        id: "s1",
        title: "Fix the flaky login test",
        updated: 1,
        turns: 3,
        account: "default",
        live: false,
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.body.textContent).toContain("Fix the flaky login test");
});

it("leaves the thread's folder, branch and linked folders alone", async () => {
  await streamThreePieces();
  expect(rendered.get("ThreadWhere") ?? 0).toBe(0);
  expect(rendered.get("ProjectBranchPicker") ?? 0).toBe(0);
  expect(rendered.get("LinksControl") ?? 0).toBe(0);
  expect(rendered.get("WorktreeDialogs") ?? 0).toBe(0);
});

it("shows the checkout's branch once it arrives, though the branch picker skips streamed pieces", async () => {
  let tree = (_: unknown) => {};
  answers.set("projectWorkingTree", new Promise((resolve) => (tree = resolve)));
  const streamed = await openStreamingThread();
  await streamed();
  expect(document.body.textContent).not.toContain("sample-branch");
  await act(async () => {
    tree({ branch: "sample-branch", changes: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.body.textContent).toContain("sample-branch");
});

it("shows notes kept and dropped mid-answer, though the notes chip skips streamed pieces", async () => {
  const streamed = await openStreamingThread();
  await streamed();
  const chip = () =>
    document.querySelector(".notes-chip")?.getAttribute("aria-label");
  const keep = async (ids: string[]) => {
    const notes = ids.map((id) => ({ id, text: id, created: 1, updated: 1 }));
    await act(async () => {
      cache!.setQueryData(notesKey("c1"), notes);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await streamed();
  };
  expect(chip()).toBeUndefined();
  await keep(["n1"]);
  expect(chip()).toBe("1 note");
  await keep(["n1", "n2"]);
  expect(chip()).toBe("2 notes");
  await keep([]);
  expect(chip()).toBeUndefined();
});

it("shows folders linked and unlinked mid-answer, though the links control skips streamed pieces", async () => {
  const streamed = await openStreamingThread();
  await streamed();
  const linked = () =>
    document.querySelector(".linked-trigger")?.getAttribute("aria-label");
  const before = linked();
  await showChat({
    ...summary,
    links: [{ path: "/sample/docs", access: "read" }],
  });
  await streamed();
  expect(linked()).toBe("1 linked folder");
  await showChat({ ...summary, links: [] });
  await streamed();
  expect(linked()).toBe(before);
});

it("shows the thread's new worktree branch, though the branch row skips streamed pieces", async () => {
  const streamed = await openStreamingThread();
  await streamed();
  expect(document.body.textContent).not.toContain("sample-worktree-branch");
  answers.set("projectWorktree", {
    path: "/sample/worktrees/one",
    branch: "sample-worktree-branch",
    files: [],
  });
  await showChat({
    ...summary,
    worktree: {
      path: "/sample/worktrees/one",
      branch: "sample-worktree-branch",
    },
  });
  await streamed();
  expect(document.body.textContent).toContain("sample-worktree-branch");
});

// The composer's slots, the controls around it, still render on every
// piece: ProjectChat reads the whole thread and hands them fresh objects.
// This may shrink, never grow; lower it when you cut renders.
it("renders at most 44 components a streamed piece", async () => {
  await streamThreePieces();
  const total = [...rendered.values()].reduce((sum, n) => sum + n, 0);
  expect(total / 3).toBeLessThanOrEqual(44);
});

it("works out the reply roots once a streamed piece", async () => {
  await streamThreePieces();
  expect(rootsWorkedOut.count).toBe(3);
});
