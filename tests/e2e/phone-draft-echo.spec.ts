import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { RemoteClient } from "../../shared/remote-client";
import { parsePairingUrl, type RemoteEvent } from "../../shared/remote";
import type { SharedDraft } from "../../shared/drafts";
import { composeSend, newThreadSettings } from "../../shared/remote-compose";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { freePort } from "../fixtures/free-port";

test("a phone's send clears its draft even when its last draft push went unanswered", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-draft-echo-"))),
    folder = join(root, "project"),
    bin = join(root, "bin");
  await mkdir(folder);
  await mkdir(bin);
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(folder, "README.md"), "# Project\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
  await fakeCli(join(bin, "codex"), await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_REMOTE_PORT: String(await freePort()),
      RELAY_REMOTE_TAILNET: "127.0.0.1",
    },
  });
  const events: RemoteEvent[] = [];
  let phone: RemoteClient | undefined;
  const heard = (key: string): SharedDraft | null | undefined =>
    events.flatMap((e) => (e.kind === "draft" && e.change.key === key ? [e.change.draft] : [])).at(-1);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, folder);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page.evaluate(() => window.relay.setPhoneRemote(true));
    const { url } = await page.evaluate(() => window.relay.phonePairing());
    phone = new RemoteClient({
      start: { link: parsePairingUrl(url)!, device: "Test phone" },
      onEvent: (e) => events.push(e),
    });
    phone.start();
    await expect.poll(() => phone!.status).toBe("online");
    const project = (await phone.call("overview")).projects[0]!;
    const chat = await phone.desktop("createProjectChat", project.id, { kind: "project" });
    await phone.desktop(
      "sendProjectChat",
      chat.id,
      composeSend(newThreadSettings(await phone.desktop("aiSettings")), "Hello", { id: randomUUID() }),
    );
    await page.getByRole("button", { name: "View activity" }).click();
    const card = page.locator(`.sb-card[data-card="${chat.id}"]`);
    await expect(card).toBeVisible();
    await card.click();
    const prompt = page.getByLabel("Message project");

    // Typed on the phone as its DraftStore pushes: each pause sends what's
    // there, from the rev the last push came back with.
    const full = "test what the jbl does right now";
    const typed = "test what the jbl doe";
    let synced = 0;
    const save = async (text: string, sent?: string) => {
      const after = (await phone!.call("saveDraft", {
        key: chat.id,
        text,
        base: synced,
        at: Date.now(),
        ...(sent !== undefined ? { sent } : {}),
      })) as SharedDraft | null;
      synced = after?.rev ?? synced;
    };
    await save("test what");
    // This push lands, but its answer never reaches the phone.
    const before = synced;
    await save(typed);
    synced = before;
    await expect(prompt).toHaveText(typed);

    // The rest is typed and sent before the next pause.
    const settings = (await phone.call("chat", chat.id)).settings!;
    await phone.call("sendDraft", chat.id, chat.id, composeSend(settings, full, { id: randomUUID() }));
    await save("", full);
    await expect.poll(() => heard(chat.id)).toBeNull();
    await expect(prompt).toHaveText("");
  } finally {
    phone?.close();
    await app.close();
  }
});
