import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Store } from "../store";
import {
  fromBase64Url,
  generateKeyPair,
  publicKeyOf,
  randomToken,
  toBase64Url,
  type KeyPair,
} from "../../shared/remote-crypto";
import type { PhoneAppReport } from "../../shared/phone-app";

interface RemoteDevice {
  id: string;
  name: string;
  created: number;
  lastSeen?: number;
  /** SHA-256 of the device's token; the token itself only lives on the phone. */
  tokenHash: string;
  app?: PhoneAppReport;
}
export interface RemoteSettings {
  enabled?: boolean;
  /** The bridge's X25519 secret: sealed by the OS credential store, or `plain:` where there is none. */
  key?: string;
  devices?: RemoteDevice[];
  /** The desktop's last theme, for phones that connect before its window draws. */
  appearance?: import("../../shared/remote").PhoneAppearance;
}

const pairingMs = 10 * 60_000;
const maxDevices = 10;
const maxFailures = 5;

const hash = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

/** Paired phones, the bridge's key, and the one pairing code that may be open at a time. */
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
  async pair(code: string, name: string) {
    const open = this.pairing;
    if (!open || open.expiresAt < this.now())
      throw new Error("This pairing code expired. Show a new one in Relay.");
    if (!sameSecret(code, open.code)) {
      if (++open.failures >= maxFailures) this.pairing = undefined;
      throw new Error("Wrong pairing code.");
    }
    this.pairing = undefined;
    if (this.list().length >= maxDevices)
      throw new Error("Remove a paired phone in Relay first.");
    const token = randomToken(32);
    const device: RemoteDevice = {
      id: randomUUID(),
      name:
        name
          .replace(/[\x00-\x1f]/g, "")
          .trim()
          .slice(0, 60) || "Phone",
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
    const device = this.list().find((d) => d.id === deviceId);
    if (!device || !sameSecret(hash(token), device.tokenHash)) return;
    await this.store.update((s) => {
      const saved = s.phoneRemote?.devices?.find((d) => d.id === deviceId);
      if (saved) saved.lastSeen = this.now();
    });
    return device;
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
