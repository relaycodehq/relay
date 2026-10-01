import type { DevOpsSecrets } from "../../../shared/devops";
import type { Store } from "../../store";

type Encrypt = (value: string) => Promise<string | null>;
type Decrypt = (value: string) => Promise<string>;
type Kind = keyof DevOpsSecrets;

/** Where each sits in the store, from before plugins had `PluginSecrets`. */
const field = {
  pat: "devopsPat",
  openRouterKey: "devopsOpenRouterKey",
} as const;

/**
 * The PAT and the OpenRouter key, sealed with the OS credential store.
 * Where they can't be sealed they live for this session only.
 */
export class DevOpsKeys {
  private session: { pat?: string; openRouterKey?: string } = {};

  constructor(
    private store: Store,
    private encrypt: Encrypt,
    private decrypt: Decrypt,
  ) {}

  has(kind: Kind) {
    return !!(this.store.get()[field[kind]] || this.session[kind]);
  }

  /** False while either is kept for this session only. */
  persistent() {
    return !this.session.pat && !this.session.openRouterKey;
  }

  async get(kind: Kind) {
    if (this.session[kind]) return this.session[kind];
    const sealed = this.store.get()[field[kind]];
    return sealed ? await this.decrypt(sealed) : undefined;
  }

  /**
   * Seals what `secrets` changes and returns the store edit that saves it,
   * so it lands in the same write as the settings.
   */
  async seal(secrets: DevOpsSecrets): Promise<Parameters<Store["update"]>[0]> {
    const seal = async (value: string | null | undefined) =>
      value == null ? value : await this.encrypt(value);
    const sealed = {
      pat: await seal(secrets.pat),
      openRouterKey: await seal(secrets.openRouterKey),
    };
    const kinds = ["pat", "openRouterKey"] as const;
    for (const kind of kinds)
      if (secrets[kind] !== undefined)
        this.session[kind] =
          secrets[kind] && !sealed[kind] ? secrets[kind] : undefined;
    return (s) => {
      for (const kind of kinds)
        if (secrets[kind] !== undefined)
          s[field[kind]] = sealed[kind] ?? undefined;
    };
  }
}
