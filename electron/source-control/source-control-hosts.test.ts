import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliState } from "./clis";

const cli = vi.hoisted(() => ({ state: {} as CliState }));
vi.mock("electron", () => ({ app: {}, net: {}, safeStorage: {} }));
vi.mock("./clis", async (original) => ({
  ...(await original<typeof import("./clis")>()),
  probeCli: async () => cli.state,
}));

import { clis } from "./clis";
import { azureDevOps } from "./azure-devops";
import { DevOps } from "../plugins/devops/service";
import { Store } from "../app/store";
import {
  defaultDevOpsSettings,
  type DevOpsSettings,
} from "../../shared/devops";

describe("reading each CLI's version", () => {
  it("takes it from what gh, tea and az really print", () => {
    expect(
      clis.github.version(
        "gh version 2.101.0 (2026-09-15)\nhttps://github.com/cli/cli/releases/tag/v2.101.0\n",
      ),
    ).toBe("2.101.0");
    // tea 0.16.0 bolds the number even into a pipe.
    expect(
      clis.gitea.version(
        "Version: \u001b[1m0.16.0\u001b[0m\tgolang: 1.26.6\tgo-sdk: v1.2.0\n",
      ),
    ).toBe("0.16.0");
    expect(
      clis["azure-devops"].version(
        '{\n  "azure-cli": "2.86.0",\n  "azure-cli-core": "2.86.0",\n  "extensions": {}\n}\n',
      ),
    ).toBe("2.86.0");
  });

  it("finds none in another program's output", () => {
    expect(clis.github.version("git version 2.47.1")).toBeUndefined();
    expect(clis.gitea.version("tea is a drink")).toBeUndefined();
    expect(clis["azure-devops"].version("azure-cli 2.86.0 *")).toBeUndefined();
  });
});

describe("Azure DevOps in Settings", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  async function devops(
    settings: Partial<DevOpsSettings>,
    fetch: () => Promise<Response> = async () => json({}),
    pat?: string,
  ) {
    const store = new Store(await mkdtemp(join(tmpdir(), "relay-azure-")));
    await store.load();
    const d = new DevOps(
      store,
      fetch,
      async (v) => `sealed:${v}`,
      async (v) => v.replace(/^sealed:/, ""),
    );
    await d.save({ ...defaultDevOpsSettings, ...settings }, pat ? { pat } : {});
    return d;
  }
  beforeEach(() => {
    cli.state = { path: "/usr/local/bin/az", version: "2.86.0" };
  });

  it("asks to be set up before anything else", async () => {
    const row = await azureDevOps(await devops({}));
    expect(row).toMatchObject({ signIn: "signed-out", fix: "set-up" });
    // A token sign-in never starts `az`, which takes seconds.
    expect(row.version).toBeUndefined();
    expect(
      await azureDevOps(await devops({ auth: "azure-cli" })),
    ).toMatchObject({ cli: "az", version: "2.86.0" });
  });

  it("names who Azure DevOps accepts, and on which organization", async () => {
    const row = await azureDevOps(
      await devops(
        { organization: "https://dev.azure.com/sample-org/", enabled: true },
        async () =>
          json({ authenticatedUser: { providerDisplayName: "Ann Example" } }),
        "pat-1",
      ),
    );
    expect(row).toMatchObject({
      signIn: "signed-in",
      account: "Ann Example",
      server: "sample-org",
      enabled: true,
    });
  });

  it("points a missing or refused token at the details", async () => {
    expect(
      await azureDevOps(await devops({ organization: "sample-org" })),
    ).toMatchObject({ signIn: "signed-out", fix: "sign-in" });
    const refused = await azureDevOps(
      await devops(
        { organization: "sample-org" },
        async () => new Response("<html>Sign in</html>", { status: 203 }),
        "old-pat",
      ),
    );
    expect(refused).toMatchObject({ signIn: "signed-out", fix: "sign-in" });
    expect(refused.detail).toMatch(/rejected/);
  });

  it("can't tell when Azure DevOps is out of reach", async () => {
    const row = await azureDevOps(
      await devops(
        { organization: "sample-org" },
        async () => {
          throw new TypeError("fetch failed");
        },
        "pat-1",
      ),
    );
    expect(row).toMatchObject({ signIn: "unknown" });
    expect(row.fix).toBeUndefined();
  });

  it("asks for az when it signs in with the Azure CLI and none is found", async () => {
    cli.state = {};
    const row = await azureDevOps(
      await devops({ organization: "sample-org", auth: "azure-cli" }),
    );
    expect(row).toMatchObject({ signIn: "unknown", fix: "link" });
  });
});
