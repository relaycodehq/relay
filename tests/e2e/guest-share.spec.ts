import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Share with guest: the thread's menu makes a link, a guest's suggestions
// show above the composer to edit or dismiss, a guest with Relay can carry the
// conversation on, and Stop sharing ends the link.
test("shares a thread with a guest who suggests a message", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-guest-")));
  const repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID();
  const at = Date.now() - 60_000;
  const message = (n: number, role: string, body: string) => ({
    id: `m${n}`,
    seq: n,
    role,
    provider: "claude",
    status: "complete",
    body,
    created: at + n,
    version: 1,
  });
  const chat = {
    id: randomUUID(),
    projectId,
    title: "Empty state cleanup",
    scope: { kind: "project" },
    created: at,
    updated: at + 1000,
    messages: [
      message(1, "user", "The empty state copy feels off"),
      message(2, "assistant", "Updated it to: No threads yet."),
    ],
  };
  await writeFile(
    join(data, "project-chats", chat.id + ".json"),
    JSON.stringify(chat),
  );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      projects: [
        {
          id: projectId,
          path: repo,
          name: "project",
          repository: null,
          added: 1,
        },
      ],
      chats: [{ ...chat, messages: undefined }],
    }),
  );
  const app = await electron.launch({
    env: { ...relayEnv(), RELAY_TEST_DATA: data, RELAY_PORT_OFFSET: "0" },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() =>
      localStorage.setItem("relay-sidebar-view", "activity"),
    );
    await page.reload();
    const card = page.locator(".sb-card", { hasText: "Empty state cleanup" });
    await card.click();
    await card.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Share with guest…" }).click();

    const dialog = page.getByRole("dialog", { name: "Share with guest" });
    // Test runs never publish: the link stays on this computer.
    await expect(dialog).toContainText("Only this computer can open the link");
    await expect(
      dialog.getByRole("button", { name: "Stop sharing" }),
    ).toBeVisible();
    const link = await page.evaluate(
      async (id) => (await window.relay.guestShare(id))!.localUrl,
      chat.id,
    );
    await dialog.getByRole("button", { name: "Done" }).click();

    const view = await (await fetch(`${link}/view`)).json();
    expect(view.messages.map((m: { html: string }) => m.html)).toEqual([
      "<p>The empty state copy feels off</p>",
      "<p>Updated it to: No threads yet.</p>",
    ]);
    const suggest = (text: string) =>
      fetch(`${link}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: "guest-alex-1", name: "Alex", text }),
      });
    expect((await suggest("Say 'Start one from the sidebar'")).status).toBe(
      200,
    );
    expect((await suggest("Make it rhyme")).status).toBe(200);

    // Edit puts the words in the host's own draft; Dismiss drops them.
    const suggestions = page.getByRole("region", {
      name: "Suggestion from Alex",
    });
    await expect(suggestions).toHaveCount(2);
    await expect(page.locator(".guest-share-live")).toBeVisible();
    await suggestions.first().getByRole("button", { name: "Edit" }).click();
    await expect(
      page.locator(".thread-bottom-composer .ProseMirror"),
    ).toContainText("Say 'Start one from the sidebar'");
    await suggestions.first().getByRole("button", { name: "Dismiss" }).click();
    await expect(suggestions).toHaveCount(0);
    const alex = await (await fetch(`${link}/view?guest=guest-alex-1`)).json();
    expect(alex.suggestions).toEqual([
      { text: "Say 'Start one from the sidebar'", status: "drafted" },
      { text: "Make it rhyme", status: "dismissed" },
    ]);

    // A guest with Relay carries the conversation on in a project of theirs.
    const copied = await page.evaluate(
      ([project, url]) => window.relay.importGuestThread(project, url),
      [projectId, link] as const,
    );
    const thread = await page.evaluate(
      (id) => window.relay.projectChat(id),
      copied.id,
    );
    expect(thread.title).toBe("Empty state cleanup");
    const copiedMessages = thread.messages.filter((m) => typeof m !== "string");
    expect(
      copiedMessages.map((m) => [m.author ?? m.role, m.body, m.imported]),
    ).toEqual([
      ["Host", "The empty state copy feels off", true],
      ["assistant", "Updated it to: No threads yet.", true],
    ]);

    await page
      .locator(".guest-share-live")
      .getByRole("button", { name: "Stop sharing" })
      .click();
    await expect(page.locator(".guest-share-live")).toHaveCount(0);
    await expect(fetch(link)).rejects.toThrow();
  } finally {
    await app.close();
  }
});
