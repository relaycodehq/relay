import { expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../app/store";
import { RemoteDevices } from "./devices";

async function setup(now = () => Date.now()) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-remote-")));
  const store = new Store(join(dir, "state"));
  await store.load();
  const seal = async (v: string) => "sealed:" + v,
    unseal = async (v: string) => v.slice(7);
  return {
    dir,
    store,
    devices: new RemoteDevices(store, seal, unseal, now),
    reopen: () => new RemoteDevices(store, seal, unseal, now),
    saved: () => readFile(join(dir, "state", "state.json"), "utf8"),
  };
}

it("trades a pairing code once for a token it only keeps hashed", async () => {
  const { dir, devices, saved } = await setup();
  try {
    const { code } = devices.newPairing();
    const { device, token } = await devices.pair(code, "Pixel\n7");
    expect(device.name).toBe("Pixel7");
    await expect(devices.pair(code, "Second phone")).rejects.toThrow(/expired/);
    expect(await saved()).not.toContain(token);
    expect((await devices.verify(device.id, token))?.id).toBe(device.id);
    expect(await devices.verify(device.id, token + "x")).toBeUndefined();

    await devices.revoke(device.id);
    expect(await devices.verify(device.id, token)).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("turns a sign-in away when the phone is removed while it signs in", async () => {
  const { dir, devices } = await setup();
  try {
    const { device, token } = await devices.pair(
      devices.newPairing().code,
      "Pixel",
    );
    // The removal is still being saved when the phone's sign-in arrives.
    const removing = devices.revoke(device.id);
    const signingIn = devices.verify(device.id, token);
    await removing;
    expect(await signingIn).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("voids a code after it expires or after five wrong guesses", async () => {
  let now = 1_000_000;
  const { dir, devices } = await setup(() => now);
  try {
    const first = devices.newPairing();
    now += 11 * 60_000;
    await expect(devices.pair(first.code, "Late")).rejects.toThrow(/expired/);

    const { code } = devices.newPairing();
    for (let i = 0; i < 5; i++)
      await expect(devices.pair("wrong-code-" + i, "Guess")).rejects.toThrow(
        /Wrong/,
      );
    await expect(devices.pair(code, "Right, too late")).rejects.toThrow(
      /expired/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps the same sealed key across restarts, so paired phones still trust it", async () => {
  const { dir, devices, reopen, saved } = await setup();
  try {
    const key = await devices.key();
    expect(await saved()).toContain('"key":"sealed:');
    const again = await reopen().key();
    expect([...again.public]).toEqual([...key.public]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
