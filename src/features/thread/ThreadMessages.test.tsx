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

function thread(messages: ChatMessage[]) {
  return {
    history: {
      data: { ...chat, messages },
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
function view(messages: ChatMessage[]) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ThreadMessages
        handle={{ chat, busy: false } as never}
        projectPath="/sample/relay"
        thread={thread(messages)}
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
  document.body.innerHTML = "";
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
