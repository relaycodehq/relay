import { test, expect, _electron as electron } from "@playwright/test";
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
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
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
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
