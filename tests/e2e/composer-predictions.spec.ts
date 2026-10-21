import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.setTimeout(90_000);

// The guess the last answer left shows over the empty composer: typing hides
// it, emptying the draft brings it back, Tab takes it and Escape puts it away.
test("offers the next-message guess as a draft", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-predictions-")),
  );
  const repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID();
  const start = Date.now() - 60_000;
  const chat = {
    id: randomUUID(),
    projectId,
    title: "Composer predictions",
    scope: { kind: "project" },
    created: start,
    updated: start + 1000,
    messages: [
      {
        id: "u1",
        role: "user",
        provider: "claude",
        status: "complete",
        body: "add the ghost text to the composer",
        created: start,
        version: 1,
      },
      {
        id: "a1",
        role: "assistant",
        provider: "claude",
        status: "complete",
        body: "Done. The composer now shows the guess as a draft while it's empty.\n\nI didn't wire the phone yet; want me to do Android and iOS next?",
        prediction: "yeah do the phones too, android first",
        created: start + 500,
        ended: start + 900,
        version: 1,
      },
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
    env: { ...relayEnv(), RELAY_TEST_DATA: data },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 760 });
    await page
      .getByRole("complementary", { name: "Projects" })
      .getByText("Composer predictions")
      .first()
      .click();
    const ghost = page.locator(".composer-ghost");
    await expect(ghost).toContainText("android first");
    const input = page.getByLabel("Message project");
    await input.click();
    await page.keyboard.type("no wait");
    await expect(ghost).toHaveCount(0);
    for (let i = 0; i < 7; i++) await page.keyboard.press("Backspace");
    await expect(ghost).toContainText("android first");
    await page.keyboard.press("Tab");
    await expect(ghost).toHaveCount(0);
    await expect(input).toHaveText("yeah do the phones too, android first");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    await page.keyboard.press("Backspace");
    await expect(ghost).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ghost).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
