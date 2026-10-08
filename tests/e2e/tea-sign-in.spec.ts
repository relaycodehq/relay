import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openGiteaSettings, pullsNav } from "../fixtures/navigation";

test("Gitea is off until switched on in Integrations: off, nothing offers it; on, it connects through tea's login and a form only without one", async () => {
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
    const connectGitea = page.getByRole("button", {
      name: "Or connect a Gitea server",
    });
    const noHost = page.getByRole("heading", {
      name: "No pull requests yet",
    });

    // Off, the Pull requests page and Integrations never mention Gitea, and
    // the footer shows the version instead of an account.
    await expect(page.locator(".sb-version")).toBeVisible();
    await pullsNav(page).click();
    await expect(noHost).toBeVisible();
    await expect(connectGitea).toHaveCount(0);

    // Switched on in Integrations, it connects through tea's login without
    // a form.
    const row = await openGiteaSettings(page);
    const toggle = row.getByRole("switch", { name: "Use Gitea" });
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(row).toContainText("Not connected.");
    await row.getByRole("button", { name: "Connect…" }).click();
    await expect(signInForm).toHaveCount(0);
    await expect
      .poll(async () =>
        page.evaluate(async () => (await window.relay.bootstrap()).account),
      )
      .toBeTruthy();
    await openGiteaSettings(page);
    await expect(row).toContainText(`on ${new URL(fixture.serverUrl).host}`);

    // Without a token or a tea login, connecting asks. Disconnecting leaves
    // Settings; Gitea stays on, so Pull requests offers it now.
    await writeFile(logins, "[]");
    await row.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(row).toHaveCount(0);
    await pullsNav(page).click();
    await connectGitea.click();
    await expect(signInForm).toBeVisible();
    await signInForm.fill(fixture.serverUrl);
    await page
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page.getByRole("button", { name: "Connect to Gitea" }).click();
    await expect(signInForm).toHaveCount(0);

    // Off again, Relay lets go of the account but keeps it for next time.
    await page.evaluate(() =>
      window.relay.setSourceControlEnabled("gitea", false),
    );
    let boot = await page.evaluate(() => window.relay.bootstrap());
    expect(boot.account).toBeNull();
    expect(boot.gitea).toBe(false);
    await page.evaluate(() =>
      window.relay.setSourceControlEnabled("gitea", true),
    );
    boot = await page.evaluate(() => window.relay.bootstrap());
    expect(boot.account).toBeTruthy();
    expect(boot.gitea).toBe(true);
  } finally {
    await app.close().catch(() => {});
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
