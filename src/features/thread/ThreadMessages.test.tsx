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
import * as trace from "../../../shared/agent-trace";

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

function thread(messages: ChatMessage[], lastInput?: ProjectChat["lastInput"]) {
  return {
    history: {
      data: { ...chat, messages, lastInput },
      isPending: false,
      error: null,
      refetch: async () => undefined,
    },
    root: undefined,
    shown: messages,
    listed: messages,
    messages,
    running: messages.some((m) => m.status === "streaming"),
    replyCounts: new Map(),
    sideThreads: new Map(),
  } as never;
}

const noop = () => {};
const rewind = async () => ({ conflicts: [] });
const queryClient = new QueryClient();

function view(
  messages: ChatMessage[],
  options: {
    lastInput?: ProjectChat["lastInput"];
    onResume?: () => void;
    busy?: boolean;
  } = {},
) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThreadMessages
        handle={{ chat, busy: options.busy ?? false } as never}
        projectPath="/sample/relay"
        thread={thread(messages, options.lastInput)}
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
            rewindTurn: rewind,
            commitTurn: noop,
            canCommitTurn: () => false,
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
        onResume={options.onResume ?? noop}
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
  vi.restoreAllMocks();
  queryClient.clear();
});

const connectionFailure =
  "Claude could not complete this turn: API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";
const lastInput = {
  id: "u",
  body: "Fix it",
  to: "claude",
} as NonNullable<ProjectChat["lastInput"]>;

it.each<{ body: string; extra: Partial<ChatMessage>; label: string }>([
  { body: "", extra: {}, label: "Try again" },
  {
    body: "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
    extra: {},
    label: "Try again",
  },
  { body: "The answer so far.", extra: {}, label: "Resume answer" },
  {
    body: "",
    extra: {
      activity: [
        { id: "read", kind: "read", label: "Read a file", status: "complete" },
      ],
    },
    label: "Resume answer",
  },
])("offers one inline recovery action: $label", ({ body, extra, label }) => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const failed = message("failed", "assistant", body, {
    status: "failed",
    error: connectionFailure,
    ...extra,
  });
  const onResume = vi.fn();
  act(() => root!.render(view([failed], { lastInput, onResume })));
  expect(host.querySelector(".agent-error-message")?.textContent).toBe(
    label === "Resume answer"
      ? "Connection to Claude interrupted."
      : "Couldn’t connect to Claude.",
  );
  expect(
    host.querySelector("details.agent-error-details")?.textContent,
  ).toContain("ENOTFOUND");
  expect(host.querySelector("details")?.open).toBe(false);
  expect(host.querySelector(".resume-answer")).toBeNull();
  const retry = host.querySelector<HTMLButtonElement>(".agent-error-retry")!;
  expect(retry.textContent).toContain(label);
  act(() => retry.click());
  expect(onResume).toHaveBeenCalledOnce();
  if (body && label === "Resume answer")
    expect(host.querySelector(".markdown")?.textContent).toContain(body);
  else expect(host.querySelector(".markdown")).toBeNull();
  act(() => root!.render(view([failed], { lastInput, onResume, busy: true })));
  expect(
    host.querySelector<HTMLButtonElement>(".agent-error-retry")?.disabled,
  ).toBe(true);
  act(() =>
    host.querySelector<HTMLButtonElement>(".agent-error-retry")!.click(),
  );
  expect(onResume).toHaveBeenCalledOnce();
});

it("only offers recovery for the latest stopped answer with input in this conversation", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const failed = message("failed", "assistant", "", {
    status: "failed",
    error: connectionFailure,
  });
  for (const [messages, input] of [
    [[failed], undefined],
    [[failed], { ...lastInput, parentId: "another-conversation" }],
    [[failed, message("done", "assistant", "Recovered.")], lastInput],
    [
      [
        failed,
        message("running", "assistant", "Working", { status: "streaming" }),
      ],
      lastInput,
    ],
  ] as const) {
    act(() => root!.render(view([...messages], { lastInput: input })));
    expect(host.querySelector(".agent-error-retry")).toBeNull();
    expect(host.querySelector(".resume-answer")).toBeNull();
  }
  act(() =>
    root!.render(
      view(
        [
          {
            ...failed,
            error: "Claude could not complete this turn: API Error: overloaded",
          },
        ],
        { lastInput },
      ),
    ),
  );
  expect(host.querySelector(".agent-error-retry")).toBeNull();
  expect(host.querySelector(".resume-answer")?.textContent).toContain(
    "Resume answer",
  );
});

it("keeps one header, timer and fold through a saved question and its follow-up", async () => {
  vi.spyOn(Date, "now").mockReturnValue(106000);
  const asking = message("asking", "assistant", "", {
    created: 1000,
    ended: 48000,
    activity: [
      {
        id: "web",
        kind: "web",
        label: "Find documentation",
        status: "complete",
      },
    ],
    questions: [
      { id: "q", questions: [{ id: "pick", question: "Which?", options: [] }] },
    ],
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(view([asking])));
  expect(host.querySelector(".agent-run-heading")?.textContent).toContain(
    "Waiting for your answer",
  );
  expect(host.querySelector(".agent-run-time")?.textContent).toBe("47s");
  const header = host.querySelector(".project-message.assistant > header");
  const answered = {
    ...asking,
    questions: [
      {
        ...asking.questions![0]!,
        answers: { pick: ["Private"] },
        answerMessageId: "reply",
      },
    ],
  };
  const reply = message("reply", "user", "Answer to your questions", {
    asyncQuestionAnswer: true,
  });
  const working = message("working", "assistant", "", {
    created: 90000,
    status: "streaming",
  });
  act(() => root!.render(view([answered, reply, working])));
  expect(
    host.querySelectorAll(".project-message.assistant > header:not([hidden])"),
  ).toHaveLength(1);
  expect(host.querySelector(".project-message.assistant > header")).toBe(
    header,
  );
  expect(host.querySelectorAll(".agent-run-heading")).toHaveLength(1);
  expect(host.querySelector(".agent-run-heading")?.textContent).toContain(
    "Working for",
  );
  expect(host.querySelector(".agent-run-time")?.textContent).toBe("1m 3s");
  expect(host.querySelectorAll(".thinking-glyph")).toHaveLength(1);
  expect(host.textContent).toContain("Private");
  expect(
    host
      .querySelector('[data-message-id="working"]')
      ?.getAttribute("data-response-continuation"),
  ).toBe("true");
  act(() =>
    root!.render(
      view([
        answered,
        reply,
        {
          ...working,
          body: "Done",
          status: "complete",
          ended: 110000,
        },
      ]),
    ),
  );
  expect(host.querySelectorAll(".agent-run-heading")).toHaveLength(1);
  expect(host.querySelector(".agent-run-time")?.textContent).toBe("1m 7s");
  // The trace folds away rather than vanishing in the frame the turn ends.
  await vi.waitFor(() =>
    expect(host.querySelectorAll(".agent-trace")).toHaveLength(0),
  );
  expect(host.textContent).toContain("Done");
  expect(host.textContent).toContain("Private");
  const fold = host.querySelector<HTMLDetailsElement>(
    "details.agent-activity",
  )!;
  act(() => {
    fold.open = true;
    fold.dispatchEvent(new Event("toggle"));
  });
  expect(host.textContent).toContain("Find documentation");
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

it("does not rederive completed question responses while another answer streams", () => {
  const readTurn = vi.spyOn(trace, "readTurn");
  const asking = message("asking", "assistant", "", {
    questions: [
      {
        id: "q",
        questions: [{ id: "pick", question: "Which?" }],
        answers: { pick: ["Private"] },
        answerMessageId: "reply",
      },
    ],
  });
  const reply = message("reply", "user", "Private", {
    asyncQuestionAnswer: true,
  });
  const completed = message("completed", "assistant", "Done.");
  const typed = message("typed", "user", "Next task");
  const live = message("live", "assistant", "Working", { status: "streaming" });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(view([asking, reply, completed, typed, live])));
  readTurn.mockClear();
  act(() =>
    root!.render(
      view([
        asking,
        reply,
        completed,
        typed,
        { ...live, body: "Working more", version: 2 },
      ]),
    ),
  );
  expect(readTurn.mock.calls.map(([m]) => m.id)).not.toContain("asking");
  expect(readTurn.mock.calls.map(([m]) => m.id)).not.toContain("completed");
  expect(readTurn.mock.calls.map(([m]) => m.id)).toContain("live");
});
