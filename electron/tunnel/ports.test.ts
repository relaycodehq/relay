import { expect, it } from "vitest";
import type { RemoteSite } from "../../shared/remote-tunnel";
import { TunnelPorts } from "./ports";

const site = (port: number) => ({ port, title: "dev", command: "npm run dev", projectId: "p", project: "Relay" }) as RemoteSite;

function setup(ports: number[]) {
  let now = 0;
  let looks = 0;
  const listed = { ports };
  const tunnel = new TunnelPorts(
    async () => (looks++, listed.ports.map(site)),
    () => now,
  );
  return { tunnel, listed, looks: () => looks, wait: (ms: number) => (now += ms) };
}

it("lets a phone reach what Sites lists and what it typed, nothing else", async () => {
  const { tunnel } = setup([5177]);
  expect(await tunnel.allowed("phone-a", 5177)).toBe(true);
  expect(await tunnel.allowed("phone-a", 5432)).toBe(false);
  tunnel.type("phone-a", 5432);
  expect(await tunnel.allowed("phone-a", 5432)).toBe(true);
  // Typed on one phone only.
  expect(await tunnel.allowed("phone-b", 5432)).toBe(false);
});

it("counts a server started since the last look, without a look per connection", async () => {
  const { tunnel, listed, looks, wait } = setup([5177]);
  expect(await tunnel.allowed("p", 3000)).toBe(false);
  listed.ports = [5177, 3000];
  // Right after a look, a missing port waits for the next one.
  expect(await tunnel.allowed("p", 3000)).toBe(false);
  expect(await tunnel.allowed("p", 5177)).toBe(true);
  expect(looks()).toBe(1);
  wait(2_500);
  expect(await tunnel.allowed("p", 3000)).toBe(true);
  expect(looks()).toBe(2);
});

it("forgets a site once it stops listening", async () => {
  const { tunnel, listed, wait } = setup([5177]);
  expect(await tunnel.allowed("p", 5177)).toBe(true);
  listed.ports = [];
  wait(16_000);
  expect(await tunnel.allowed("p", 5177)).toBe(false);
});

it("lets a phone open what Sites just listed without looking again", async () => {
  const { tunnel, looks, wait } = setup([5177]);
  expect((await tunnel.sites()).map((s) => s.port)).toEqual([5177]);
  wait(10_000);
  expect(await tunnel.allowed("p", 5177)).toBe(true);
  expect(looks()).toBe(1);
  wait(6_000);
  expect(await tunnel.allowed("p", 5177)).toBe(true);
  expect(looks()).toBe(2);
});
