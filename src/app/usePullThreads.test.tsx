// @vitest-environment happy-dom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { flush, mount } from "../../tests/unit/hook-harness";
import { api } from "../lib/api";
import { usePullThreads } from "./usePullThreads";
import { readDraft, writeDraft } from "../features/composer/drafts";
import { threadDraftKey } from "../lib/thread-storage";
import type { ChatSummary, Project } from "../../shared/projects";
import type { NavigationLock } from "../lib/navigation-lock";

vi.mock("../lib/api", () => ({
  api: {
    createProjectChat: vi.fn(),
    projectChats: vi.fn(async () => []),
  },
}));

afterEach(() => vi.clearAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}

const ref = { owner: "o", name: "r", number: 7 };
const thread = { id: "pr-thread", projectId: "a" } as ChatSummary;
const lock = { locked: false, blocked: () => false } as unknown as NavigationLock;

type Nav = Parameters<typeof usePullThreads>[0];

function setup(reviewOpen = false) {
  const openChat = vi.fn(),
    setChatId = vi.fn(),
    show = vi.fn(),
    navigate = vi.fn();
  const navIn = (projectId: string, pull: typeof ref | null = null): Nav =>
    ({
      project: { id: projectId } as Project,
      chats: { data: [], refetch: vi.fn(async () => ({})) },
      chat: undefined,
      chatId: null,
      draftId: `new:${projectId}`,
      surface: "project",
      pull,
      panes: { show, layout: { open: { changes: reviewOpen } } },
      navigate,
      openChat,
      setChatId,
    }) as unknown as Nav;
  let nav = navIn("a", reviewOpen ? ref : null);
  const client = new QueryClient();
  const result = mount(
    () => usePullThreads(nav, lock, vi.fn()),
    (child) => createElement(QueryClientProvider, { client }, child),
  );
  const moveTo = (projectId: string) => {
    nav = navIn(projectId);
    result.rerender();
  };
  return { result, moveTo, openChat, setChatId, show, navigate };
}

it("doesn't open a PR thread made in a project the user has left", async () => {
  const made = deferred<ChatSummary>();
  vi.mocked(api.createProjectChat).mockReturnValue(made.promise);
  const s = setup();

  const opening = s.result().review(ref);
  s.moveTo("b");
  made.resolve(thread);
  await opening;
  await flush();

  expect(s.openChat).not.toHaveBeenCalled();
  expect(s.show).not.toHaveBeenCalled();
});

it("opens the PR thread when the user stayed put", async () => {
  vi.mocked(api.createProjectChat).mockResolvedValue(thread);
  const s = setup();

  await s.result().review(ref);

  expect(s.openChat).toHaveBeenCalledWith("pr-thread");
  expect(s.show).toHaveBeenCalledWith("changes");
});

it("doesn't switch to a review's thread once the user has left its project", async () => {
  const made = deferred<ChatSummary>();
  vi.mocked(api.createProjectChat).mockReturnValue(made.promise);
  writeDraft(threadDraftKey("new:a"), "Half a message");
  const s = setup(true);
  await flush();
  expect(api.createProjectChat).toHaveBeenCalledWith("a", { kind: "pr", ref });

  s.moveTo("b");
  made.resolve(thread);
  await flush();

  expect(s.setChatId).not.toHaveBeenCalled();
  // The draft stays on the new thread it was written in.
  expect(readDraft(threadDraftKey("new:a"))).toBe("Half a message");
  expect(readDraft(threadDraftKey("pr-thread"))).toBe("");
});

it("doesn't open a PR from the Pull requests page once the user went elsewhere", async () => {
  const made = deferred<ChatSummary>();
  vi.mocked(api.createProjectChat).mockReturnValue(made.promise);
  const s = setup();
  const project = {
    id: "a",
    repository: { owner: "o", name: "r" },
  } as Project;

  const opening = s.result().openInProject(project, ref);
  await flush();
  s.moveTo("b");
  made.resolve(thread);
  await opening;

  expect(s.navigate).not.toHaveBeenCalled();
  expect(s.show).not.toHaveBeenCalled();
});
