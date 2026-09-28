import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
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
import { fixtureServer } from "../fixtures/gitea";

const trace = [
  "TypeError: Cannot read properties of undefined (reading 'map')",
  ...Array.from(
    { length: 239 },
    (_, i) =>
      `    at renderRow (src/components/Table.tsx:${40 + i}:17) frame ${i}`,
  ),
].join("\n");

function paste(page: Page, text: string) {
  return page.getByLabel("Message project").evaluate((element, text) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    );
  }, text);
}

test("keeps a long paste as a pill in the message and sends it to the agent", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-paste-")));
  const fixture = await fixtureServer();
  const bin = join(root, "bin"),
    repo = join(root, "web-store"),
    capture = join(root, "capture.jsonl");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, "codex"),
      `#!${process.execPath}\n` +
        (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
      { mode: 0o700 },
    );
    await mkdir(repo);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    await writeFile(join(repo, "README.md"), "# Fixture project\n");
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
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        PATH: bin + ":" + env.PATH,
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_AGENT_CAPTURE: capture,
      },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();
    await page
      .locator(".sb-project-row")
      .getByRole("button", { name: "Web Store", exact: true })
      .click();
    const input = page.getByLabel("Message project");
    await input.click();
    await input.pressSequentially("Why does the table crash? ");
    // A short paste stays in the message.
    await paste(page, "inline bit");
    await expect(input).toHaveText("Why does the table crash? inline bit");
    await paste(page, trace);
    const card = page.getByRole("button", {
      name: "Show Pasted text #1, 240 lines",
    });
    await expect(card).toBeVisible();
    await expect(input).toContainText("Why does the table crash? inline bit");
    await expect(input.locator(".paste-pill")).toHaveCount(1);
    await paste(page, "\r\n" + trace.replaceAll("\n", "\r\n") + "\r\n");
    await expect(
      page.getByRole("button", { name: "Show Pasted text #2, 240 lines" }),
    ).toBeVisible();
    // The pill in the editor and its card both offer removal; use the card.
    await page
      .getByLabel("Attachments")
      .getByRole("button", { name: "Remove Pasted text #2" })
      .click();
    await page.reload();
    await expect(card).toBeVisible();
    await expect(input).toContainText("Why does the table crash? inline bit");
    await expect(input.locator(".paste-pill")).toHaveCount(1);
    await page
      .locator(".project-composer")
      .screenshot({ path: "test-results/pasted-text-composer.png" });
    for (const mode of ["dark", "light"]) {
      await page.evaluate((mode) => localStorage.setItem("theme", mode), mode);
      await page.reload();
      await expect(card).toBeVisible();
      if (mode === "dark")
        await page
          .locator(".project-composer")
          .screenshot({ path: "test-results/pasted-text-composer-dark.png" });
    }
    await card.click();
    const dialog = page.getByRole("dialog", { name: "Pasted text #1" });
    await expect(dialog).toContainText("240 lines");
    await expect(dialog.locator("pre")).toHaveText(trace);
    await page.screenshot({ path: "test-results/pasted-text-dialog.png" });
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    const sent = page.locator(".project-message.user").last();
    await expect(sent).toContainText("Why does the table crash? inline bit");
    // The paste shows as a pill where it went; its text waits behind it.
    await expect(sent).not.toContainText("frame 5");
    const pill = sent.getByRole("button", {
      name: "Show Pasted text #1, 240 lines",
    });
    await expect(pill).toBeVisible();
    await pill.click();
    const shown = page.getByRole("dialog", { name: "Pasted text #1" });
    await expect(shown.locator("pre")).toHaveText(trace);
    await shown.getByRole("button", { name: "Close dialog" }).click();
    await expect(page.getByLabel("Attachments")).toHaveCount(0);
    await page.screenshot({ path: "test-results/pasted-text-thread.png" });
    const prompts = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((c) => c.turn)
      .map((c) => c.turn.input[0].text as string)
      .filter((text) => !text.startsWith("Generate a short title"));
    expect(prompts.at(-1)).toContain(
      "My request: Why does the table crash? inline bit\n\nPasted text #1:\n\n```\n" +
        trace +
        "\n```",
    );
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
