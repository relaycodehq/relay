import { screenshot } from "../fixtures/screenshot";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { composeSend, newThreadSettings } from "../../shared/remote-compose";
import { parsePairingUrl, type RemoteEvent } from "../../shared/remote";
import { RemoteClient } from "../../shared/remote-client";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

test("a headless Relay pairs from the terminal, works for a phone and takes a thread from the desktop and back", async () => {
  test.setTimeout(240_000);
  execFileSync(process.execPath, ["scripts/build-headless.mjs", "9.9.9"]);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-headless-"))),
    bin = join(root, "bin"),
    home = join(root, "mini-home");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
      { cwd, encoding: "utf8" },
    ).trim();
  // One shared remote, cloned on both computers; `me/project` is how they match.
  const origin = join(root, "remote", "me", "project.git");
  await mkdir(origin, { recursive: true });
  git(origin, "init", "--bare", "-q", "-b", "main");
  git(root, "clone", "-q", origin, join(root, "seed"));
  execFileSync("sh", ["-c", "printf '# Cache\\n' > README.md"], {
    cwd: join(root, "seed"),
  });
  git(join(root, "seed"), "add", "-A");
  git(join(root, "seed"), "commit", "-q", "-m", "First");
  git(join(root, "seed"), "push", "-q", "origin", "HEAD:main");
  for (const name of ["laptop", "mini"])
    git(root, "clone", "-q", origin, join(root, name));
  await mkdir(bin);
  for (const cli of ["codex", "claude"])
    await fakeCli(
      join(bin, cli),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const headlessEnv = {
    ...env,
    ...pathWith(env, bin),
    RELAY_HOME: home,
    RELAY_TEST_DATA: home,
    // No Tailscale here: loopback stands in for the tailnet.
    RELAY_REMOTE_TAILNET: "127.0.0.1",
  };
  const relay = (...args: string[]) =>
    execFileSync(process.execPath, ["dist-headless/relay.cjs", ...args], {
      env: headlessEnv,
      encoding: "utf8",
    });
  const relayJson = <T>(...args: string[]) =>
    JSON.parse(relay(...args, "--json")) as T;
  const apps: ElectronApplication[] = [];
  let phone: RemoteClient | undefined;
  try {
    // Set up from the terminal: started in the background, named, given the checkout.
    relay("start", "--port", String(await freePort()), "--name", "Mini");
    relay("projects", "add", join(root, "mini"));
    const status = relayJson<{
      running: boolean;
      status: {
        name: string;
        version: string;
        remote: { listening: boolean; hosts: string[] };
      };
    }>("status");
    expect(status.running).toBe(true);
    expect(status.status).toMatchObject({
      name: "Mini",
      version: "9.9.9",
      remote: { listening: true, hosts: ["127.0.0.1"] },
    });

    // A phone pairs with the code `relay pair` shows, and starts a thread there.
    const forPhone = relayJson<{ url: string }>("pair");
    const events: RemoteEvent[] = [];
    phone = new RemoteClient({
      start: { link: parsePairingUrl(forPhone.url)!, device: "Test phone" },
      onEvent: (e) => events.push(e),
    });
    phone.start();
    await expect.poll(() => phone!.status).toBe("online");
    const overview = await phone.call("overview");
    expect(overview.name).toBe("Mini");
    const project = overview.projects[0]!;
    const supervised = {
      ...newThreadSettings(await phone.desktop("aiSettings"), "codex"),
      runtimeMode: "approval-required" as const,
    };
    const started = await phone.desktop("createProjectChat", project.id, {
      kind: "project",
    });
    await phone.desktop(
      "sendProjectChat",
      started.id,
      composeSend(supervised, "fixture request approval", {
        id: randomUUID(),
      }),
    );
    await expect
      .poll(
        async () => (await phone!.call("chat", started.id)).requests?.length,
      )
      .toBe(1);
    const waiting = await phone.call("chat", started.id);
    await phone.desktop(
      "respondProjectChat",
      started.id,
      waiting.requests![0]!.id,
      { kind: "approval", decision: "accept" },
    );
    await expect
      .poll(() =>
        events.some(
          (e) =>
            e.kind === "message" &&
            e.message.status === "complete" &&
            e.message.body === "Approval flow completed.",
        ),
      )
      .toBe(true);
    expect(relay("threads")).toMatch(/fixture request approval|Cache guard/);

    // The laptop runs the desktop app and pairs with a second code.
    const laptop = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data-laptop"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_REMOTE_PORT: String(await freePort()),
        RELAY_REMOTE_TAILNET: "127.0.0.1",
      },
    });
    apps.push(laptop);
    const page = await laptop.firstWindow();
    await laptop.evaluate(
      ({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [folder],
        });
      },
      join(root, "laptop"),
    );
    await page.evaluate(() => window.relay.addProject());
    await page.reload();

    await page.getByRole("button", { name: /Project folder/ }).click();
    await page.getByRole("menuitem", { name: "New worktree" }).click();
    await page.getByLabel("Message project").fill("fixture edit files");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText("needed no change")).toBeVisible();

    const forLaptop = relayJson<{ url: string }>("pair");
    await page
      .getByRole("button", { name: "Hand off to another computer" })
      .click();
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await settings.getByLabel("Pairing link").fill(forLaptop.url);
    await settings.getByRole("button", { name: "Pair", exact: true }).click();
    await expect(
      settings
        .getByRole("group", { name: "Your computers" })
        .getByRole("button", { name: /Connected/ }),
    ).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    expect(relay("devices")).toMatch(/Test phone[\s\S]*computer/);

    // Handed to the headless Relay: its agent carries on in a worktree there.
    await page
      .getByRole("button", { name: "Hand off to another computer" })
      .click();
    await page.getByRole("menuitem", { name: /Continues in Mini/ }).click();
    const strip = page.locator(".handoff-strip");
    await expect(strip).toContainText(/finished|Working on/, {
      timeout: 60_000,
    });
    await screenshot(page, { path: "test-results/headless-handoff-away.png" });
    type Row = { id: string; title: string; computer?: string };
    let arrived: Row | undefined;
    await expect
      .poll(
        () =>
          (arrived = relayJson<Row[]>("threads").find(
            (t) => t.title === "Cache guard behavior" && t.computer,
          )),
      )
      .toBeTruthy();
    const [there] = JSON.parse(
      relay("call", "projectChats", JSON.stringify(project.id)),
    ).filter((c: { id: string }) => c.id === arrived!.id) as {
      worktree?: { path?: string };
    }[];
    expect(
      await readFile(join(there!.worktree!.path!, "src/guard.ts"), "utf8"),
    ).toBe("export const guard = true;\n");

    // And back again, with the headless Relay's handoff note.
    await expect(strip).toContainText("finished", { timeout: 60_000 });
    await strip.getByRole("button", { name: "Bring back" }).click();
    await expect(strip).toBeHidden({ timeout: 60_000 });
    await expect(page.getByText(/Handoff note for /).first()).toBeVisible();
    await screenshot(page, { path: "test-results/headless-handoff-back.png" });

    // Stopping from the terminal; the phone hears it go.
    relay("stop", "--force");
    expect(relayJson<{ running: boolean }>("status").running).toBe(false);
    await expect.poll(() => phone!.status).not.toBe("online");
  } finally {
    phone?.close();
    for (const app of apps) await app.close().catch(() => {});
    try {
      relay("stop", "--force");
    } catch {
      // Already stopped.
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
