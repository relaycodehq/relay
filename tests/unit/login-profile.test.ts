import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loginProfile,
  stableCredentialName,
  experimentalCredentialName,
} from "../../electron/login-profile";

const root = mkdtempSync(join(tmpdir(), "relay-login-profile-"));
const stable = join(root, "stable"),
  experimental = join(root, "experimental");
const saved = {
  version: 1,
  account: {
    id: "test",
    server: "https://gitea.example.test",
    user: { id: 1, login: "reviewer" },
    persistent: true,
  },
  encryptedToken: Buffer.from("ciphertext-only").toString("base64"),
  folders: { existing: "/repo" },
  progress: { existing: { reviewed: true } },
};
function write(dir: string, value: unknown) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(value));
}
afterEach(() => {
  rmSync(stable, { recursive: true, force: true });
  rmSync(experimental, { recursive: true, force: true });
});
it("reuses only a first-run login and leaves stable reviews untouched", () => {
  write(stable, saved);
  expect(loginProfile(experimental, stable)).toEqual({
    credentialName: stableCredentialName,
    imported: { account: saved.account, encryptedToken: saved.encryptedToken },
  });
  expect(JSON.parse(readFileSync(join(stable, "state.json"), "utf8"))).toEqual(
    saved,
  );
});
it("preserves existing experimental credentials and encrypted room sessions", () => {
  write(stable, saved);
  write(experimental, {
    ...saved,
    roomConnections: { project: "encrypted-room-session" },
  });
  expect(loginProfile(experimental, stable)).toEqual({
    credentialName: experimentalCredentialName,
  });
});
it("remembers the imported Keychain namespace across restarts and respects explicit sign-out", () => {
  write(stable, saved);
  write(experimental, { ...saved, credentialName: stableCredentialName });
  expect(loginProfile(experimental, stable)).toEqual({
    credentialName: stableCredentialName,
  });
  write(experimental, {
    version: 1,
    credentialName: stableCredentialName,
    folders: {},
    progress: {},
  });
  expect(loginProfile(experimental, stable)).toEqual({
    credentialName: stableCredentialName,
  });
});
it("starts normally without a saved stable login and reports unreadable profiles without overwriting them", () => {
  expect(loginProfile(experimental, stable)).toEqual({
    credentialName: experimentalCredentialName,
  });
  write(stable, { version: 1, folders: {}, progress: {} });
  expect(loginProfile(experimental, stable).imported).toBeUndefined();
  write(stable, { ...saved, encryptedToken: "invalid encrypted data" });
  expect(() => loginProfile(experimental, stable)).toThrow("preserved");
  expect(
    JSON.parse(readFileSync(join(stable, "state.json"), "utf8")).encryptedToken,
  ).toBe("invalid encrypted data");
});
