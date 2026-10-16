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

test("async Codex questions allow explicit choices and free text during and after a turn", async () => {
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
      RELAY_FIXTURE_STEER_DELAY: "3000",
      RELAY_AGENT_TURN_MS: "1500",
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
    const card = page.getByRole("region", {
      name: "Codex has questions",
      exact: true,
    });
    const answered = page.locator(".async-question-cards .answered-questions");
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
    // Dismissing is local to the saved question; Codex keeps working.
    await card.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(
      page.getByText("Dismissed questions", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    const beforeReopen = (await readFile(capture, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(beforeReopen.some((call) => call.steer || call.interrupt)).toBe(
      false,
    );
    await page.screenshot({
      path: join(root, "async-question-dismissed-live.png"),
    });
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("button", {
        name: "Private while preparing",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: join(root, "async-question-live.png"),
    });
    await card.getByRole("button", { name: "Next", exact: true }).click();
    await card.getByLabel("Which account should own it?").fill("fixture-owner");
    await card.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(card.getByLabel("Which account should own it?")).toHaveValue(
      "fixture-owner",
    );
    await card
      .getByRole("button", { name: "Send answer", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await expect(
      answered.locator("summary").filter({ hasText: "Asked you 2 questions" }),
    ).toHaveCount(1);
    await expect(answered).toHaveAttribute("open", "");
    await expect(
      page
        .locator(".project-message.user")
        .getByText("Answer to your questions:", { exact: false }),
    ).toHaveCount(0);
    await expect(answered).toContainText("Which visibility should I use?");
    await expect(answered.locator(".answered-question-answer")).toHaveText([
      "Private while preparing",
      "fixture-owner",
    ]);
    const awaiting = page.getByRole("status").filter({
      hasText: "Sent · awaiting Codex",
    });
    await expect(awaiting).toBeVisible();
    await expect(answered.getByRole("status")).toHaveText(
      "Sent · awaiting Codex",
    );
    await expect(awaiting.locator(".spinner")).toHaveCount(0);
    await page.screenshot({
      path: join(root, "async-question-awaiting.png"),
    });
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    await expect(awaiting).toHaveCount(0);
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
    await expect(
      page.getByText("Waiting for your answer", { exact: true }),
    ).toBeVisible();
    // Reload once the turn ended: the question comes from saved messages.
    await page.reload();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(card).toHaveCount(0);
    await expect(
      page.getByText("Dismissed questions", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
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
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".project-message.assistant > header:not([hidden])"),
    ).toHaveCount(2);
    await expect(page.locator(".agent-run-heading")).toHaveCount(2);
    await expect(
      page.locator(".project-message[data-response-continuation]"),
    ).toHaveCount(2);
    await expect(answered.last()).toContainText("another-owner");
    await page.screenshot({
      path: join(tmpdir(), "relay-question-continuous-working.png"),
    });
    await expect(
      answered.locator("summary").filter({ hasText: "Asked you 2 questions" }),
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
    for (const theme of ["dark", "light"]) {
      await page.evaluate((theme) => {
        const appearance = JSON.parse(
          localStorage.getItem("relay-appearance") ?? "{}",
        );
        localStorage.setItem(
          "relay-appearance",
          JSON.stringify({ ...appearance, mode: theme }),
        );
      }, theme);
      await page.reload();
      await expect(answered).toHaveCount(2);
      await expect(answered.last()).toHaveAttribute("open", "");
      await expect(
        answered.last().locator(".answered-question-answer"),
      ).toHaveText(["Internal preview", "another-owner"]);
      await expect(
        page
          .locator(".project-message.user")
          .getByText("Answer to your questions:", { exact: false }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("article", { name: "Your message", exact: true }),
      ).toHaveCount(2);
      await page.screenshot({
        path: join(tmpdir(), `relay-async-answered-${theme}.png`),
      });
    }
  } finally {
    await app.close();
  }
});
