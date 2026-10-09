import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Store } from "../app/store";
import type { RemoteDevice, RemoteSettings } from "../app/store-types";
import {
  fromBase64Url,
  generateKeyPair,
  publicKeyOf,
  randomToken,
  toBase64Url,
  type KeyPair,
} from "../../shared/remote-crypto";
import type { PhoneAppReport } from "../../shared/phone-app";
import type { DeviceKind } from "../../shared/remote";

export type { RemoteSettings };

const pairingMs = 10 * 60_000;
const maxDevices = 10;
const maxFailures = 5;

const hash = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

/** A valid token could not finish sign-in because saving lastSeen failed. */
export class SignInUnavailable extends Error {
  constructor(cause: unknown) {
    super("Couldn't check the phone's sign-in.", { cause });
  }
}

/**
 * Paired phones and computers, the bridge's key, and the one pairing code
 * that may be open at a time. Whoever holds the code says which it is; a
 * computer gets the handoff calls instead of the phone's.
 */
export class RemoteDevices {
  private pairing?: { code: string; expiresAt: number; failures: number };
  private keyPair?: KeyPair;
  constructor(
    private store: Store,
    private seal: (value: string) => Promise<string | null>,
    private unseal: (value: string) => Promise<string>,
    private now = () => Date.now(),
  ) {}
  get settings(): RemoteSettings {
    return this.store.get().phoneRemote ?? {};
  }
  list() {
    return this.settings.devices ?? [];
  }
  async setAppearance(appearance: RemoteSettings["appearance"]) {
    await this.store.update((s) => {
      s.phoneRemote = { ...s.phoneRemote, appearance };
    });
  }
  async setEnabled(enabled: boolean) {
    await this.store.update((s) => {
      s.phoneRemote = { ...s.phoneRemote, enabled };
    });
    if (!enabled) this.pairing = undefined;
  }
  /** Made once and kept: phones pin its public half. */
  async key(): Promise<KeyPair> {
    if (this.keyPair) return this.keyPair;
    const saved = this.settings.key;
    if (saved) {
      const secret = fromBase64Url(
        saved.startsWith("plain:") ? saved.slice(6) : await this.unseal(saved),
      );
      return (this.keyPair = { secret, public: publicKeyOf(secret) });
    }
    const pair = generateKeyPair();
    const encoded = toBase64Url(pair.secret);
    const sealed = (await this.seal(encoded)) ?? "plain:" + encoded;
    await this.store.update((s) => {
      s.phoneRemote = { ...s.phoneRemote, key: sealed };
    });
    return (this.keyPair = pair);
  }
  /** A fresh single-use code; it replaces any code shown before. */
  newPairing() {
    this.pairing = {
      code: randomToken(24),
      expiresAt: this.now() + pairingMs,
      failures: 0,
    };
    return { code: this.pairing.code, expiresAt: this.pairing.expiresAt };
  }
  async pair(code: string, name: string, kind?: DeviceKind) {
    const open = this.pairing;
    if (!open || open.expiresAt < this.now())
      throw new Error("This pairing code expired. Show a new one in Relay.");
    if (!sameSecret(code, open.code)) {
      if (++open.failures >= maxFailures) this.pairing = undefined;
      throw new Error("Wrong pairing code.");
    }
    this.pairing = undefined;
    if (this.list().length >= maxDevices)
      throw new Error("Remove a paired phone or computer in Relay first.");
    const token = randomToken(32);
    const device: RemoteDevice = {
      id: randomUUID(),
      name:
        name
          .replace(/[\x00-\x1f]/g, "")
          .trim()
          .slice(0, 60) || (kind === "computer" ? "Computer" : "Phone"),
      ...(kind ? { kind } : {}),
      created: this.now(),
      lastSeen: this.now(),
      tokenHash: hash(token),
    };
    await this.store.update((s) => {
      s.phoneRemote = {
        ...s.phoneRemote,
        devices: [...(s.phoneRemote?.devices ?? []), device],
      };
    });
    return { device, token };
  }
  /** The device the token belongs to, or undefined. */
  async verify(deviceId: string, token: string) {
    if (!this.holding(deviceId, token)) return;
    try {
      await this.store.update((s) => {
        const saved = s.phoneRemote?.devices?.find((d) => d.id === deviceId);
        if (saved) saved.lastSeen = this.now();
      });
    } catch (cause) {
      // A removal that landed while saving still wins, even on failure.
      if (!this.holding(deviceId, token)) return;
      throw new SignInUnavailable(cause);
    }
    // A removal saved while this update waited its turn wins.
    return this.holding(deviceId, token);
  }
  /** Whether the device is still paired; a removed one's sessions end. */
  paired(deviceId: string) {
    return this.list().some((d) => d.id === deviceId);
  }
  private holding(deviceId: string, token: string) {
    const device = this.list().find((d) => d.id === deviceId);
    return device && sameSecret(hash(token), device.tokenHash)
      ? device
      : undefined;
  }
  async setApp(deviceId: string, app: PhoneAppReport) {
    const saved = this.list().find((d) => d.id === deviceId);
    if (!saved || JSON.stringify(saved.app) === JSON.stringify(app)) return;
    await this.store.update((s) => {
      const device = s.phoneRemote?.devices?.find((d) => d.id === deviceId);
      if (device) device.app = app;
    });
  }
  async revoke(deviceId: string) {
    await this.store.update((s) => {
      if (s.phoneRemote?.devices)
        s.phoneRemote.devices = s.phoneRemote.devices.filter(
          (d) => d.id !== deviceId,
        );
    });
  }
}

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
