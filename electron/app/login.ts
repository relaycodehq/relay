import { net, safeStorage } from "electron";
import { Gitea } from "../pull-requests/gitea";
import type { Store } from "./store";
import type { SourceControlSettings } from "../../shared/source-control";

/** Linux's basic_text backend stores plaintext; secrets then stay in memory. */
const canEncrypt = async () =>
  process.platform === "linux"
    ? safeStorage.isEncryptionAvailable() &&
      safeStorage.getSelectedStorageBackend() !== "basic_text"
    : await safeStorage.isAsyncEncryptionAvailable();
/** Encrypts with the OS credential store; null when it can't persist safely. */
export const seal = async (value: string) =>
  (await canEncrypt())
    ? (await safeStorage.encryptStringAsync(value)).toString("base64")
    : null;
export const unseal = async (value: string) =>
  (await safeStorage.decryptStringAsync(Buffer.from(value, "base64"))).result;

/**
 * Whether Gitea is on in Settings → Integrations. Off, Relay doesn't sign in
 * to it at all. Until switched, a saved account means it's in use.
 */
export const giteaOn = (s: {
  sourceControl?: SourceControlSettings;
  account?: unknown;
}) =>
  !s.sourceControl?.off?.includes("gitea") &&
  (!!s.sourceControl?.on?.includes("gitea") || !!s.account);

/** The signed-in Gitea account, and bringing a saved one back from the Keychain. */
export class GiteaLogin {
  private current: Gitea | null = null;
  /** Hears sign-ins and sign-outs, a restored account's too. */
  changed?: () => void;
  get client() {
    return this.current;
  }
  set client(next: Gitea | null) {
    this.current = next;
    this.changed?.();
  }
  restore: "idle" | "unlocking" | "failed" = "idle";
  private generation = 0;

  require() {
    if (!this.client) throw new Error("Connect your Gitea account first.");
    return this.client;
  }

  cancelRestore() {
    this.generation++;
    this.restore = "idle";
  }

  async restoreSaved(store: Store) {
    const saved = store.get();
    if (
      this.client ||
      this.restore === "unlocking" ||
      !giteaOn(saved) ||
      !saved.account ||
      !saved.encryptedToken
    )
      return;
    const generation = ++this.generation;
    this.restore = "unlocking";
    try {
      const result = await unseal(saved.encryptedToken);
      // A delayed Keychain response must not undo a new sign-in or sign-out.
      if (generation !== this.generation) return;
      if (!result) throw new Error("Empty saved credential");
      this.client = new Gitea(saved.account, result, (url, options) =>
        net.fetch(url, options),
      );
      this.restore = "idle";
    } catch {
      // Preserve the saved credential and all review data for retry.
      if (generation === this.generation) this.restore = "failed";
    }
  }
}
