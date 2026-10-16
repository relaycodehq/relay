import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findExecutable } from "../platform/executables";

const exec = promisify(execFile);

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The Azure DevOps application id, used as the token resource for `az`. */
const devopsResource = "499b84ac-1321-427f-aa17-267ca6975798";

/** `az` is missing or has no login for the organization, as opposed to Azure not answering. */
export class AzureCliSignedOut extends Error {}

/**
 * Entra's codes for a login that is missing, lapsed or needs the user again
 * (MFA, consent, an expired or revoked refresh token).
 */
const signedOutCodes = [
  16000, 16001, 50020, 50034, 50058, 50076, 50078, 50079, 50132, 50133, 50173,
  65001, 70043, 500133, 700082, 700084,
];
/** How `az` says its login is missing or has lapsed; anything else isn't a sign-out. */
const signedOutWords =
  /az login|interaction_required|invalid_grant|refresh token|MSAL token cache|not logged in|no subscriptions? found/i;
/**
 * `az` can advise `az login` after any Entra failure, an outage too, so a
 * code it names decides, not its advice.
 */
function saysSignedOut(said: string) {
  const code = /AADSTS(\d+)/i.exec(said)?.[1];
  return code
    ? signedOutCodes.includes(Number(code))
    : signedOutWords.test(said);
}

/** How long a missing login is believed before `az` is run again for it. */
const SIGNED_OUT_FOR = 60_000;

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
  /** Tenants `az` just said it has no login for, so polls don't run it again and again. */
  private signedOut = new Map<
    string,
    { at: number; error: AzureCliSignedOut }
  >();

  constructor(private fetch: Fetch) {}

  /** Drops every token, as after the sign-in settings changed. */
  forget() {
    this.generation++;
    this.tokens.clear();
    this.tenants.clear();
    this.asking.clear();
    this.signedOut.clear();
  }

  /** Drops `base`'s token, so the next one is asked of `az`'s current login. */
  async renew(base: string) {
    const tenant = await this.tenantOf(base);
    this.tokens.delete(tenant);
    this.signedOut.delete(tenant);
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
    const out = this.signedOut.get(tenant);
    if (out && Date.now() - out.at < SIGNED_OUT_FOR)
      return Promise.reject(out.error);
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
    } catch (e) {
      const failure = e as Error & { stderr?: string; killed?: boolean };
      const said = `${failure.stderr ?? ""}\n${failure.message ?? ""}`;
      // Offline, a timeout or a broken `az` isn't a sign-out; Check again retries it.
      if (failure.killed || !saysSignedOut(said))
        throw new Error(
          failure.killed
            ? "The Azure CLI didn't answer within 30s. Try again."
            : `The Azure CLI couldn't get a token: ${lastLine(said)}`,
        );
      const error = new AzureCliSignedOut(
        tenant
          ? `The Azure CLI could not get a token for this organization. Run \`az login --tenant ${tenant}\` in a terminal and try again.`
          : "The Azure CLI could not get a token. Run `az login` in a terminal and try again.",
      );
      if (generation === this.generation)
        this.signedOut.set(tenant, { at: Date.now(), error });
      throw error;
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
      const header = res.headers.get("x-vss-resourcetenant");
      const tenant = tenantOf(header ?? "") ?? "";
      // A throttled or failing answer may leave the header out; ask again next time.
      if (header !== null || res.ok) this.tenants.set(base, tenant);
      return tenant;
    } catch {
      // Unreachable now; `az`'s default tenant may still do.
      return "";
    }
  }
}

/** The last thing `az` said, which is where it explains a failure. */
const lastLine = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 300) ?? "it failed without saying why.";

/** Organizations backed by Microsoft accounts report an empty GUID. */
export const tenantOf = (header: string) =>
  /^[0-9a-f-]{36}$/i.test(header) && !/^[0-]+$/.test(header)
    ? header
    : undefined;
