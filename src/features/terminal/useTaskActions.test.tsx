// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/projects";
import type { ProjectTask } from "../../../shared/tasks";
import { mount } from "../../../tests/unit/hook-harness";
import { TASK_SETTLE_MS, useTaskActions } from "./useTaskActions";

vi.mock("../../lib/api", () => ({
  api: {
    stopProjectTask: vi.fn(async () => {}),
    restartProjectTask: vi.fn(async () => {}),
  },
}));

const project = { id: "p" } as Project;
const task = { id: "vite" } as ProjectTask;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function mountActions() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const hook = mount(
    () => useTaskActions(project),
    (child) => createElement(QueryClientProvider, { client }, child),
  );
  return { hook, invalidate };
}

it("frees a task that survived its stop once the stop has had time to finish", async () => {
  const { hook } = mountActions();
  await act(async () => void hook().act(task, "stop"));
  expect(hook().busy.get("vite")).toBe("stop");

  act(() => void vi.advanceTimersByTime(TASK_SETTLE_MS - 1));
  expect(hook().busy.get("vite")).toBe("stop");

  act(() => void vi.advanceTimersByTime(1));
  expect(hook().busy.has("vite")).toBe(false);
});

it("frees a restarted task the same way", async () => {
  const { hook } = mountActions();
  await act(async () => void hook().act(task, "restart"));
  act(() => void vi.advanceTimersByTime(TASK_SETTLE_MS));
  expect(hook().busy.has("vite")).toBe(false);
});

it("leaves no timer behind when the list goes away", async () => {
  const { hook, invalidate } = mountActions();
  await act(async () => void hook().act(task, "stop"));
  hook.unmount();

  vi.advanceTimersByTime(TASK_SETTLE_MS);
  expect(invalidate).not.toHaveBeenCalled();
});
