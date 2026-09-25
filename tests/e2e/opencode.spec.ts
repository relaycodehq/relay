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

test("talks to OpenCode from the composer: picks its model, answers its ask, keeps the thread", async () => {
  test.setTimeout(90000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-opencode-")));
  const bin = join(root, "bin"),
    capture = join(root, "opencode.jsonl");
  const app = await (async () => {
    await mkdir(bin);
    const agent =
      `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
    for (const name of ["codex", "claude"])
      await writeFile(join(bin, name), agent, { mode: 0o700 });
    await writeFile(
      join(bin, "opencode"),
      `#!${process.execPath}\n` +
        (await readFile(resolve("tests/fixtures/opencode-server.cjs"), "utf8")),
      { mode: 0o700 },
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    return electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        PATH: bin + ":" + env.PATH,
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_OPENCODE_CAPTURE: capture,
      },
    });
  })();
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
      .getByRole("button", { name: "OpenCode", exact: true })
      .click();
    const pickle = page.getByRole("option", { name: "Pickle" });
    await expect(pickle).toBeVisible();
    await page.screenshot({ path: "test-results/opencode-picker.png" });
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
    await page.screenshot({ path: "test-results/opencode-approval.png" });
    await approval
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(page.getByText("Wrote notes.md.")).toBeVisible();
    const answer = page.getByRole("article", { name: "opencode answer" });
    await expect(answer.locator("header strong")).toHaveText("OpenCode");
    // The thread is named after the request, not the agent mention.
    await expect(
      page.getByRole("button", { name: /^Write notes\.md/ }).first(),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/opencode-answer.png" });

    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      calls.find((c) => c.path.endsWith("/prompt_async"))?.body,
    ).toMatchObject({
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
