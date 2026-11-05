// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultDevOpsSettings,
  type DevOpsSettings as Settings,
} from "../../../shared/devops";

const mocks = vi.hoisted(() => ({
  saved: { organization: "contoso" },
  landSave: () => {},
}));

vi.mock("../../lib/api", () => {
  const status = () => ({
    settings: {
      ...defaultDevOpsSettings,
      enabled: true,
      auth: "azure-cli",
      organization: mocks.saved.organization,
    },
    hasPat: false,
    hasOpenRouterKey: false,
    persistent: true,
  });
  const api: Record<string, unknown> = {
    devopsStatus: async () => status(),
    devopsConnection: async () => ({ signIn: "signed-in" }),
    // Answers for whatever organization the main process has saved so far.
    devopsFields: async () => [
      { name: `Team of ${mocks.saved.organization}`, referenceName: "T" },
    ],
    saveDevOpsSettings: (next: Settings) =>
      new Promise((resolve) => {
        mocks.landSave = () => {
          mocks.saved.organization = next.organization;
          resolve(status());
        };
      }),
    plugins: async () => ({ devops: true }),
  };
  return {
    api: new Proxy(api, {
      get: (target, key: string) => target[key] ?? (async () => []),
    }),
  };
});

const { DevOpsSettings } = await import("./DevOpsSettings");

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const suggested = () =>
  [...host.querySelectorAll("#devops-fields option")]
    .map((o) => o.getAttribute("value"))
    .filter((v) => v !== "Current sprint");

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.saved.organization = "contoso";
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

it("lists the new organization's fields once its save lands", async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DevOpsSettings />
      </QueryClientProvider>,
    ),
  );
  await settle();
  expect(suggested()).toEqual(["Team of contoso"]);

  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Azure DevOps organization"]',
  )!;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setValue.call(input, "fabrikam");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Settings shows the new organization before the main process has saved it.
  act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  await settle();
  await act(async () => mocks.landSave());
  await settle();

  expect(suggested()).toEqual(["Team of fabrikam"]);
});
