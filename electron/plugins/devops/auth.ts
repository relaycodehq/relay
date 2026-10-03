import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DevOpsSettings } from "../../../shared/devops";
import { findExecutable } from "../../platform/executables";
import type { Fetch } from "./client";

const exec = promisify(execFile);

/** The Azure DevOps application id, used as the token resource for `az`. */
const devopsResource = "499b84ac-1321-427f-aa17-267ca6975798";

/** The Authorization header for the chosen sign-in: the PAT, or the `az` login. */
export class DevOpsAuth {
  private cliToken?: { value: string; expires: number; base: string };
  /** Bumped by `forget`, so an `az` call that was already running can't store its token. */
  private generation = 0;

  constructor(
    private fetch: Fetch,
    private pat: () => Promise<string | undefined>,
  ) {}

  /** Drops the `az` token, for when the organization or sign-in changes. */
  forget() {
    this.generation++;
    this.cliToken = undefined;
  }

  async header(auth: DevOpsSettings["auth"], base: string) {
    if (auth === "pat") {
      const pat = await this.pat();
      if (!pat)
        throw new Error(
          "Add a personal access token for Azure DevOps in Settings.",
        );
      return `Basic ${Buffer.from(":" + pat).toString("base64")}`;
    }
    if (
      this.cliToken?.base === base &&
      this.cliToken.expires - Date.now() > 5 * 60_000
    )
      return `Bearer ${this.cliToken.value}`;
    const generation = this.generation;
    const az = await findExecutable("az").catch(() => {
      throw new Error(
        "The Azure CLI was not found. Install it and run `az login`, or use a personal access token.",
      );
    });
    // `az` signs into its default tenant, which is often not the one that
    // backs the organization; DevOps then rejects the identity.
    const tenant = await this.resourceTenant(base);
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
      throw new Error(
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
      this.cliToken = {
        base,
        value: token.accessToken,
        expires: token.expires_on
          ? token.expires_on * 1000
          : Date.parse(token.expiresOn ?? "") || Date.now() + 30 * 60_000,
      };
    return `Bearer ${token.accessToken}`;
  }

  /** The Entra tenant Azure DevOps reports for an organization, if any. */
  private async resourceTenant(base: string) {
    try {
      const res = await this.fetch(`${base}/_apis/connectionData`, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
      });
      return tenantOf(res.headers.get("x-vss-resourcetenant") ?? "");
    } catch {
      return undefined;
    }
  }
}

/** Organizations backed by Microsoft accounts report an empty GUID. */
export const tenantOf = (header: string) =>
  /^[0-9a-f-]{36}$/i.test(header) && !/^[0-]+$/.test(header)
    ? header
    : undefined;
