import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("keeps several new-thread drafts in Activity and sends them from their cards", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-drafts-")));
  const repo = join(root, "alpha"),
    bin = join(root, "bin"),
    capture = join(root, "agent.jsonl");
  await mkdir(repo);
  await mkdir(bin);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "README.md"), "Example");
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
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page.getByRole("button", { name: "View activity" }).click();
    const newThread = () =>
      page.keyboard.press(
        process.platform === "darwin" ? "Meta+N" : "Control+N",
      );
    const prompt = page.getByLabel("Message project");
    const drafts = page.locator(".sb-card.draft");
    const card = (text: string) => drafts.filter({ hasText: text });
    const sendFrom = async (text: string) => {
      await card(text).hover();
      await card(text).getByRole("button", { name: "Send draft" }).click();
    };
    const prompts = async () =>
      (await readFile(capture, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.turn)
        .map((entry) => entry.turn.input[0].text as string)
        .filter((text) => !text.startsWith("Generate a short title"));

    // The draft being written is in Activity from its first word on.
    await newThread();
    await prompt.fill("First idea");
    await expect(card("First idea")).toHaveClass(/selected/);
    // A new thread leaves it there and starts another.
    await newThread();
    await expect(prompt).toHaveText("");
    await expect(card("First idea")).not.toHaveClass(/selected/);
    await prompt.fill("Second idea");
    await expect(drafts).toHaveCount(2);
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    // Numbers follow the visible drafts, including the one already open.
    for (let index = 0; index < 2; index++) {
      const draft = drafts.nth(index);
      const text = await draft.locator(".sb-card-draft").innerText();
      await page.keyboard.press(`${modifier}+${index + 1}`);
      await expect(draft).toHaveClass(/selected/);
      await expect(prompt).toHaveText(text);
    }
    // Each card goes back to its own draft.
    await card("First idea").click();
    await expect(prompt).toHaveText("First idea");
    await expect(card("First idea")).toHaveClass(/selected/);
    await expect(card("Second idea")).not.toHaveClass(/selected/);

    // Another draft goes out from its card, leaving the open one alone.
    await sendFrom("Second idea");
    await expect(card("Second idea")).toHaveCount(0);
    await expect
      .poll(prompts)
      .toEqual([expect.stringContaining("Second idea")]);
    await expect(page.locator(".sb-card:not(.draft)")).toHaveCount(1);
    await expect(prompt).toHaveText("First idea");

    // A thread below an unsent draft gets the next number and hint.
    await page.keyboard.down(modifier);
    await expect(card("First idea").locator("kbd")).toContainText("1");
    await expect(page.locator(".sb-card:not(.draft) kbd")).toContainText("2");
    await page.screenshot({
      path: join(tmpdir(), "relay-activity-shortcuts.png"),
    });
    await page.keyboard.up(modifier);
    await page.keyboard.press(`${modifier}+2`);
    await expect(page.locator(".sb-card:not(.draft)")).toHaveClass(/selected/);
    await expect(prompt).toHaveText("");
    await page.keyboard.press(`${modifier}+1`);
    await expect(card("First idea")).toHaveClass(/selected/);
    await expect(prompt).toHaveText("First idea");

    // The open one goes out through its composer, and its thread opens.
    await sendFrom("First idea");
    await expect(drafts).toHaveCount(0);
    await expect.poll(async () => (await prompts()).length).toBe(2);
    expect((await prompts())[1]).toContain("First idea");
    await expect(page.locator(".sb-card:not(.draft)")).toHaveCount(2);
    await expect(prompt).toHaveText("");
    await expect(
      page.locator(".project-messages").getByText("First idea"),
    ).toBeVisible();

    // A thread's draft tints its own card, which rises as it's typed.
    const cards = page.locator(".sb-cards .sb-card");
    // By id: agents answering reorder the cards under a click by place.
    const followed = await page
      .locator(".sb-cards .sb-card:not(.selected)")
      .getAttribute("data-card");
    const thread = page.locator(`.sb-card[data-card="${followed}"]`);
    await thread.click();
    await expect(thread).toHaveClass(/selected/);
    await prompt.fill("Follow-up");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toHaveAttribute("data-card", followed!);
    await expect(cards.first()).toHaveClass(/draft/);
    await expect(cards.first()).toHaveClass(/selected/);
    await expect(cards.first()).toContainText("Follow-up");
    // It goes out through the open composer, and the card keeps its place.
    await sendFrom("Follow-up");
    await expect.poll(async () => (await prompts()).length).toBe(3);
    expect((await prompts())[2]).toContain("Follow-up");
    await expect(drafts).toHaveCount(0);
    await expect(prompt).toHaveText("");
    await expect(cards.first()).toHaveAttribute("data-card", followed!);

    // A settled thread rises while written in, and goes back if it's cleared.
    const title = await thread.locator(".sb-card-title").innerText();
    await thread.hover();
    await thread.getByRole("button", { name: "Settle", exact: true }).click();
    await expect(thread).toHaveCount(0);
    const shelf = page.locator(".sb-shelf-toggle", { hasText: "Settled" });
    if ((await shelf.getAttribute("aria-expanded")) !== "true")
      await shelf.click();
    const shelved = page.locator(".sb-shelf-list .sb-compact", {
      hasText: title,
    });
    await shelved.click();
    await prompt.fill("Second thoughts");
    await expect(thread).toHaveClass(/draft/);
    await expect(shelved).toHaveCount(0);
    await prompt.fill("");
    await expect(thread).toHaveCount(0);
    await expect(shelved).toBeVisible();

    // With nothing written, new threads don't pile up slots.
    await newThread();
    await newThread();
    const slots = await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) =>
          /^composer-settings:new:[^:]+:/.test(key),
        ).length,
    );
    expect(slots).toBeLessThanOrEqual(1);

    // A screenshot alone makes a draft, and it is still one after a reload.
    const paste = async (element: HTMLElement) => {
      const canvas = new OffscreenCanvas(200, 120);
      canvas.getContext("2d")!.fillRect(0, 0, 200, 120);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const clipboard = new DataTransfer();
      clipboard.items.add(new File([blob], "shot.png", { type: "image/png" }));
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
    };
    await prompt.evaluate(paste);
    await expect(prompt).toHaveText("");
    await expect(card("Screenshot")).toHaveClass(/selected/);
    await page.reload();
    await expect(card("Screenshot")).toBeVisible();

    // One whose pill was deleted is only kept for undo, and makes no draft.
    await newThread();
    await prompt.fill("Look at this ");
    await prompt.evaluate(paste);
    await expect(prompt.locator("[data-n]")).toHaveCount(1);
    await expect(drafts).toHaveCount(2);
    await prompt.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await prompt.press("Backspace");
    await expect(prompt).toHaveText("");
    await expect(drafts).toHaveCount(1);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
