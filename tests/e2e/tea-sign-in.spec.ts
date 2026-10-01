import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("Share signs in through tea's login, asks only without one, and the avatar opens Settings", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-tea-"))),
    repo = join(root, "project"),
    bin = join(root, "bin"),
    logins = join(root, "tea-logins.json"),
    fixture = await fixtureServer();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await (async () => {
    await mkdir(repo, { recursive: true });
    await mkdir(bin);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args]);
    git("init", "-q", "-b", "main");
    git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Initial",
    );
    await writeFile(
      logins,
      JSON.stringify([
        {
          name: "work",
          url: fixture.serverUrl,
          user: "fixture",
          default: "true",
        },
      ]),
    );
    // tea answers git's credential protocol on stdin with the login's token.
    await fakeCli(
      join(bin, "tea"),
      `const [cmd, sub] = process.argv.slice(2);
if (cmd === "logins" && sub === "list")
  process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(logins)}, "utf8"));
else if (cmd === "logins" && sub === "helper") {
  process.stdin.resume();
  process.stdin.on("end", () => process.stdout.write("password=test-token\\n"));
} else process.exit(1);
`,
      "Version: 0.16.0",
    );
    return electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
  })();
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(async () => {
      const project = (await window.relay.addProject())!;
      const chat = await window.relay.createProjectChat(project.id, {
        kind: "project",
      });
      localStorage.setItem("relay-project-chat:" + project.id, chat.id);
    });
    await page.reload();
    const signInForm = page.getByLabel("Gitea server", { exact: true });
    const share = page.getByRole("dialog", { name: "Share conversation" });
    const avatar = page.locator(".sb-account");

    // Signed out, but tea has a login: Share goes straight to sharing.
    await expect(avatar).not.toHaveClass(/signed-in/);
    await page
      .getByRole("button", { name: "Share conversation", exact: true })
      .click();
    await expect(share).toBeVisible();
    await expect(signInForm).toHaveCount(0);
    await expect(avatar).toHaveClass(/signed-in/);
    await share.getByRole("button", { name: "Close dialog" }).click();

    // Signed in, the avatar is the account in Settings, not a token form.
    await avatar.click();
    await expect(page.locator(".settings-account")).toBeVisible();
    await expect(signInForm).toHaveCount(0);

    // Without a token or a tea login, Share asks, then carries on.
    await writeFile(logins, "[]");
    await page
      .getByRole("button", { name: "Disconnect account", exact: true })
      .click();
    await expect(avatar).not.toHaveClass(/signed-in/);
    await page
      .getByRole("button", { name: "Share conversation", exact: true })
      .click();
    await expect(signInForm).toBeVisible();
    await expect(share).toHaveCount(0);
    await signInForm.fill(fixture.serverUrl);
    await page
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page.getByRole("button", { name: "Connect to Gitea" }).click();
    await expect(share).toBeVisible();
    await expect(signInForm).toHaveCount(0);
  } finally {
    await app.close().catch(() => {});
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
