import { screenshot } from "../fixtures/screenshot";
import { test, expect, _electron as electron } from "@playwright/test";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("runs Cursor from the composer through its SDK: picks its model, shows its work, lists it in Settings", async () => {
  test.setTimeout(90000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-cursor-")));
  const bin = join(root, "bin"),
    data = join(root, "data"),
    capture = join(root, "cursor.jsonl");
  // Where Relay keeps a downloaded SDK; this one is the fixture's stand-in.
  const pkg = join(data, "cursor-sdk/1.0.32/node_modules/@cursor/sdk");
  await mkdir(join(pkg, "dist/esm"), { recursive: true });
  await mkdir(bin);
  await copyFile(
    resolve("tests/fixtures/cursor-sdk.mjs"),
    join(pkg, "dist/esm/index.js"),
  );
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@cursor/sdk", version: "1.0.32", type: "module" }),
  );
  await writeFile(
    join(data, "cursor-sdk/current.json"),
    JSON.stringify({ version: "1.0.32" }),
  );
  const agent = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["codex", "claude"]) await fakeCli(join(bin, name), agent);
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
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      CURSOR_FAKE_LOG: capture,
    },
  });
  try {
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
    await page.reload();

    await page
      .getByRole("button", { name: "Choose model and provider" })
      .click();
    await page
      .getByRole("toolbar", { name: "Model providers" })
      .getByRole("button", { name: "Cursor", exact: true })
      .click();
    const composer = page.getByRole("option", { name: "Composer 2.5" });
    await expect(composer).toBeVisible();
    await screenshot(page, { path: "test-results/cursor-picker.png" });
    await composer.click();
    await expect(
      page.getByRole("button", { name: "Choose model and provider" }),
    ).toHaveText(/Composer 2\.5/);
    // The SDK names the model's reasoning settings; Relay shows them as effort.
    await page
      .getByRole("combobox", { name: "Reasoning effort", exact: true })
      .click();
    await page.getByRole("option", { name: "High", exact: true }).click();

    // Cursor can limit what an agent does but can't stop to ask, so its
    // approval modes say what they really do.
    await page
      .getByRole("combobox", { name: "Runtime mode", exact: true })
      .click();
    await expect(
      page.getByRole("option", { name: /Supervised/ }),
    ).toContainText("Cursor can't ask");
    await screenshot(page, { path: "test-results/cursor-modes.png" });
    await page.getByRole("option", { name: /Full access/ }).click();

    await page.getByLabel("Message project").fill("Look around [[tools]]");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const answer = page.getByRole("article", { name: "cursor answer" });
    await expect(answer).toContainText("Done.");
    await expect(answer.locator("header strong")).toHaveText("Cursor");
    await screenshot(page, { path: "test-results/cursor-answer.png" });

    const sent = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(sent[0].sendOptions).toEqual({
      model: {
        id: "composer-2.5",
        params: [{ id: "reasoning", value: "high" }],
      },
      mode: "agent",
    });

    // Naming the thread asks Cursor too, as a bare helper job: no tools, no
    // project settings, and the title's own instructions.
    await expect
      .poll(async () =>
        (await readFile(capture, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
          .find((call) => call.options.systemPrompt),
      )
      .toMatchObject({
        options: {
          tools: [],
          local: { sandboxOptions: { enabled: true } },
        },
      });

    // The thread remembers its agent and model after a reload.
    await page.reload();
    await expect(page.getByText("Done.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose model and provider" }),
    ).toHaveText(/Composer 2\.5/);

    // Settings lists the SDK Relay downloaded and who is signed in.
    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings.getByRole("button", { name: "AI models" }).click();
    await settings.getByRole("button", { name: "Check now" }).click();
    await expect(settings).toContainText(
      /Version 1\.0\.32 · downloaded by Relay/,
    );
    await expect(settings).toContainText("Signed in as dev@example.com");
    await expect(
      settings.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/cursor-settings.png" });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
