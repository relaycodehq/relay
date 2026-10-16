import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findExecutable } from "../platform/executables";

const exec = promisify(execFile);

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The Azure DevOps application id, used as the token resource for `az`. */
const devopsResource = "499b84ac-1321-427f-aa17-267ca6975798";

/** `az` is missing or has no login for the organization, as opposed to Azure not answering. */
export class AzureCliSignedOut extends Error {}

/** One token, and how its user hands it back when Azure DevOps refuses it. */
export interface AzureCliToken {
  header: string;
  /** Drops the token if it's still the current one; true when it was. */
  rejected(): boolean;
}

/**
 * Tokens from the `az` login for Azure DevOps organizations. `az` signs into
 * its default tenant, which is often not the one behind an organization, so
 * each organization's tenant is asked for and its token kept apart.
 */
export class AzureCliTokens {
  private tokens = new Map<string, { value: string; expires: number }>();
  /** Each organization's tenant, "" for one backed by Microsoft accounts. */
  private tenants = new Map<string, string>();
  /** `az` runs for seconds, so requests that need a token at once share one run. */
  private asking = new Map<string, Promise<string>>();
  /** Bumped by `forget`, so an `az` call that was already running can't store its token. */
  private generation = 0;

  constructor(private fetch: Fetch) {}

  /** Drops every token, as after the sign-in settings changed. */
  forget() {
    this.generation++;
    this.tokens.clear();
    this.tenants.clear();
    this.asking.clear();
  }

  /** A token for the organization at `base`, e.g. `https://dev.azure.com/org`. */
  async token(base: string): Promise<AzureCliToken> {
    const generation = this.generation;
    const tenant = await this.tenantOf(base);
    const known = this.tokens.get(tenant);
    const value =
      known && known.expires - Date.now() > 5 * 60_000
        ? known.value
        : await this.shared(tenant, generation);
    return {
      header: `Bearer ${value}`,
      rejected: () => {
        // An old request mustn't discard a newer login, even with the same token.
        if (generation !== this.generation) return false;
        if (this.tokens.get(tenant)?.value !== value) return false;
        this.tokens.delete(tenant);
        return true;
      },
    };
  }

  private shared(tenant: string, generation: number) {
    const running = this.asking.get(tenant);
    if (running) return running;
    const next = this.ask(tenant, generation).finally(() => {
      if (this.asking.get(tenant) === next) this.asking.delete(tenant);
    });
    this.asking.set(tenant, next);
    return next;
  }

  private async ask(tenant: string, generation: number) {
    const az = await findExecutable("az").catch(() => {
      throw new AzureCliSignedOut(
        "The Azure CLI was not found. Install it and run `az login`, or use a personal access token.",
      );
    });
    let out: string;
    try {
      ({ stdout: out } = await exec(
        az,
        [
          "account",
          "get-access-token",
          "--resource",
          devopsResource,
          ...(tenant ? ["--tenant", tenant] : []),
          "--output",
          "json",
        ],
        { timeout: 30_000 },
      ));
    } catch {
      throw new AzureCliSignedOut(
        tenant
          ? `The Azure CLI could not get a token for this organization. Run \`az login --tenant ${tenant}\` in a terminal and try again.`
          : "The Azure CLI could not get a token. Run `az login` in a terminal and try again.",
      );
    }
    const token = JSON.parse(out) as {
      accessToken: string;
      expires_on?: number;
      expiresOn?: string;
    };
    if (generation === this.generation)
      this.tokens.set(tenant, {
        value: token.accessToken,
        expires: token.expires_on
          ? token.expires_on * 1000
          : Date.parse(token.expiresOn ?? "") || Date.now() + 30 * 60_000,
      });
    return token.accessToken;
  }

  /** The Entra tenant Azure DevOps reports for an organization; "" when none. */
  private async tenantOf(base: string) {
    const known = this.tenants.get(base);
    if (known !== undefined) return known;
    try {
      const res = await this.fetch(`${base}/_apis/connectionData`, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
      });
      const tenant =
        tenantOf(res.headers.get("x-vss-resourcetenant") ?? "") ?? "";
      this.tenants.set(base, tenant);
      return tenant;
    } catch {
      // Unreachable now; `az`'s default tenant may still do.
      return "";
    }
  }
}

/** Organizations backed by Microsoft accounts report an empty GUID. */
export const tenantOf = (header: string) =>
  /^[0-9a-f-]{36}$/i.test(header) && !/^[0-]+$/.test(header)
    ? header
    : undefined;
