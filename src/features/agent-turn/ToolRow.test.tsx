// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentActivity } from "../../../shared/projects";
import { Subagents, ToolRow } from "./ToolRow";

vi.mock("../../lib/api", () => ({ api: {} }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** What an opened row shows under its heading, top to bottom. */
function opened(row: AgentActivity, under: AgentActivity[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const calls = new Map([[row.id, under]]);
  try {
    act(() =>
      root.render(
        <Subagents.Provider value={{ calls, display: (text) => text }}>
          <ToolRow activity={row} label={row.label} onChanges={() => {}} />
        </Subagents.Provider>,
      ),
    );
    const details = host.querySelector<HTMLDetailsElement>("details")!;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    return [...details.children].slice(1).map((part) => part.textContent);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
}

it("opens a message to an agent on what it said, an agent on what it did", () => {
  const call: AgentActivity = {
    id: "shot",
    kind: "tool",
    label: "take_screenshot",
    status: "complete",
  };
  const message: AgentActivity = {
    id: "send",
    kind: "tool",
    label: "Message to agent: Render the full view",
    status: "complete",
    detail: "Resumed\n\nFix the header.",
  };
  expect(opened(message, [call])).toEqual([
    "Resumed\n\nFix the header.",
    "take_screenshot",
  ]);
  const agent: AgentActivity = {
    id: "agent",
    kind: "agent",
    label: "Render the full view",
    status: "complete",
    detail: "The view renders.",
  };
  expect(opened(agent, [call])).toEqual([
    "take_screenshot",
    "The view renders.",
  ]);
});
