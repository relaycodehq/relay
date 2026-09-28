import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureServer } from "../fixtures/gitea";
import { RoomsDatabase, token } from "../../server/database";
import { createRoomsServer } from "../../server/http";
import { GiteaRepositoryVerifier } from "../../server/repository-access";
import { roomAppUrl } from "../../shared/rooms";

test("shares a private project chat, gates invitations, keeps token streaming local and syncs saved files", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-shared-project-ui-")),
  );
  const fixture = await fixtureServer({
    users: {
      "test-alice": { id: 1, login: "alice", full_name: "Alice" },
      "test-bob": { id: 2, login: "bob", full_name: "Bob" },
    },
  });
  const db = new RoomsDatabase(join(root, "rooms.sqlite")),
    setup = token();
  const server = createRoomsServer(
    db,
    setup,
    new GiteaRepositoryVerifier([fixture.serverUrl]),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const roomUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  const apps: ElectronApplication[] = [],
    pages: Page[] = [],
    repos: string[] = [];
  const bin = join(root, "bin"),
    capture = join(root, "agent.jsonl");
  await mkdir(bin);
  await writeFile(
    join(bin, "codex"),
    `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
    { mode: 0o700 },
  );
  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  try {
    for (const person of ["alice", "bob"]) {
      const repo = join(root, person);
      repos.push(repo);
      if (person === "alice") {
        await mkdir(repo);
        git(repo, "init", "-q", "-b", "review");
        git(repo, "config", "user.name", "Fixture");
        git(repo, "config", "user.email", "fixture@example.invalid");
        git(
          repo,
          "remote",
          "add",
          "origin",
          fixture.serverUrl + "/Web/web-store.git",
        );
        await writeFile(
          join(repo, "example.ts"),
          "export const answer = 42;\n",
        );
        git(repo, "add", ".");
        git(repo, "commit", "-qm", "Base");
      } else {
        execFileSync("git", ["clone", "-q", repos[0], repo]);
        git(
          repo,
          "remote",
          "set-url",
          "origin",
          fixture.serverUrl + "/Web/web-store.git",
        );
      }
      const app = await electron.launch({
        args: ["tests/fixtures/launch.cjs"],
        env: {
          ...env,
          PATH: bin + ":" + env.PATH,
          RELAY_TEST_DATA: join(root, person + "-data"),
          RELAY_TEST_HEADED: "0",
          RELAY_TEST_NATIVE_STORAGE: "0",
          RELAY_AGENT_CAPTURE: capture,
          RELAY_AGENT_TURN_MS: "2600",
        },
      });
      apps.push(app);
      const page = await app.firstWindow();
      pages.push(page);
      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, repo);
      await page.evaluate(
        async ({ url, person }) => {
          await window.relay.connect(url, "test-" + person);
          await window.relay.addProject();
        },
        { url: fixture.serverUrl, person },
      );
      await page.reload();
    }
    const [alice, bob] = pages;
    await alice.evaluate(
      ({ roomUrl, setup }) =>
        window.relay.saveRoomHosting({ server: roomUrl, secret: setup }),
      { roomUrl, setup },
    );
    await alice
      .getByRole("button", { name: "New thread", exact: true })
      .first()
      .click();
    await alice
      .getByRole("button", { name: "Choose model and provider", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Message only", exact: true })
      .click();
    await alice
      .getByRole("option", { name: "Message only", exact: true })
      .click();
    await alice
      .getByLabel("Message project")
      .fill("Let’s review the cache together.");
    await alice
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get(),
    ).toEqual({ n: 0 });
    await alice
      .getByRole("button", { name: "Share conversation", exact: true })
      .click();
    await expect(alice.getByRole("dialog")).toContainText(
      "this server receives your Gitea token",
    );
    await alice
      .getByRole("button", { name: "Verify access and share", exact: true })
      .click();
    const invite = await alice
      .getByLabel("Conversation invitation")
      .inputValue();
    expect(invite).not.toContain(setup);
    expect(invite).not.toContain("test-alice");
    await alice
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await apps[1].evaluate(
      ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
      roomAppUrl(invite),
    );
    await expect(
      bob.getByRole("heading", { name: "Join project conversation" }),
    ).toBeVisible();
    await bob
      .getByRole("button", { name: "Verify access and join", exact: true })
      .click();
    await expect(
      bob
        .locator(".project-messages")
        .getByText("Let’s review the cache together.", { exact: true }),
    ).toBeVisible();
    await alice
      .getByLabel("Message project")
      .fill("@codex Explain this project");
    await alice
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      alice.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      alice.getByRole("button", { name: "Stop answer" }),
    ).toBeVisible();
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM conversation_messages WHERE json_extract(data, '$.role')='assistant'",
        )
        .get(),
    ).toEqual({ n: 0 });
    await expect(
      bob.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(calls.filter((c) => c.turn)).toHaveLength(1);
    expect(calls.find((c) => c.turn).cwd).toBe(repos[0]);
    await bob
      .locator(".project-message.assistant")
      .first()
      .getByRole("button", { name: "Reply to message" })
      .click();
    await bob
      .getByLabel("Message project")
      .fill("I’ll check the invalidation path.");
    await bob
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await alice.getByRole("button", { name: "1 reply", exact: true }).click();
    await expect(
      alice.getByText("I’ll check the invalidation path.", { exact: true }),
    ).toBeVisible();
    for (const page of pages) {
      await page.getByRole("button", { name: /^Together/ }).click();
      await page
        .getByRole("button", { name: "Live sync", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Enable / resume live sync", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Pause live sync", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    }
    await writeFile(
      join(repos[0], "example.ts"),
      "export const answer = 43;\n",
    );
    await expect
      .poll(() => readFile(join(repos[1], "example.ts"), "utf8"), {
        timeout: 20000,
      })
      .toContain("43");
    expect(git(repos[1], "diff", "--cached")).toBe("");
    await alice.getByRole("button", { name: /^Changesb/ }).click();
    await alice.getByRole("button", { name: /Modified example.ts/ }).click();
    await expect(alice.locator("diffs-container")).toBeVisible();
    await alice.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await alice.screenshot({
      path: "test-results/screenshots/41-shared-project-dark.png",
      animations: "disabled",
    });
    for (const app of apps)
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (w) => !relaySeen(w) && !w.isFocused(),
          ),
        ),
      ).toBe(true);
  } finally {
    for (const app of apps) await app.close().catch(() => {});
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
