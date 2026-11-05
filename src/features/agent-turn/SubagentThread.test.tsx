// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SubagentDetail, SubagentRun } from "../../../shared/subagents";
import { flush } from "../../../tests/unit/hook-harness";
import { SubagentThread } from "./SubagentThread";

const api = vi.hoisted(() => ({
  projectChatAgent: vi.fn(),
  stopProjectChatAgent: vi.fn(),
}));

vi.mock("../../lib/api", () => ({ api }));

const run = (id: string): SubagentRun => ({
  id,
  description: `Agent ${id}`,
  status: "running",
  started: 1,
  calls: 0,
  recent: [],
});

it("shows a failed stop only on the run it was for, not the next tab", async () => {
  const runs = [run("a"), run("b")];
  api.projectChatAgent.mockImplementation(
    async (_chat: string, id: string): Promise<SubagentDetail> => ({
      ...run(id),
      trace: [],
    }),
  );
  api.stopProjectChatAgent.mockRejectedValue(new Error("Stop refused"));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const view = (openId: string): ReactElement => (
    <QueryClientProvider client={qc}>
      <SubagentThread
        chatId="chat"
        runs={runs}
        openId={openId}
        projectRoot="/p"
        onSelect={() => {}}
        onClose={() => {}}
        onOpenFile={() => {}}
        onChanges={() => {}}
      />
    </QueryClientProvider>
  );
  const stopButton = () =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Stop agent",
    );
  try {
    act(() => root.render(view("a")));
    await flush();
    act(() => stopButton()!.click());
    await flush();
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      "Stop refused",
    );

    act(() => root.render(view("b")));
    await flush();
    expect(host.querySelector("[role=alert]")).toBeNull();

    act(() => root.render(view("a")));
    await flush();
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      "Stop refused",
    );
  } finally {
    act(() => root.unmount());
    host.remove();
    qc.clear();
  }
});
