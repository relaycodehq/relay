import { expect, it, vi } from "vitest";
import { DailyPing } from "./daily-ping";

function setup(o: { enabled?: boolean; ok?: boolean } = {}) {
  let state: { pingedOn?: string } = {};
  const sent: string[] = [];
  const now = { value: new Date("2026-10-22T10:00:00Z") };
  const ping = new DailyPing({
    kind: "desktop",
    version: "0.20.0",
    live: true,
    enabled: () => o.enabled ?? true,
    store: {
      get: () => state as never,
      update: vi.fn(async (fn) => {
        const next = structuredClone(state);
        fn(next as never);
        state = next;
      }),
    },
    send: async (body) => {
      sent.push(body);
      return o.ok ?? true;
    },
    now: () => now.value,
  });
  return { ping, sent, now, state: () => state };
}

it("pings once per UTC day and carries no identifier", async () => {
  const { ping, sent, now } = setup();
  await ping.tick();
  await ping.tick();
  expect(sent).toHaveLength(1);
  expect(Object.keys(JSON.parse(sent[0])).sort()).toEqual([
    "kind",
    "platform",
    "version",
  ]);
  now.value = new Date("2026-10-23T00:01:00Z");
  await ping.tick();
  expect(sent).toHaveLength(2);
});

it("tries again after a failed ping and stays quiet when turned off", async () => {
  const failing = setup({ ok: false });
  await failing.ping.tick();
  await failing.ping.tick();
  expect(failing.sent).toHaveLength(2);
  expect(failing.state().pingedOn).toBeUndefined();

  const off = setup({ enabled: false });
  await off.ping.tick();
  expect(off.sent).toHaveLength(0);
});
