import { describe, expect, it } from "vitest";
import { registryProvider } from "../../../../shared/agents";
import { AcpRegistry, type NpmRelease } from "./index";

const listing = {
  agents: [
    {
      id: "qwen-code",
      name: "Qwen Code",
      version: "0.27.2",
      distribution: { npx: { package: "@qwen-code/qwen-code@0.27.2", args: ["--acp"] } },
    },
  ],
};

const registryWith = (npmRelease: NpmRelease) =>
  new AcpRegistry("/nowhere", async () => Response.json(listing), {
    target: "darwin-aarch64",
    npmRelease,
  }).sdkIo(registryProvider("qwen-code"));

describe("registry agents under npm's min-release-age", () => {
  it("offers the newest release npm lets in, not the one the registry pins", async () => {
    const asked: string[] = [];
    const sdk = registryWith(async (pkg, version) => {
      asked.push(`${pkg}@${version}`);
      return { latest: "0.27.0", held: { version: "0.27.2", until: 0 } };
    });
    expect(await sdk.newest()).toBe("0.27.0");
    expect(asked).toEqual(["@qwen-code/qwen-code@0.27.2"]);
  });

  it("says when a held release has nothing older to fall back to", async () => {
    const sdk = registryWith(async () => ({
      held: { version: "0.27.2", until: Date.UTC(2026, 10, 14) },
    }));
    await expect(sdk.newest()).rejects.toThrow(/Qwen Code 0\.27\.2 is newer than your npm's min-release-age/);
  });
});
