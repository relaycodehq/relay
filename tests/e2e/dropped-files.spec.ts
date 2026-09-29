import { screenshot } from "../fixtures/screenshot";
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
import { fakeCli, pathWith } from "../fixtures/fake-cli";

/**
 * Drops files from disk on the composer. A File built in the page has no path
 * behind it, so they come through a file input, as Finder's would.
 */
async function drop(page: Page, paths: string[]) {
  const picker = page.locator("#relay-test-drop");
  if (!(await picker.count()))
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.id = "relay-test-drop";
      input.hidden = true;
      document.body.append(input);
    });
  await picker.setInputFiles(paths);
  await page.evaluate(() => {
    const files = (
      document.getElementById("relay-test-drop") as HTMLInputElement
    ).files!;
    const transfer = new DataTransfer();
    for (const file of Array.from(files)) transfer.items.add(file);
    const target = document.querySelector(".composer-prompt-input")!;
    const box = target.getBoundingClientRect();
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: box.right - 4,
        clientY: box.bottom - 4,
      }),
    );
  });
}

test("tags a dropped or picked file from outside the project and sends its path", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-drop-")));
  const fixture = await fixtureServer();
  const bin = join(root, "bin"),
    repo = join(root, "web-store"),
    outside = join(root, "Downloads"),
    capture = join(root, "capture.jsonl");
  const report = join(outside, "Q3 report.pdf"),
    rows = join(outside, "rows.csv");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(bin);
    await fakeCli(
      join(bin, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    await mkdir(outside);
    await writeFile(report, "%PDF-1.4\n");
    await writeFile(rows, "id,total\n1,42\n");
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
        ...pathWith(env, bin),
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
      .first()
      .click();
    const input = page.getByLabel("Message project");
    await input.click();
    await input.pressSequentially("Compare");
    await drop(page, [report]);
    // The paperclip takes any file too, and puts it at the caret.
    await page
      .locator(".project-composer input[type=file]")
      .setInputFiles([rows]);
    const tags = input.locator(".composer-file-chip");
    await expect(tags).toHaveText(["Q3 report.pdf", "rows.csv"]);
    await expect(tags.first()).toHaveAttribute("title", report);
    await expect(input).toHaveText("Compare Q3 report.pdf rows.csv ");
    await expect(page.getByLabel("Attachments")).toHaveCount(0);
    await page.reload();
    await expect(tags).toHaveText(["Q3 report.pdf", "rows.csv"]);
    await screenshot(page.locator(".project-composer"), {
      path: "test-results/dropped-files-composer.png",
    });
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    const prompts = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((c) => c.turn)
      .map((c) => c.turn.input[0].text as string)
      .filter((text) => !text.startsWith("Generate a short title"));
    expect(prompts.at(-1)).toContain(
      `My request: Compare \`${report}\` \`${rows}\``,
    );
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
