import { screenshot } from "../fixtures/screenshot";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { RemoteClient } from "../../shared/remote-client";
import { parsePairingUrl, type RemoteEvent } from "../../shared/remote";
import {
  composeSend,
  desktopNewThreadSettings,
  newThreadSettings,
} from "../../shared/remote-compose";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { freePort } from "../fixtures/free-port";

test("a phone pairs from Settings, answers the agent's approval and is removed again", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-phone-"))),
    folder = join(root, "project"),
    bin = join(root, "bin");
  await mkdir(folder);
  await mkdir(bin);
  await writeFile(join(folder, "README.md"), "# Project\n");
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  await fakeCli(
    join(bin, "claude"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_REMOTE_PORT: String(await freePort()),
      // No Tailscale here: loopback stands in for the tailnet.
      RELAY_REMOTE_TAILNET: "127.0.0.1",
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
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await settings.getByRole("button", { name: "Phone", exact: true }).click();
    const lan = settings.getByRole("switch", {
      name: "Local network",
      exact: true,
    });
    await expect(lan).toBeChecked();
    await settings
      .getByRole("switch", { name: "Allow phone connections" })
      .check();
    await expect(
      settings.getByText(/Phones on this network or your tailnet reach Relay/),
    ).toBeVisible();
    await expect(
      settings.getByText("Tailscale on your phone, optional", { exact: true }),
    ).toBeVisible();
    await screenshot(page, {
      path: join(tmpdir(), "relay-lan-default-settings.png"),
    });
    // Tailscale-only is still an explicit choice, and survives access being
    // toggled. The switch follows what the desktop saved, so it flips a beat
    // after the click.
    await lan.click();
    await expect(lan).not.toBeChecked();
    await settings
      .getByRole("switch", { name: "Allow phone connections" })
      .uncheck();
    await settings
      .getByRole("switch", { name: "Allow phone connections" })
      .check();
    await expect(lan).not.toBeChecked();
    await expect(
      settings.getByText(/Only devices on your tailnet reach Relay/),
    ).toBeVisible();
    await settings
      .getByRole("button", { name: "Show pairing code", exact: true })
      .click();
    await expect(
      settings.getByRole("img", { name: "Pairing QR code" }),
    ).toBeVisible();
    await settings
      .getByRole("button", { name: "Copy pairing link", exact: true })
      .click();
    const url = await app.evaluate(({ clipboard }) => clipboard.readText());
    const link = parsePairingUrl(url)!;
    // The code names the tailnet address alone; loopback stands in for it here.
    expect(link.hosts).toEqual(["127.0.0.1"]);

    phone = new RemoteClient({
      start: { link, device: "Test phone" },
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
    await expect(settings.getByText(/^Connected now/)).toBeVisible();
    // Until the phone says, its version is unknown; then Settings shows it.
    await expect(settings.getByText(/App version unknown/)).toBeVisible();
    await phone.call("reportApp", {
      version: "0.1.0",
      updated: false,
      apk: "0.1.0",
      updates: true,
      update: { kind: "ready", version: "0.1.1" },
    });
    await expect(settings.getByText(/Relay 0\.1\.0/)).toBeVisible();
    await screenshot(page, {
      path: join(tmpdir(), "relay-tailscale-only-settings.png"),
    });
    await settings
      .getByRole("button", { name: "Back to app", exact: true })
      .click();

    const overview = await phone.call("overview");
    const project = overview.projects[0]!;
    // The agent last picked for a new thread, on either side, is where the
    // next one starts on both.
    const picker = page.getByRole("button", {
      name: "Choose model and provider",
      exact: true,
    });
    await picker.click();
    await page.getByRole("button", { name: "Claude", exact: true }).click();
    await page
      .getByRole("option", { name: "Claude default", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await desktopNewThreadSettings(phone!.desktop.bind(phone))).provider,
      )
      .toBe("claude");
    // Picked on the phone, the desktop keeps it for its next new thread; the
    // draft already open keeps the agent and model picked in it.
    await phone.desktop("saveNewThreadAgent", "codex");
    await expect
      .poll(() => page.evaluate(() => window.relay.newThreadAgent()))
      .toBe("codex");
    await page.reload();
    await expect(picker).toContainText("Claude");
    await phone.desktop("saveNewThreadAgent", "claude");
    const opus = {
      model: "claude-opus-5-5",
      fast: false,
      reasoningEffort: "" as const,
    };
    await phone.desktop("saveNewThreadModel", "claude", { choice: opus });
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.relay.newThreadModels()).claude?.choice,
        ),
      )
      .toEqual(opus);
    expect(
      (await desktopNewThreadSettings(phone.desktop.bind(phone))).choice,
    ).toEqual(opus);
    // A supervised thread started the way the phone's New thread does.
    const supervised = {
      ...newThreadSettings(await phone.desktop("aiSettings")),
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

    // Sending from the phone makes its model the next new thread's.
    expect(
      (await phone.desktop("newThreadModels"))[supervised.provider]?.choice,
    ).toEqual(supervised.choice);

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
    await phone.desktop(
      "respondProjectChat",
      started.id,
      waiting.requests![0]!.id,
      {
        kind: "approval",
        decision: "accept",
      },
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

    // What the phone sends shows in the desktop's thread.
    const thread = await phone.call("chat", started.id);
    await phone.desktop(
      "sendProjectChat",
      started.id,
      composeSend(thread.settings!, "Sent from my phone", { id: randomUUID() }),
    );
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
