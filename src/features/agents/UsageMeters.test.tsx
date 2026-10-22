// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { UsageMeters } from "./UsageMeters";
import { UsageStrip } from "./UsageStrip";
import { useUsageReadings, usageKey } from "./provider-usage";
import { api } from "../../lib/api";
import type { ProviderUsage } from "../../../shared/provider-usage";

vi.mock("../../lib/api", () => ({
  api: { providerUsage: vi.fn(), redeemCodexReset: vi.fn() },
}));
vi.mock("../../lib/while-shown", () => ({ everyWhileShown: () => () => {} }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const reading = (count = 2): ProviderUsage => ({
  provider: "codex",
  message: null,
  windows: [],
  resets: count
    ? { count, usable: 1, credits: [{ id: "first", expiresAt: null }] }
    : null,
});
function Probe({ account, strip }: { account: string; strip: boolean }) {
  const { readings } = useUsageReadings([{ provider: "codex", account }]);
  const View = strip ? UsageStrip : UsageMeters;
  return (
    <View
      usage={readings[0].data}
      now={0}
      accountId={account}
      accountName={`Codex · ${account}`}
    />
  );
}
async function render(account = "work", strip = false, initial = reading()) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(api.providerUsage).mockResolvedValue(initial);
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe account={account} strip={strip} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await vi.waitFor(() =>
      strip
        ? expect(savedResets(2)).not.toBeNull()
        : expect(host.textContent).toContain("2 resets available"),
    );
  });
}
const savedResets = (count: number) =>
  host.querySelector(
    `button[aria-label="Reset usage, ${count} saved ${count === 1 ? "reset" : "resets"}"]`,
  );
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  client?.clear();
  root = undefined!;
  vi.clearAllMocks();
});
it("confirms the selected account, cancels without spending, and refreshes only its reading", async () => {
  await render();
  client.setQueryData(usageKey("codex", "personal"), reading(3));
  await click("Reset usage…");
  expect(document.body.textContent).toContain("Codex · work");
  await click("Cancel");
  expect(api.redeemCodexReset).not.toHaveBeenCalled();
  vi.mocked(api.redeemCodexReset).mockResolvedValue({
    outcome: "reset",
    usage: reading(1),
  });
  await click("Reset usage…");
  await click("Use 1 reset");
  expect(api.redeemCodexReset).toHaveBeenCalledWith(
    "work",
    "first",
    expect.any(String),
  );
  expect(host.textContent).toContain("1 reset available");
  expect(client.getQueryData(usageKey("codex", "personal"))).toEqual(
    reading(3),
  );
});
it("retries a failed request with the same credit and key, even after the list changes", async () => {
  await render();
  vi.mocked(api.redeemCodexReset).mockRejectedValueOnce(new Error("Offline"));
  await click("Reset usage…");
  await click("Use 1 reset");
  expect(document.body.textContent).toContain("Offline");
  const sent = vi.mocked(api.redeemCodexReset).mock.calls[0];
  await act(async () => {
    client.setQueryData(usageKey("codex", "work"), {
      ...reading(),
      resets: {
        count: 2,
        usable: 1,
        credits: [{ id: "next", expiresAt: null }],
      },
    });
  });
  vi.mocked(api.redeemCodexReset).mockResolvedValue({
    outcome: "reset",
    usage: reading(0),
  });
  await click("Use 1 reset");
  expect(vi.mocked(api.redeemCodexReset).mock.calls[1]).toEqual(sent);
  expect(host.textContent).not.toContain("resets available");
  expect(host.querySelector(".usage-saved-resets")).toBeNull();
});

it("opens full usage details from the strip without a second reset action", async () => {
  await render("work", true, {
    ...reading(),
    windows: [
      {
        kind: "weekly",
        usedPercent: 80,
        resetsAt: Date.now() + 86400000,
        periodMs: 604800000,
      },
    ],
    credits: { balance: 65492.713, unlimited: false },
  });
  expect(host.textContent).not.toContain("credits");
  expect(savedResets(2)).not.toBeNull();
  expect(host.textContent).toContain("Week 20%");
  const trigger = document.querySelector<HTMLButtonElement>(
    ".usage-strip-status",
  )!;
  await act(async () => trigger.click());
  expect(document.body.textContent).toContain("65,492.713 credits");
  expect(document.body.querySelectorAll(".usage-reset")).toHaveLength(1);
});
it("refreshes the strip and shared reading after a confirmed reset", async () => {
  await render("work", true);
  await click("Reset usage, 2 saved resets");
  expect(api.redeemCodexReset).not.toHaveBeenCalled();
  vi.mocked(api.redeemCodexReset).mockResolvedValue({
    outcome: "reset",
    usage: reading(1),
  });
  await click("Use 1 reset");
  expect(savedResets(1)).not.toBeNull();
  expect(client.getQueryData(usageKey("codex", "work"))).toEqual(reading(1));
});
it("swaps the strip's readings for the credit balance once a limit is spent", async () => {
  await render("work", true, {
    ...reading(),
    windows: [
      {
        kind: "session",
        usedPercent: 100,
        resetsAt: Date.now() + 3600000,
        periodMs: 18000000,
      },
    ],
    credits: { balance: 1200, unlimited: false },
  });
  const status = document.querySelector(".usage-strip-status")!;
  expect(status.textContent).toContain("On credits 1.2K");
  expect(status.querySelector(".usage-strip-ring")).toBeNull();
});
