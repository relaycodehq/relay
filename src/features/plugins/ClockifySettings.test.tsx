// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClockifySettings as Settings } from "../../../shared/clockify";

const mocks = vi.hoisted(() => ({
  saved: { workspaceId: "a" },
  landSave: () => {},
  shown: undefined as string[] | undefined,
}));

vi.mock("../../lib/api", () => {
  const status = () => ({
    settings: {
      host: "global",
      workspaceId: mocks.saved.workspaceId,
      idleMinutes: 15,
      projects: {},
    },
    hasToken: true,
    persistent: true,
    day: null,
    review: null,
  });
  const api: Record<string, unknown> = {
    clockifyStatus: async () => status(),
    clockifyWorkspaces: async () => [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    // Answers for whatever workspace the main process has saved so far.
    clockifyProjects: async () => [
      { id: "p", name: `Project in ${mocks.saved.workspaceId}` },
    ],
    saveClockifySettings: (next: Settings) =>
      new Promise((resolve) => {
        mocks.landSave = () => {
          mocks.saved.workspaceId = next.workspaceId;
          resolve(status());
        };
      }),
  };
  return {
    api: new Proxy(api, {
      get: (target, key: string) => target[key] ?? (async () => []),
    }),
  };
});

vi.mock("../agents/useAISettings", () => ({
  useSaveAISettings: () => ({ values: undefined, save: async () => false }),
}));

vi.mock("../agents/registry-agents", () => ({ useOfferedAgents: () => [] }));

vi.mock("../../ui/SearchSelect", () => ({
  SearchSelect: (props: {
    label: string;
    value?: string;
    options: { value: string }[];
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("./ClockifyProjectMap", () => ({
  ClockifyProjectMap: (props: { clockifyProjects?: { name: string }[] }) => {
    mocks.shown = props.clockifyProjects?.map((p) => p.name);
    return null;
  },
}));

const { ClockifySettings } = await import("./ClockifySettings");

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.saved.workspaceId = "a";
  mocks.shown = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  client.clear();
});

it("lists the new workspace's projects once its save lands", async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ClockifySettings />
      </QueryClientProvider>,
    ),
  );
  await settle();
  expect(mocks.shown).toEqual(["Project in a"]);

  const picker = host.querySelector<HTMLSelectElement>(
    'select[aria-label="Clockify workspace"]',
  )!;
  // Settings shows the new workspace before the main process has saved it.
  act(() => {
    picker.value = "b";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  await act(async () => mocks.landSave());
  await settle();

  expect(mocks.shown).toEqual(["Project in b"]);
});
