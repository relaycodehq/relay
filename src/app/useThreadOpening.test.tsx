// @vitest-environment happy-dom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { flush, mount } from "../../tests/unit/hook-harness";
import { api } from "../lib/api";
import { useThreadOpening } from "./useThreadOpening";
import type { ChatSummary, Project } from "../../shared/projects";
import type { ThreadWindow } from "../../shared/thread-windows";

let moved: (t: ThreadWindow) => void = () => {};

vi.mock("../lib/api", () => ({
  api: {
    takeOpenThread: vi.fn(async () => null),
    onOpenThread: vi.fn(() => () => {}),
    onThreadMoved: vi.fn((listener: (t: ThreadWindow) => void) => {
      moved = listener;
      return () => {};
    }),
    projectChats: vi.fn(),
  },
}));

afterEach(() => vi.clearAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}

type Nav = Parameters<typeof useThreadOpening>[0];
type Projects = Parameters<typeof useThreadOpening>[1];

const home = { id: "home" } as Project;
const added = { id: "added" } as Project;
const thread = { id: "t1", projectId: "added" } as ChatSummary;

function setup(refetched: Promise<{ data: Project[] }>) {
  const navigate = vi.fn();
  let nav = { chatId: "t1", navigate } as unknown as Nav;
  const projects = {
    data: [home],
    refetch: vi.fn(() => refetched),
  } as unknown as Projects;
  const client = new QueryClient();
  const result = mount(
    () => useThreadOpening(nav, projects, vi.fn()),
    (child) => createElement(QueryClientProvider, { client }, child),
  );
  const openThread = (chatId: string) => {
    nav = { chatId, navigate } as unknown as Nav;
    result.rerender();
  };
  return { navigate, openThread };
}

it("doesn't follow a moved thread the user has left meanwhile", async () => {
  const listed = deferred<{ data: Project[] }>();
  vi.mocked(api.projectChats).mockResolvedValue([thread]);
  const s = setup(listed.promise);

  moved({ projectId: "added", chatId: "t1" });
  s.openThread("t2");
  listed.resolve({ data: [home, added] });
  await flush();

  expect(s.navigate).not.toHaveBeenCalled();
});

it("follows a moved thread that still shows", async () => {
  vi.mocked(api.projectChats).mockResolvedValue([thread]);
  const s = setup(Promise.resolve({ data: [home, added] }));

  moved({ projectId: "added", chatId: "t1" });
  await flush();

  expect(s.navigate).toHaveBeenCalledWith(added, thread);
});
