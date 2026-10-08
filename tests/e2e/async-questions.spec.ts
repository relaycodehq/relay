import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("async Codex questions allow explicit choices and free text during and after a turn", async ({}, testInfo) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-async-questions-")),
  );
  const repo = join(root, "app"),
    bin = join(root, "bin"),
    capture = join(root, "capture.jsonl");
  await mkdir(repo);
  await mkdir(bin);
  await writeFile(join(repo, "notes.md"), "Notes\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
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
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    const composer = page.getByLabel("Message project");
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    const card = page.getByRole("region", { name: "Codex has a question" });
    await composer.fill("fixture async question live");
    await send.click();
    await expect(card).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();
    await card
      .getByRole("button", { name: "Private while preparing", exact: true })
      .click();
    // A choice doesn't submit itself or leave the question.
    await expect(
      card.getByText("Which visibility should I use?", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Next", exact: true }),
    ).toBeEnabled();
    await composer.fill("1");
    await expect(composer).toHaveText("1");
    await expect(card).toBeVisible();
    await composer.fill("");
    await page.screenshot({
      path: testInfo.outputPath("async-question-live.png"),
    });
    await card.getByRole("button", { name: "Next", exact: true }).click();
    await card.getByLabel("Which account should own it?").fill("fixture-owner");
    await card
      .getByRole("button", { name: "Send answer", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await expect(
      page.getByText("Answered questions", { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    const calls = (await readFile(capture, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(
      calls.some((call) => call.steer?.input[0].text.includes("fixture-owner")),
    ).toBe(true);
    expect(calls.some((call) => call.interrupt)).toBe(false);

    await composer.fill("fixture async question finished");
    await send.click();
    await expect(card).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    // Reload once the turn ended: the question comes from saved messages.
    await page.reload();
    await expect(card).toBeVisible();
    await card
      .getByLabel("Which visibility should I use?")
      .fill("Internal preview");
    await card.getByRole("button", { name: "Next", exact: true }).click();
    await card.getByLabel("Which account should own it?").fill("another-owner");
    await card
      .getByRole("button", { name: "Send answer", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await expect(
      page.getByText("Answered questions", { exact: true }),
    ).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    const updated = (await readFile(capture, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(
      updated.some(
        (call) => call.features?.send_message_to_user_async === true,
      ),
    ).toBe(true);
    expect(
      updated.some((call) =>
        call.turn?.input.some(
          (i: { text?: string }) =>
            i.text?.startsWith("My request: Answer to your questions:") &&
            i.text.includes("Internal preview"),
        ),
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("async-question-answered.png"),
    });
  } finally {
    await app.close();
  }
});
