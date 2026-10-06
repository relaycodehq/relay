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
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

function repository(path: string) {
  execFileSync("git", ["init", "-q", "-b", "main", path]);
  execFileSync("git", [
    "-C",
    path,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
}

/** Has the thread's agent call one of Relay's tools, and resolves to its answer. */
async function callTool(page: Page, tool: string, input: unknown) {
  const answers = page.getByRole("article", { name: "codex answer" });
  const before = await answers.count();
  await page
    .getByLabel("Message project")
    .fill(`fixture relay ${tool} ${JSON.stringify(input)}`);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  return async () => {
    await expect(answers).toHaveCount(before + 1, { timeout: 15000 });
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0, { timeout: 15000 });
    return (await answers.last().locator(".markdown").innerText()).trim();
  };
}

test("an agent adds a project only through the user, then starts and messages threads there", async () => {
  test.setTimeout(120000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-agent-projects-")),
  );
  const bin = join(root, "bin"),
    lead = join(root, "lead-app"),
    site = join(root, "relay-site");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(bin);
    const script = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const name of ["codex", "claude"])
      await fakeCli(join(bin, name), script);
    for (const folder of [lead, site]) {
      await mkdir(folder);
      repository(folder);
      await writeFile(join(folder, "README.md"), "# Fixture\n");
    }
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
      },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, lead);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    // A fresh thread in full access: the tools come with its first session.
    await expect(
      page.getByRole("combobox", { name: "Runtime mode", exact: true }),
    ).toHaveText("Full access");

    const listed = JSON.parse(
      await (
        await callTool(page, "list_projects", {})
      )(),
    );
    expect(listed).toEqual([
      expect.objectContaining({ folder: lead, git: true, current: true }),
    ]);

    // Refused before anyone is asked.
    const home = await (
      await callTool(page, "add_project", { folder: homedir() })
    )();
    expect(home).toBe("That's the user's home folder.");
    await expect(
      page.getByRole("region", { name: /to Relay as a project/ }),
    ).toHaveCount(0);

    // Full access or not, adding a folder waits on the user, path first.
    const added = await callTool(page, "add_project", { folder: site });
    const card = page.getByRole("region", {
      name: "Add “relay-site” to Relay as a project?",
    });
    await expect(card).toBeVisible();
    await expect(card).toContainText(site);
    await expect(card).toContainText(
      "Agents in its threads can read and change everything in this folder.",
    );
    await expect(
      card.getByRole("button", { name: "Always", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Decline", exact: true }),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/agent-add-project.png" });
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    const project = JSON.parse(await added());
    expect(project).toMatchObject({ folder: site, git: true });
    await expect(
      page.getByRole("button", {
        name: `New thread in ${project.name}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 10000 });

    // Threads in another project ask too, though the lead has full access.
    const started = await callTool(page, "start_threads", {
      project: project.id,
      threads: [{ prompt: "fixture echo: Site thread done." }],
    });
    const start = page.getByRole("region", {
      name: `Start 1 thread in “${project.name}”?`,
    });
    await expect(start).toBeVisible();
    await expect(start).toContainText(`In ${site}, with full access`);
    // The prompt is part of what is approved, so it shows without scrolling.
    expect(
      await start
        .locator("pre")
        .evaluate((el) => el.scrollHeight <= el.clientHeight),
    ).toBe(true);
    await screenshot(page, { path: "test-results/agent-start-elsewhere.png" });
    await start.getByRole("button", { name: "Approve", exact: true }).click();
    const [child] = JSON.parse(await started());
    expect(child).toMatchObject({ project: project.name, worktree: true });

    // The first message there asks once; approving it lets the next one through.
    const sent = await callTool(page, "send_to_thread", {
      id: child.id,
      message: "fixture echo: Again.",
    });
    const send = page.getByRole("region", {
      name: new RegExp(`in “${project.name}”\\?$`),
    });
    await expect(send).toBeVisible({ timeout: 15000 });
    await expect(send).toContainText(
      "Approving once lets it message this thread",
    );
    await send.getByRole("button", { name: "Approve", exact: true }).click();
    expect(await sent()).toBe("Sent.");
    const again = await (
      await callTool(page, "send_to_thread", {
        id: child.id,
        message: "fixture echo: Once more.",
      })
    )();
    expect(again).toBe("Sent.");
    await expect(send).toHaveCount(0);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
