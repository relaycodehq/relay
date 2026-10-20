import { expect, it, vi } from "vitest";

const opened: { closed: boolean }[] = [];
let release: () => void = () => {};

vi.mock("../agents", () => ({
  foundSessions: async () => [],
  savedMeta: () => undefined,
  // The agent host opening a keep-alive takes until `release()`.
  inAgentHost: async () => {
    await new Promise<void>((r) => (release = r));
    const hosted = {
      closed: false,
      read() {},
      close() {
        hosted.closed = true;
      },
    };
    opened.push(hosted);
    return hosted;
  },
}));

const { WslHolders } = await import("./wsl-holder");

it("starts one keep-alive for holds that overlap, and none for one released meanwhile", async () => {
  const holders = new WslHolders();
  const both = Promise.all([holders.hold("Ubuntu"), holders.hold("Ubuntu")]);
  await new Promise((r) => setTimeout(r));
  release();
  await both;
  expect(opened).toHaveLength(1);
  expect([...(await holders.heldDistros())]).toEqual(["Ubuntu"]);

  const late = holders.hold("Debian");
  await new Promise((r) => setTimeout(r));
  holders.release("Debian");
  release();
  await late;
  expect(opened).toHaveLength(2);
  expect(opened[1]!.closed).toBe(true);
  expect([...(await holders.heldDistros())]).toEqual(["Ubuntu"]);
});
