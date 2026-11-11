import { screenshot } from "../fixtures/screenshot";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("the model picker signs in an ACP agent whose models didn't list because it's signed out", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-acp-sign-in-")),
  );
  const data = join(root, "data"),
    bin = join(root, "bin"),
    repo = join(root, "project"),
    home = join(root, "gemini");
  await Promise.all([
    mkdir(bin),
    mkdir(repo),
    mkdir(join(data, "antigravity", "fixture"), { recursive: true }),
    mkdir(join(home, "antigravity-acp"), { recursive: true }),
  ]);
  const fallback = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["claude", "codex"])
    await fakeCli(join(bin, name), fallback);
  await writeFile(
    join(data, "antigravity", "fixture", "agent.cjs"),
    await readFile(resolve("tests/fixtures/acp-agent.cjs"), "utf8"),
  );
  await writeFile(
    join(data, "antigravity", "current.json"),
    JSON.stringify({
      version: "fixture",
      cmd: "agent.cjs",
      node: true,
      args: [],
    }),
  );
  // Chose Google sign-in once, but holds no login: signed out.
  await writeFile(
    join(home, "antigravity-acp", "settings.json"),
    JSON.stringify({ auth: { type: "oauth-personal" } }),
  );
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "README.md"), "# Fixture\n");
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
    "--allow-empty",
  ]);
  const scenario = {
    signIn: "oauth-personal",
    saveGoogleLogin: true,
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "gemini-fixture",
        options: [{ value: "gemini-fixture", name: "Gemini Fixture" }],
      },
    ],
  };
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_DEV_URL: "",
      RELAY_TEST_DATA: data,
      GEMINI_HOME: home,
      AGY_ACP_FORCE_FILE_STORAGE: "1",
      RELAY_ACP_SCENARIO: JSON.stringify(scenario),
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();

    const openAntigravity = async () => {
      await page
        .getByRole("button", { name: "Choose model and provider" })
        .click();
      await page
        .getByRole("toolbar", { name: "Model providers" })
        .getByRole("button", { name: "Antigravity", exact: true })
        .click();
    };
    await openAntigravity();
    await expect(
      page.getByRole("heading", { name: "Sign in to Antigravity" }),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/acp-sign-in-panel.png" });

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in to Antigravity" }),
    ).toBeHidden();

    await openAntigravity();
    await expect(
      page.getByRole("option", { name: "Gemini Fixture", exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
