import type { PluginId } from "../../shared/plugins";
import type { Store } from "../store";

type Encrypt = (value: string) => Promise<string | null>;
type Decrypt = (value: string) => Promise<string>;

/**
 * Plugin secrets, sealed with the OS credential store. Where it can't seal
 * them safely (Linux's plaintext backend) they live for this session only.
 * Nothing here hands a secret to the renderer; callers expose `has` only.
 */
export class PluginSecrets {
  private session = new Map<string, string>();

  constructor(
    private store: Store,
    private encrypt: Encrypt,
    private decrypt: Decrypt,
  ) {}

  has(plugin: PluginId, name: string) {
    return (
      !!this.store.get().pluginSecrets?.[plugin]?.[name] ||
      this.session.has(`${plugin}/${name}`)
    );
  }

  /** False while any of the plugin's secrets is kept for this session only. */
  persistent(plugin: PluginId) {
    return ![...this.session.keys()].some((k) => k.startsWith(`${plugin}/`));
  }

  async get(plugin: PluginId, name: string) {
    const kept = this.session.get(`${plugin}/${name}`);
    if (kept) return kept;
    const sealed = this.store.get().pluginSecrets?.[plugin]?.[name];
    return sealed ? await this.decrypt(sealed) : undefined;
  }

  /** `undefined` keeps the secret, `null` forgets it. */
  async set(plugin: PluginId, name: string, value: string | null | undefined) {
    if (value === undefined) return;
    const key = `${plugin}/${name}`;
    const sealed = value === null ? null : await this.encrypt(value);
    this.session.delete(key);
    if (value !== null && !sealed) this.session.set(key, value);
    await this.store.update((s) => {
      const secrets = { ...s.pluginSecrets?.[plugin] };
      if (sealed) secrets[name] = sealed;
      else delete secrets[name];
      s.pluginSecrets = { ...s.pluginSecrets, [plugin]: secrets };
    });
  }
}
