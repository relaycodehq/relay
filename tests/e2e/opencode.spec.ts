import { screenshot } from "../fixtures/screenshot";
import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

/** Relay with fake Codex, Claude and OpenCode on PATH, and a Git project added. */
async function launchWithOpenCode() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-opencode-")));
  const bin = join(root, "bin"),
    capture = join(root, "opencode.jsonl");
  await mkdir(bin);
  const agent = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["codex", "claude"]) await fakeCli(join(bin, name), agent);
  await fakeCli(
    join(bin, "opencode"),
    await readFile(resolve("tests/fixtures/opencode-server.cjs"), "utf8"),
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
      RELAY_OPENCODE_CAPTURE: capture,
    },
  });
  const page = await app.firstWindow();
  const repo = join(root, "notes");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "README.md"), "# Notes\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "Initial",
  ]);
  await app.evaluate(({ dialog }, repo) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [repo],
    });
  }, repo);
  await page.evaluate(async () => {
    await window.relay.addProject();
  });
  return { app, page, root, capture };
}

test("talks to OpenCode from the composer: picks its model, answers its ask, keeps the thread", async () => {
  test.setTimeout(90000);
  const { app, page, root, capture } = await launchWithOpenCode();
  try {
    await page.reload();
    await page
      .getByRole("button", { name: "Choose model and provider" })
      .click();
    await page
      .getByRole("toolbar", { name: "Model providers" })
      .getByRole("button", { name: "OpenCode", exact: true })
      .click();
    const pickle = page.getByRole("option", { name: "Pickle" });
    await expect(pickle).toBeVisible();
    await screenshot(page, { path: "test-results/opencode-picker.png" });
    await pickle.click();
    await expect(
      page.getByRole("button", { name: "Choose model and provider" }),
    ).toHaveText(/Pickle/);
    // OpenCode lists the model's variants as reasoning efforts.
    await page
      .getByRole("combobox", { name: "Reasoning effort", exact: true })
      .click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Runtime mode", exact: true })
      .click();
    await page.getByRole("option", { name: /Supervised/ }).click();

    await page.getByLabel("Message project").fill("Write notes.md");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const approval = page.getByRole("region", {
      name: "Allow these file changes?",
    });
    await expect(approval).toBeVisible();
    await expect(approval).toContainText("+hello");
    await screenshot(page, { path: "test-results/opencode-approval.png" });
    await approval.getByRole("button", { name: "Once", exact: true }).click();
    await expect(page.getByText("Wrote notes.md.")).toBeVisible();
    const answer = page.getByRole("article", { name: "opencode answer" });
    await expect(answer.locator("header strong")).toHaveText("OpenCode");
    // OpenCode names the thread itself, from the request alone.
    await expect(
      page.getByRole("button", { name: /^Notes file/ }).first(),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/opencode-answer.png" });

    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const prompts = calls.filter((c) => c.path.endsWith("/prompt_async"));
    const titling = prompts.filter((c) =>
      c.body.parts[0].text.startsWith("Generate a short title"),
    );
    expect(titling).toHaveLength(1);
    expect(titling[0].directory).toMatch(/relay-helper-/);
    expect(titling[0].body.parts[0].text).toContain("Write notes.md");
    expect(titling[0].body.parts[0].text).not.toContain('"answer"');
    expect(prompts.find((c) => !titling.includes(c))?.body).toMatchObject({
      model: { providerID: "zen", modelID: "pickle" },
      variant: "high",
    });
    expect(calls.find((c) => c.path.startsWith("/permission/"))?.body).toEqual({
      reply: "once",
    });

    // The thread remembers its agent and model after a reload.
    await page.reload();
    await expect(page.getByText("Wrote notes.md.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose model and provider" }),
    ).toHaveText(/Pickle/);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("refreshing OpenCode's models restarts it, once the user agrees to interrupt its running thread, which carries on after", async () => {
  test.setTimeout(90000);
  const { app, page, root, capture } = await launchWithOpenCode();
  try {
    await page.reload();
    const picker = page.getByRole("button", {
      name: "Choose model and provider",
    });
    const openOpenCode = async () => {
      await picker.click();
      await page
        .getByRole("toolbar", { name: "Model providers" })
        .getByRole("button", { name: "OpenCode", exact: true })
        .click();
    };
    await openOpenCode();
    await page.getByRole("option", { name: "Pickle" }).click();
    await page
      .getByRole("combobox", { name: "Runtime mode", exact: true })
      .click();
    await page.getByRole("option", { name: /Supervised/ }).click();
    await page.getByLabel("Message project").fill("Write notes.md");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    // Waiting on its approval, the turn is still running.
    const approval = page.getByRole("region", {
      name: "Allow these file changes?",
    });
    await expect(approval).toBeVisible();

    await openOpenCode();
    await expect(page.getByRole("option", { name: "Wonder" })).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh models" }).click();
    // The thread waiting on its approval is the one a restart would stop.
    await expect(
      page.getByRole("alert").filter({ hasText: /^Interrupts / }),
    ).toBeVisible();
    await screenshot(page, {
      path: "test-results/opencode-reload-confirm.png",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(approval).toBeVisible();

    await page.getByRole("button", { name: "Refresh models" }).click();
    await page.getByRole("button", { name: "Stop and restart" }).click();
    await expect(page.getByRole("option", { name: "Wonder" })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "1 new model" }),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/opencode-reload-done.png" });
    await page.keyboard.press("Escape");
    // The restarted server hears the thread carry on, and asks again.
    await expect
      .poll(async () =>
        (await readFile(capture, "utf8"))
          .split("\n")
          .some(
            (line) =>
              line.includes("/prompt_async") &&
              line.includes(
                "Continue from where the previous response was stopped",
              ),
          ),
      )
      .toBe(true);
    await expect(approval).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
