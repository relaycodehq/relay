// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useUsageReadings } from "./provider-usage";
import { api } from "../../lib/api";

const clocks = vi.hoisted(() => new Set<() => void>());

vi.mock("../../lib/while-shown", () => ({
  everyWhileShown: (tick: () => void) => {
    clocks.add(tick);
    return () => clocks.delete(tick);
  },
}));

vi.mock("../../lib/api", () => ({ api: { providerUsage: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let client: QueryClient;
let latest: ReturnType<typeof useUsageReadings>[];

function Probe({
  slot,
  account,
  enabled = true,
}: {
  slot: number;
  account?: string;
  enabled?: boolean;
}) {
  latest[slot] = useUsageReadings([{ provider: "codex", account }], enabled);
  return null;
}

async function render(accounts: (string | undefined)[], enabled = true) {
  if (!root) {
    root = createRoot(document.createElement("div"));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    latest = [];
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {accounts.map((account, slot) => (
          <Probe key={slot} slot={slot} account={account} enabled={enabled} />
        ))}
      </QueryClientProvider>,
    ),
  );
}

afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  root = undefined!;
  vi.clearAllMocks();
  expect(clocks.size).toBe(0);
});

const data = (message: string) => ({
  provider: "codex" as const,
  windows: [],
  message,
});

async function until(message: string) {
  await act(async () => {
    await vi.waitFor(() =>
      expect(latest[0].readings[0].data?.message).toBe(message),
    );
  });
}

it("shares default-account reads, one poll and forced refresh across views", async () => {
  let n = 0;
  vi.mocked(api.providerUsage).mockImplementation(async () =>
    data(String(++n)),
  );
  await render([undefined, "default"]);
  await until("1");
  expect(api.providerUsage).toHaveBeenCalledTimes(1);
  expect(clocks.size).toBe(1);
  await act(async () => {
    await latest[1].refresh("codex", "default");
  });
  await until("2");
  expect(latest[1].readings[0].data?.message).toBe("2");
  expect(api.providerUsage).toHaveBeenLastCalledWith("codex", true, "default");
  await act(async () => {
    for (const tick of clocks) tick();
  });
  await until("3");
  expect(api.providerUsage).toHaveBeenCalledTimes(3);
});

it("does not let a late reading from the previous account replace the selected account", async () => {
  let finish!: (value: ReturnType<typeof data>) => void;
  vi.mocked(api.providerUsage).mockImplementation(async (_p, _f, account) =>
    account === "a"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : data("b"),
  );
  await render(["a"]);
  await render(["b"]);
  await until("b");
  await act(async () => finish(data("a")));
  expect(latest[0].readings[0].data?.message).toBe("b");
  expect(clocks.size).toBe(1);
});

it("does not poll a closed picker and keeps previous data after a refresh failure", async () => {
  vi.mocked(api.providerUsage).mockResolvedValue(data("kept"));
  await render(["a"], false);
  expect(api.providerUsage).not.toHaveBeenCalled();
  expect(clocks.size).toBe(0);
  await render(["a"]);
  await until("kept");
  vi.mocked(api.providerUsage).mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await expect(latest[0].refresh("codex", "a")).rejects.toThrow("offline");
  });
  expect(latest[0].readings[0].data?.message).toBe("kept");
});

it("shows unavailable usage after the first read fails instead of checking forever", async () => {
  vi.mocked(api.providerUsage).mockRejectedValue(new Error("offline"));
  await render(["a"]);
  await until("Couldn’t read usage");
  expect(latest[0].readings[0].data?.windows).toEqual([]);
});

it("force refresh bypasses a pending normal read and ignores its late result", async () => {
  let finish!: (value: ReturnType<typeof data>) => void;
  vi.mocked(api.providerUsage).mockImplementation(async (_p, force) =>
    force
      ? data("fresh")
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  await render(["a"]);
  await act(async () => {
    await latest[0].refresh("codex", "a");
  });
  await until("fresh");
  expect(api.providerUsage).toHaveBeenLastCalledWith("codex", true, "a");
  await act(async () => finish(data("old")));
  expect(latest[0].readings[0].data?.message).toBe("fresh");
});

it("a redeemed reset cannot be overwritten by a poll already in flight", async () => {
  let finish!: (value: ReturnType<typeof data>) => void;
  vi.mocked(api.providerUsage).mockImplementation(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(["a"]);
  await act(async () => {
    await latest[0].put("codex", "a", data("redeemed"));
  });
  await until("redeemed");
  await act(async () => finish(data("before reset")));
  expect(latest[0].readings[0].data?.message).toBe("redeemed");
});
