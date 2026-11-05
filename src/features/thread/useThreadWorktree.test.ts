// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mount, update } from "../../../tests/unit/hook-harness";
import type { Project } from "../../../shared/projects";

vi.mock("../../lib/api", () => ({ api: {} }));

const { useThreadHandle } = await import("./useThreadHandle");
const { useThreadWorktree } = await import("./useThreadWorktree");
const { loadDraftWorkspace, setDraftBody } = await import("../composer/drafts");

const project = { id: "p1", path: "/p1" } as Project;
const draftId = "new:p1";

beforeEach(() => localStorage.clear());

function mountWorktree() {
  const client = new QueryClient();
  return mount(
    () =>
      useThreadWorktree({
        handle: useThreadHandle(undefined, draftId, project.id, async () => {}),
        project,
        running: false,
      }),
    (child) => createElement(QueryClientProvider, { client }, child),
  );
}

it("follows a workspace a phone picked for the open unsent thread", () => {
  const worktree = mountWorktree();
  expect(worktree().workspace).toBe("checkout");
  // The phone's pick arrives through draft sync while the thread is open here.
  update(() =>
    setDraftBody(
      "chat-draft:new:p1",
      { text: "hi", skills: {}, quotes: [], files: [] },
      "worktree",
    ),
  );
  expect(worktree().workspace).toBe("worktree");
  expect(loadDraftWorkspace(draftId, project)).toBe("worktree");
});

it("keeps the workspace picked here", () => {
  const worktree = mountWorktree();
  update(() => worktree().setWorkspace("worktree"));
  expect(worktree().workspace).toBe("worktree");
  expect(loadDraftWorkspace(draftId, project)).toBe("worktree");
  update(() => worktree().setWorkspace("checkout"));
  expect(worktree().workspace).toBe("checkout");
  expect(loadDraftWorkspace(draftId, project)).toBe("checkout");
});
