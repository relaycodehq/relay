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
import { randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { fixtureServer, newCode } from "../fixtures/gitea";
import { RoomsDatabase, token } from "../../server/database";
import { createRoomsServer } from "../../server/http";
import { roomAppUrl } from "../../shared/rooms";
let fixture: Awaited<ReturnType<typeof fixtureServer>>,
  database: RoomsDatabase,
  server: ReturnType<typeof createRoomsServer>,
  proxy: ReturnType<typeof createServer>;
let root: string,
  bin: string,
  repo: string,
  capture: string,
  serverUrl: string,
  setupKey: string;
const apps: ElectronApplication[] = [];
const pages: Page[] = [];
const ref = { owner: "Web", name: "web-store", number: 7 };
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-shared-room-"));
  bin = join(root, "bin");
  repo = join(root, "repo");
  capture = join(root, "agent.jsonl");
  await mkdir(bin);
  await mkdir(repo);
  fixture = await fixtureServer({
    users: {
      "test-alice": { id: 101, login: "alice", full_name: "Alice" },
      "test-bob": { id: 102, login: "bob", full_name: "Bob" },
      "test-colleague": { id: 103, login: "colleague", full_name: "Colleague" },
    },
  });
  database = new RoomsDatabase(join(root, "rooms.sqlite"));
  setupKey = token();
  server = createRoomsServer(database, setupKey);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const upstream = `http://127.0.0.1:${(server.address() as any).port}`;
  // Exercise the real deployment shape, including invitations copied between clients.
  proxy = createServer((req, res) => {
    if (!req.url?.startsWith("/review-relay/")) {
      res.writeHead(404).end();
      return;
    }
    const forwarded = request(
      upstream + req.url.slice("/review-relay".length),
      {
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      },
    );
    forwarded.on("error", () => res.writeHead(502).end());
    req.pipe(forwarded);
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  serverUrl = `http://127.0.0.1:${(proxy.address() as any).port}/review-relay`;
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Room test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
  await mkdir(join(repo, "src/hooks"), { recursive: true });
  await writeFile(join(repo, "src/hooks/useReview.ts"), newCode);
  git("add", ".");
  git("commit", "--quiet", "-m", "Test checkout");
  for (const name of ["codex", "claude"])
    await writeFile(
      join(bin, name),
      `#!${process.execPath}\nrequire(${JSON.stringify(resolve("tests/fixtures/room-agent.cjs"))});\n`,
      { mode: 0o700 },
    );
  for (const person of ["alice", "bob"]) {
    const data = join(root, person);
    await mkdir(data);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    const app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        PATH: bin + ":" + env.PATH,
        RELAY_TEST_DATA: data,
        RELAY_AGENT_CAPTURE: capture,
      },
    });
    apps.push(app);
    const page = await app.firstWindow();
    pages.push(page);
    await page.evaluate(
      async ({ url, ref, person }) => {
        await window.relay.connect(url, `test-${person}`);
        await window.relay.saveWorkspace({
          pull: ref,
          file: "src/hooks/useReview.ts",
          filter: "all",
          query: "",
          state: "open",
        });
      },
      { url: fixture.serverUrl, ref, person },
    );
    await app.evaluate(({ dialog, clipboard }, repo) => {
      let copied = "";
      clipboard.writeText = async (text) => {
        copied = text;
      };
      clipboard.readText = async () => copied;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.reload();
    await page
      .getByRole("button", { name: /Make pull request reviews faster/ })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Make pull request reviews faster and more reliable",
      }),
    ).toBeVisible();
    await page.evaluate((ref) => window.relay.linkFolder(ref), ref);
    await page
      .getByRole("button", { name: "Toggle PR room", exact: true })
      .click();
  }
});
test.afterAll(async () => {
  for (const app of apps) await app.close().catch(() => {});
  await new Promise<void>((r) => proxy?.close(() => r()));
  await new Promise<void>((r) => server?.close(() => r()));
  database?.close();
  await fixture?.close();
  await rm(root, { recursive: true, force: true });
});
test("two desktops join by invitation; ordinary messages and replies never launch an agent", async () => {
  const [alice, bob] = pages;
  await alice
    .getByRole("button", { name: "Hosting settings", exact: true })
    .click();
  await alice.getByText("Manage hosting access", { exact: true }).click();
  await alice.getByLabel("Room server", { exact: true }).fill(serverUrl);
  await alice.getByLabel("Server setup key").fill(setupKey);
  await alice
    .getByRole("button", { name: "Save hosting access", exact: true })
    .click();
  await expect(
    alice.getByText(`Ready to create invitations using ${serverUrl}.`),
  ).toBeVisible();
  await alice
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await alice
    .getByRole("button", { name: "Invite colleague", exact: true })
    .click();
  await expect(alice.getByLabel("Message PR room")).toBeVisible();
  const invite = await alice
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  expect(invite.startsWith(serverUrl + "/#join=")).toBe(true);
  expect(invite).not.toContain(setupKey);
  expect(await readFile(join(root, "alice/state.json"), "utf8")).not.toContain(
    setupKey,
  );
  await alice
    .getByRole("button", { name: "Copy invitation", exact: true })
    .click();
  expect(await alice.evaluate(() => window.relay.readClipboard())).toBe(invite);
  await alice.getByRole("button", { name: "Done", exact: true }).click();
  await apps[1].evaluate(({ app }, url) => {
    app.emit("open-url", { preventDefault() {} }, url);
  }, roomAppUrl(invite));
  await expect(
    bob.getByRole("heading", { name: "Join the review", exact: true }),
  ).toBeVisible();
  await bob
    .getByRole("button", { name: "Join and open PR", exact: true })
    .click();
  await expect(bob.getByLabel("Message PR room")).toBeVisible();
  await alice
    .getByLabel("Message PR room")
    .fill("I think the cache guard needs a closer look.");
  await alice
    .getByRole("complementary", { name: "PR room" })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(
    bob
      .locator(".room-message .markdown")
      .getByText("I think the cache guard needs a closer look.", {
        exact: true,
      }),
  ).toBeVisible();
  await bob
    .locator(".room-message")
    .first()
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await bob
    .getByLabel("Message PR room")
    .fill("Agreed. I will check the cancellation path.");
  await bob
    .getByRole("complementary", { name: "PR room" })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(
    alice.getByText("Agreed. I will check the cancellation path.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await readFile(capture, "utf8").catch(() => "")).toBe("");
});
test("only the sender's agent starts, streams to both desktops, and receives pinned code plus reply ancestors", async () => {
  const [alice, bob] = pages;
  await alice
    .locator(".room-message")
    .last()
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await alice.getByRole("button", { name: "Room agent settings" }).click();
  await alice
    .getByRole("combobox", { name: "Room questions model", exact: true })
    .selectOption("gpt-5.6-luna");
  await alice
    .getByRole("combobox", {
      name: "Room questions reasoning effort",
      exact: true,
    })
    .selectOption("low");
  await alice
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await alice.locator('[data-column-number="20"]').last().click();
  await alice
    .getByRole("button", { name: "Discuss in room", exact: true })
    .click();
  await alice
    .getByLabel("Message PR room")
    .fill("@codex Is the cache guard safe?");
  await alice.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    bob.getByText("The cache guard prevents duplicate requests.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(alice.locator(".room-run-status")).toHaveCount(0);
  const calls = (await readFile(capture, "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(calls.filter((c) => c.thread)).toHaveLength(1);
  const turn = calls.find((c) => c.turn).turn;
  expect(turn.effort).toBe("low");
  expect(turn.permissions).toBe("review-relay-room");
  expect(turn.input[0].text).toContain("cancellation path");
  expect(turn.input[0].text).toContain("excerpt");
  expect(calls[0].cwd).toBe(await realpath(repo));
  await alice
    .getByRole("button", { name: "Hide pull requests", exact: true })
    .click();
  await alice.locator(".room-code-context > summary").click();
  await expect(alice.locator(".room-code-context pre")).toBeVisible();
  await expect(alice.locator(".room-code-context pre")).toContainText(
    ".then(response => response.json())",
  );
  await expect(alice.locator(".room-code-context pre")).not.toContainText(
    '"pr":',
  );
  await alice.screenshot({
    path: "test-results/shared-pr-room.png",
    animations: "disabled",
  });
  await alice.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await alice.screenshot({
    path: "test-results/shared-pr-room-dark.png",
    animations: "disabled",
  });
});
test("conversation layout supports inline reply folding, resizing and recipient selection", async () => {
  const [alice, bob] = pages;
  const room = alice.getByRole("complementary", { name: "PR room" });
  const roomBox = await room.boundingBox(),
    codeBox = await alice.locator(".review-main").boundingBox();
  expect(roomBox!.x + roomBox!.width).toBeLessThanOrEqual(codeBox!.x + 1);
  const replies = alice.locator(".room-replies").first();
  await replies.locator(":scope > summary").click();
  await expect(replies).not.toHaveAttribute("open", "");
  await bob
    .getByLabel("Message PR room")
    .fill("The collapsed discussion should stay collapsed.");
  await bob
    .getByRole("complementary", { name: "PR room" })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(
    alice.getByText("The collapsed discussion should stay collapsed.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(replies).not.toHaveAttribute("open", "");
  await replies.locator(":scope > summary").click();
  await expect(replies.locator(".room-reply-thread")).toBeVisible();
  await alice.getByLabel("Message PR room").fill("Explain this");
  await alice
    .getByRole("combobox", { name: "Message recipient" })
    .selectOption("claude");
  await expect(alice.getByLabel("Message PR room")).toHaveValue(
    "@claude Explain this",
  );
  await alice
    .getByRole("combobox", { name: "Message recipient" })
    .selectOption("people");
  await expect(alice.getByLabel("Message PR room")).toHaveValue("Explain this");
  const resizer = alice.getByRole("separator", { name: "Resize conversation" });
  await resizer.focus();
  await alice.keyboard.press("ArrowRight");
  await expect(resizer).toHaveAttribute("aria-valuenow", "470");
  await alice.reload();
  await expect(
    alice.getByRole("separator", { name: "Resize conversation" }),
  ).toHaveAttribute("aria-valuenow", "470");
  await expect(alice.getByLabel("Message PR room")).toHaveValue("Explain this");
});
test("Claude uses its own provider; cancellation keeps partial Codex output; draft survives reload", async () => {
  const [alice, bob] = pages;
  await bob.getByLabel("Message PR room").fill("@claude What do you think?");
  await bob.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    alice.getByText("Claude found the same cache guard.", { exact: true }),
  ).toBeVisible();
  await alice
    .getByLabel("Message PR room")
    .fill("@codex wait for cancellation");
  await alice.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    alice.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await alice.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(bob.getByText("Stopped by you.", { exact: true })).toBeVisible();
  await bob
    .getByLabel("Message PR room")
    .fill("Unsent thought survives reload");
  await bob.reload();
  await expect(bob.getByLabel("Message PR room")).toHaveValue(
    "Unsent thought survives reload",
  );
  await expect(
    bob.getByText("Claude found the same cache guard.", { exact: true }),
  ).toBeVisible();
});

test("an invitation survives cold launch and sign-in, opens the correct PR, and reopens safely for an existing member", async () => {
  const invitation = await pages[0].evaluate(
    (ref) => window.relay.roomInvite(ref),
    ref,
  );
  const data = join(root, "new-colleague");
  await mkdir(data);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs", roomAppUrl(invitation.code)],
    env: { ...environment, RELAY_TEST_DATA: data },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel("Gitea server", { exact: true })).toHaveValue(
      fixture.serverUrl,
    );
    await page
      .getByLabel("Personal access token", { exact: true })
      .fill("test-colleague");
    await page
      .getByRole("button", { name: "Connect to Gitea", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Join the review", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Join and open PR", exact: true })
      .click();
    await expect(page.getByLabel("Message PR room")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Make pull request reviews faster and more reliable",
      }),
    ).toBeVisible();
    await app.evaluate(
      ({ app }, url) =>
        app.emit("second-instance", {}, ["review-relay", url], ""),
      roomAppUrl(invitation.code),
    );
    await page
      .getByRole("button", { name: "Join and open PR", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Join the review", exact: true }),
    ).not.toBeVisible();
    await expect(page.getByLabel("Message PR room")).toBeVisible();
  } finally {
    await app.close();
  }
});
