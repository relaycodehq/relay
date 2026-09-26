import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { RemoteClient } from "../../shared/remote-client";
import { parsePairingUrl, type RemoteEvent } from "../../shared/remote";

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

test("a phone pairs from Settings, answers the agent's approval and is removed again", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-phone-"))),
    folder = join(root, "project"),
    bin = join(root, "bin");
  await mkdir(folder);
  await mkdir(bin);
  await writeFile(join(folder, "README.md"), "# Project\n");
  await writeFile(
    join(bin, "codex"),
    `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
    { mode: 0o700 },
  );
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
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      RELAY_REMOTE_PORT: String(await freePort()),
    },
  });
  const events: RemoteEvent[] = [];
  let phone: RemoteClient | undefined;
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, folder);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();

    await page.getByRole("button", { name: "Open settings" }).first().click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings.getByRole("button", { name: "Phone", exact: true }).click();
    await settings
      .getByRole("switch", { name: "Allow phone connections" })
      .check();
    await expect(
      settings.getByText(/Phones on this network reach Relay/),
    ).toBeVisible();
    await settings
      .getByRole("button", { name: "Pair a phone", exact: true })
      .click();
    await expect(
      settings.getByRole("img", { name: "Pairing QR code" }),
    ).toBeVisible();
    await settings
      .getByRole("button", { name: "Copy pairing link", exact: true })
      .click();
    const url = await app.evaluate(({ clipboard }) => clipboard.readText());
    const link = parsePairingUrl(url)!;
    expect(link).toBeTruthy();

    // The phone's own client, on the loopback address instead of the LAN.
    phone = new RemoteClient({
      start: { link: { ...link, hosts: ["127.0.0.1"] }, device: "Test phone" },
      onEvent: (e) => events.push(e),
    });
    phone.start();
    await expect.poll(() => phone!.status).toBe("online");
    // The QR code closes once the phone is in, and the phone shows as connected.
    await expect(
      settings.getByRole("img", { name: "Pairing QR code" }),
    ).toHaveCount(0);
    await expect(
      settings.getByText("Test phone", { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByText("Connected now", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("settings-phone.png"),
    });
    await settings
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();

    const overview = await phone.call("overview");
    const project = overview.projects[0]!;
    const started = await phone.call("startChat", project.id, {
      id: randomUUID(),
      body: "fixture request approval",
      provider: "codex",
      runtimeMode: "approval-required",
    });

    // The desktop's thread list learns the agent is waiting; so does the phone.
    await expect
      .poll(() =>
        events.some(
          (e) =>
            e.kind === "chats" &&
            e.chats.some((c) => c.id === started.id && c.waiting),
        ),
      )
      .toBe(true);
    const waiting = await phone.call("chat", started.id);
    expect(waiting.requests?.[0]?.decisions).toContain("accept");
    await phone.call("respond", started.id, waiting.requests![0]!.id, {
      kind: "approval",
      decision: "accept",
    });
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

    // What the phone sends shows in the desktop's thread.
    await phone.call("send", started.id, {
      id: randomUUID(),
      body: "Sent from my phone",
    });
    await page
      .getByRole("button", {
        name: /fixture request approval|Cache guard behavior/,
      })
      .first()
      .click();
    await expect(
      page.getByText("Sent from my phone", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Approval flow completed.")).toBeVisible();

    await page.getByRole("button", { name: "Open settings" }).first().click();
    await settings.getByRole("button", { name: "Phone", exact: true }).click();
    await settings.getByRole("button", { name: "Remove Test phone" }).click();
    await expect.poll(() => phone!.status).toBe("denied");
    await expect(settings.getByText("Test phone", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    phone?.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
