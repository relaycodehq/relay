import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setLinkedTools } from "../platform/executables";
import { teaTokenFor } from "./tea";
import type { Account } from "../../shared/types";

const account: Account = {
  id: "https://git.example.com/gitea#7",
  server: "https://git.example.com/gitea",
  user: { id: 7, login: "vilem-jelen" },
  persistent: true,
};

/** A `tea` that answers like 0.16, or like one before `helper get --login`. */
async function fakeTea({ login = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "relay-tea-"));
  const path = join(root, "tea");
  await writeFile(
    path,
    `#!/bin/sh
case "$*" in
  --version) echo "Version: 0.16.0" ;;
  "logins list --output json")
    echo '[{"name":"tbs","url":"https://git.example.com/gitea","user":"vilem-jelen","default":true}]' ;;
  "logins helper get --login tbs")
    ${login ? 'cat >/dev/null; echo "password=from-login"' : 'echo "flag provided but not defined: -login" >&2; exit 1'} ;;
  "logins helper get")
    cat >/dev/null; echo "password=from-host" ;;
  *) exit 2 ;;
esac
`,
  );
  await chmod(path, 0o755);
  setLinkedTools({ tea: path });
}

describe.skipIf(process.platform === "win32")("a token from tea", () => {
  afterEach(() => setLinkedTools({}));

  it("asks for the account's login by name", async () => {
    await fakeTea();
    expect(await teaTokenFor(account)).toBe("from-login");
  });

  it("goes by host with a tea too old for --login", async () => {
    await fakeTea({ login: false });
    expect(await teaTokenFor(account)).toBe("from-host");
  });

  it("has none for an account tea isn't signed in to", async () => {
    await fakeTea();
    await expect(
      teaTokenFor({ ...account, user: { id: 8, login: "someone-else" } }),
    ).rejects.toThrow("tea has no login for someone-else on git.example.com");
  });
});
