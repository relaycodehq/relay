import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acpProfiles } from "./profiles";

afterEach(() => vi.unstubAllEnvs());

describe("Antigravity's sign-in on disk", () => {
  const antigravity = () => acpProfiles.antigravity.account!();
  let own: string;
  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "relay-antigravity-"));
    own = join(home, "antigravity-acp");
    await mkdir(own);
    vi.stubEnv("GEMINI_HOME", home);
    // Off the keychain, so the token is a file this test can write.
    vi.stubEnv("AGY_ACP_FORCE_FILE_STORAGE", "1");
  });
  const save = (name: string, value: unknown) =>
    writeFile(join(own, name), JSON.stringify(value));

  it("is signed out until it has chosen a sign-in and saved its token", async () => {
    expect(await antigravity()).toEqual({ signedIn: false });
    await save("settings.json", { auth: { type: "oauth-personal" } });
    expect(await antigravity()).toEqual({ signedIn: false });
    await save("acp_token.json", { refresh_token: "r" });
    expect(await antigravity()).toEqual({ signedIn: true });
  });

  it("leaves other sign-ins to Antigravity", async () => {
    await save("settings.json", { auth: { type: "agent-platform" } });
    expect(await antigravity()).toBeUndefined();
  });
});
