// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({
  api: new Proxy({}, { get: () => async () => undefined }),
}));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChatMessage, ProjectChat } from "../../../shared/projects";
import { ThreadMessages } from "./ThreadMessages";
import { clearArrival, markArrivalRead, noteArrival } from "./arrival";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const message = (
  id: string,
  role: ChatMessage["role"],
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  body,
  created: 1,
  provider: "claude",
  status: "complete",
  version: 1,
  ...extra,
});

// Two answers each with a line under them: the rows a thread adds beside its
// messages are where a key copied from one message to the next slips in.
const chat = {
  id: "c1",
  projectId: "p1",
  title: "Thread",
  scope: { kind: "project" },
  created: 1,
  updated: 1,
  messages: [],
  abandonedHandoffs: [
    {
      id: "h1",
      computer: "macmini",
      at: 2,
      ranHere: { after: "a1", since: 1 },
    },
    {
      id: "h2",
      computer: "macmini",
      at: 4,
      ranHere: { after: "a2", since: 3 },
    },
  ],
} as unknown as ProjectChat;

function thread(messages: ChatMessage[], sample = chat) {
  return {
    history: {
      data: { ...sample, messages },
      isPending: false,
      error: null,
      refetch: async () => undefined,
    },
    root: undefined,
    shown: messages,
    listed: messages,
    running: messages.some((m) => m.status === "streaming"),
    replyCounts: new Map(),
    sideThreads: new Map(),
    leadAnswered: true,
  } as never;
}

const noop = () => {};
function view(messages: ChatMessage[], sample = chat) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ThreadMessages
        handle={{ chat: sample, busy: false } as never}
        projectPath="/sample/relay"
        thread={thread(messages, sample)}
        view={
          {
            scroll: { current: null },
            column: { current: null },
            onScroll: noop,
            visible: 100,
            earlier: false,
            showEarlier: noop,
            dockHeight: 0,
          } as never
        }
        councils={
          {
            review: undefined,
            fixFindings: noop,
            setFindingStatus: noop,
            resumeReview: noop,
          } as never
        }
        actions={
          {
            signIn: noop,
            openReply: noop,
            forkThread: noop,
            openChanges: noop,
            openFile: noop,
            openTurnDiff: noop,
            rewindTurn: async () => ({ conflicts: [] }),
          } as never
        }
        queue={
          {
            steer: noop,
            move: noop,
            returnToComposer: noop,
            remove: noop,
          } as never
        }
        worktree={{ status: undefined, folder: "/sample/relay" } as never}
        onResume={noop}
        onSteer={noop}
        onCompose={noop as never}
      />
    </QueryClientProvider>
  );
}

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  clearArrival();
  document.body.innerHTML = "";
});

let sampleId = 0;
function unreadThread(messages: ChatMessage[]) {
  const sample = { ...chat, id: `unread-${sampleId++}` };
  noteArrival({
    chatId: sample.id,
    readTo: 20,
    updated: 30,
    now: 40,
    opened: true,
    refocused: false,
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(view(messages, sample)));
  return { host, chatId: sample.id };
}

it.each<Partial<ChatMessage>>([
  { handoff: { from: "claude", to: "codex" } },
  { role: "user", resumed: true },
  { compaction: true },
  { reload: { skills: { added: ["release"], removed: [] } } },
  { role: "user", pageAnswer: { title: "Pick a layout" } },
  {
    worktreeCommand: {
      kind: "setup",
      command: "npm ci",
      output: "ok",
      exitCode: 0,
    },
  },
])("folds unread into an adjacent divider already seen: %j", (extra) => {
  const { host, chatId } = unreadThread([
    message("prompt", "user", "Fix the flaky spec"),
    message("line", "assistant", "A session note", {
      created: 10,
      ended: 11,
      ...extra,
    }),
    message("answer", "assistant", "Done.", { created: 30 }),
  ]);
  const mark = host.querySelector('[data-message-id="line"] .unread-mark');
  expect(mark).not.toBeNull();
  expect(host.querySelector(".unread-divider")).toBeNull();
  act(() => markArrivalRead(chatId));
  expect(mark?.hasAttribute("data-read")).toBe(true);
  expect(host.querySelector('[data-message-id="line"]')).not.toBeNull();
});

it("finds the visible divider across hidden handoff prompts", () => {
  const { host } = unreadThread([
    message("prompt", "user", "Fix the flaky spec"),
    message("line", "assistant", "Handoff note", {
      created: 10,
      handoff: { from: "claude", to: "codex", computer: "macmini" },
    }),
    message("kickoff", "user", "Carry on with this work", {
      created: 12,
      handedOver: true,
    }),
    message("answer", "assistant", "Done.", { created: 30 }),
  ]);
  expect(host.querySelector('[data-message-id="kickoff"]')).toBeNull();
  expect(
    host.querySelector('[data-message-id="line"] .unread-mark'),
  ).not.toBeNull();
  expect(host.querySelector(".unread-divider")).toBeNull();
});

it("keeps a standalone unread divider when a visible message separates the lines", () => {
  const { host } = unreadThread([
    message("line", "assistant", "Handoff note", {
      created: 10,
      handoff: { from: "claude", to: "codex" },
    }),
    message("prompt", "user", "Now check the phone", { created: 12 }),
    message("answer", "assistant", "Done.", { created: 30 }),
  ]);
  expect(host.querySelector(".unread-mark")).toBeNull();
  expect(host.querySelectorAll(".unread-divider")).toHaveLength(1);
});

it("keeps unread on the notes directly above it, including under a hidden prompt", () => {
  const { host } = unreadThread([
    message("prompt", "user", "Fix the flaky spec"),
    // This id has a ran-here note in the sample chat.
    message("a1", "user", "Carry on", { created: 10, handedOver: true }),
    message("answer", "assistant", "Done.", { created: 30 }),
  ]);
  expect(host.querySelector(".message-notes .unread-mark")).not.toBeNull();
  expect(host.querySelector(".unread-divider")).toBeNull();
});

it("keeps every message and the lines under them as the thread grows, each row its own", () => {
  const first = [
    message("u1", "user", "Fix the flaky spec"),
    message("a1", "assistant", "Added a wait."),
    message("u2", "user", "And the other one"),
    message("a2", "assistant", "Done too."),
  ];
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(view(first)));
  // An answer streaming in changes the list under the rows already drawn.
  const grown = [
    ...first,
    message("u3", "user", "Now the phone"),
    message("a3", "assistant", "Looking", { status: "streaming" }),
  ];
  act(() => root!.render(view(grown)));
  const ids = [...host.querySelectorAll<HTMLElement>("[data-message-id]")].map(
    (m) => m.dataset.messageId,
  );
  expect(ids).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
  expect(host.textContent?.match(/macmini/g)).toHaveLength(2);
});
