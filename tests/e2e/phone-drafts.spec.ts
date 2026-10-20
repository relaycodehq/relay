import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type Page,
} from "../fixtures/electron";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { RemoteClient } from "../../shared/remote-client";
import { parsePairingUrl, type RemoteEvent } from "../../shared/remote";
import type { SharedDraft } from "../../shared/drafts";
import { composeSend, newThreadSettings } from "../../shared/remote-compose";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

/** Pastes a small screenshot into the composer, as the clipboard would. */
const pasteShot = (page: Page) =>
  page.getByLabel("Message project").evaluate(async (element) => {
    const canvas = new OffscreenCanvas(320, 200);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#3e63dd";
    g.fillRect(0, 0, 320, 200);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([blob], "image.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }),
    );
  });

test("drafts go between the desktop and a phone, and one holding the desktop's screenshot goes out from the desktop", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-phone-drafts-"))),
    folder = join(root, "project"),
    bin = join(root, "bin"),
    capture = join(root, "agent.jsonl");
  await mkdir(folder);
  await mkdir(bin);
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(folder, "README.md"), "# Project\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_AGENT_CAPTURE: capture,
      RELAY_REMOTE_PORT: String(await freePort()),
      RELAY_REMOTE_TAILNET: "127.0.0.1",
    },
  });
  const events: RemoteEvent[] = [];
  let phone: RemoteClient | undefined;
  /** The draft as the phone last heard it. */
  const heard = (key: string): SharedDraft | null | undefined =>
    events
      .flatMap((e) =>
        e.kind === "draft" && e.change.key === key ? [e.change.draft] : [],
      )
      .at(-1);
  const turns = async () =>
    (await readFile(capture, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((c) => c.turn)
      .map((c) => c.turn.input as { type: string; text?: string }[])
      .filter((input) => !input[0]?.text?.startsWith("Generate a short title"));
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
      composeSend(newThreadSettings(await phone.desktop("aiSettings")), "Explain the cache guard", {
        id: randomUUID(),
      }),
    );
    await page.getByRole("button", { name: "View activity" }).click();
    const card = page.locator(`.sb-card[data-card="${chat.id}"]`);
    await expect(card).toBeVisible();

    // Written on the phone: the desktop's card holds it, marked as the phone's.
    await phone.call("saveDraft", { key: chat.id, text: "Written on the phone", base: 0, at: Date.now() });
    await expect(card.locator(".sb-card-draft")).toHaveText("Written on the phone");
    await expect(card.getByLabel("Draft started on your phone")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("phone-draft-card.png") });

    // Carried on at the desktop: the phone hears the text as it's typed.
    await card.click();
    const prompt = page.getByLabel("Message project");
    await expect(prompt).toHaveText("Written on the phone");
    await prompt.click();
    await page.keyboard.press("End");
    await page.keyboard.type(", finished on the Mac with ");
    await expect.poll(() => heard(chat.id)?.text).toBe("Written on the phone, finished on the Mac with ");

    // A screenshot stays on the desktop; the phone hears it's there.
    await pasteShot(page);
    await expect.poll(() => heard(chat.id)?.extras?.screenshots).toEqual([1]);
    const draft = heard(chat.id)!;
    expect(draft.text).toContain("[Image #1]");
    await page.screenshot({ path: test.info().outputPath("desktop-holds-screenshot.png") });

    // Sent from the phone, it goes out from the desktop with the screenshot.
    const settings = (await phone.call("chat", chat.id)).settings!;
    const before = (await turns()).length;
    await phone.call(
      "sendDraft",
      chat.id,
      chat.id,
      composeSend(settings, draft.text, { id: randomUUID() }),
    );
    await expect.poll(async () => (await turns()).length).toBeGreaterThan(before);
    const turn = (await turns()).at(-1)!;
    expect(turn[0]!.text).toContain("finished on the Mac with [Image #1]");
    expect(turn.filter((i) => i.type === "localImage")).toHaveLength(1);
    // Gone everywhere once it went.
    await expect.poll(() => heard(chat.id)).toBeNull();
    await expect(prompt).toHaveText("");
    await expect(card.locator(".sb-card-draft")).toHaveCount(0);

    // With Relay in the menubar alone, a hidden page sends it.
    await prompt.click();
    await page.keyboard.type("Once more, from the menubar ");
    await pasteShot(page);
    await expect.poll(() => heard(chat.id)?.extras?.screenshots).toEqual([1]);
    const again = heard(chat.id)!;
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.close();
    });
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0);
    const count = (await turns()).length;
    await phone.call("sendDraft", chat.id, chat.id, composeSend(settings, again.text, { id: randomUUID() }));
    await expect.poll(async () => (await turns()).length).toBeGreaterThan(count);
    const last = (await turns()).at(-1)!;
    expect(last[0]!.text).toContain("Once more, from the menubar [Image #1]");
    expect(last.filter((i) => i.type === "localImage")).toHaveLength(1);
    // Nobody sees the page that sent it.
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !relaySeen(w)),
      ),
    ).toBe(true);
    await expect.poll(() => heard(chat.id)).toBeNull();
  } finally {
    phone?.close();
    await app.close();
  }
});
