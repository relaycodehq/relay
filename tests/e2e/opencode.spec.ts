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
import { openCodeAuthFixture } from "../fixtures/opencode-auth";

/**
 * Relay with fake Codex, Claude and OpenCode on PATH, and a Git project added.
 * OpenCode 1 is a fake `opencode serve`; OpenCode 2 a fake ACP server playing
 * `acp`, the scenario tests/fixtures/acp-agent.cjs reads.
 */
async function launchWithOpenCode(acp?: Record<string, unknown>) {
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
    await readFile(
      resolve(
        acp
          ? "tests/fixtures/acp-agent.cjs"
          : "tests/fixtures/opencode-server.cjs",
      ),
      "utf8",
    ),
    acp ? "opencode v2.0.28" : "1.19.0",
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
      ...(acp && {
        RELAY_ACP_SCENARIO: JSON.stringify(acp),
        RELAY_ACP_LOG: capture,
      }),
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

test("talks to OpenCode 2 over ACP: picks its model and effort, resets to Default, keeps the thread", async () => {
  test.setTimeout(90000);
  const select = (
    id: string,
    currentValue: string,
    options: [string, string][],
  ) => ({
    id,
    name: id,
    category: id,
    type: "select",
    currentValue,
    options: options.map(([value, name]) => ({ value, name })),
  });
  const { app, page, root, capture } = await launchWithOpenCode({
    configOptions: [
      // Named as OpenCode 2 names them, its provider first.
      select("model", "opencode/big-pickle", [
        ["opencode/big-pickle", "opencode/Big Pickle"],
        ["opencode/wonder", "opencode/Wonder"],
        [
          "openrouter/~anthropic/claude-opus-latest",
          "openrouter/Claude Opus Latest",
        ],
      ]),
      {
        ...select("effort", "default", [
          ["low", "Low"],
          ["medium", "Medium"],
          ["high", "High"],
          ["default", "Default"],
        ]),
        category: "thought_level",
      },
      select("mode", "build", [
        ["build", "Build"],
        ["plan", "Plan"],
      ]),
    ],
    turn: [
      {
        ask: {
          toolCall: {
            toolCallId: "t1",
            title: "Write notes.md",
            kind: "edit",
            status: "pending",
            content: [
              { type: "diff", path: "notes.md", oldText: "", newText: "hello" },
            ],
          },
          options: [
            { optionId: "yes", name: "Allow", kind: "allow_once" },
            { optionId: "always", name: "Always", kind: "allow_always" },
            { optionId: "no", name: "Reject", kind: "reject_once" },
          ],
        },
      },
      {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Wrote notes.md." },
        },
      },
    ],
  });
  try {
    await page.reload();
    await page
      .getByRole("button", { name: "Choose model and provider" })
      .click();
    await page
      .getByRole("toolbar", { name: "Model providers" })
      .getByRole("button", { name: "OpenCode", exact: true })
      .click();
    await expect(
      page
        .getByRole("navigation", { name: "OpenCode providers" })
        .getByRole("button"),
    ).toHaveText([/^All/, /^OpenCode Zen/, /^OpenRouter/]);
    const wonder = page.getByRole("option", { name: "Wonder", exact: true });
    await expect(wonder).toBeVisible();
    await wonder.click();
    const effort = page.getByRole("combobox", {
      name: "Reasoning effort",
      exact: true,
    });
    await effort.click();
    await expect(
      page.getByRole("option", { name: "Default", exact: true }),
    ).toHaveCount(1);
    await screenshot(page, {
      path: join(tmpdir(), "relay-opencode2-effort-picker.png"),
    });
    await page.getByRole("option", { name: "High", exact: true }).click();
    await expect(effort).toHaveText("High");
    await page
      .getByRole("combobox", { name: "Runtime mode", exact: true })
      .click();
    await page.getByRole("option", { name: /Supervised/ }).click();

    await page.getByLabel("Message project").fill("Write notes.md");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const approval = page.getByRole("region", { name: "Write notes.md" });
    await expect(approval).toBeVisible();
    await screenshot(page, { path: "test-results/opencode2-approval.png" });
    await approval.getByRole("button", { name: "Once", exact: true }).click();
    await expect(page.getByText("Wrote notes.md.")).toBeVisible();
    const answer = page.getByRole("article", { name: "opencode answer" });
    await expect(answer.locator("header strong")).toHaveText("OpenCode");

    const sent = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    // Picked by Relay, not the HTTP server OpenCode 1 runs.
    const set = sent
      .filter((m) => m.method === "session/set_config_option")
      .map((m) => [m.params.configId, m.params.value]);
    expect(set).toContainEqual(["model", "opencode/wonder"]);
    expect(set).toContainEqual(["effort", "high"]);
    const effortSession = sent.find((m) =>
      m.method === "session/set_config_option" &&
      m.params.configId === "effort" && m.params.value === "high",
    )!.params.sessionId;
    expect(sent.some((m) => m.method === "session/prompt")).toBe(true);
    // The ask the user answered; a helper's own asks are always turned down.
    expect(
      sent.filter((m) => m.result?.outcome).map((m) => m.result.outcome),
    ).toContainEqual({ outcome: "selected", optionId: "yes" });

    await page.reload();
    await expect(page.getByText("Wrote notes.md.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose model and provider" }),
    ).toHaveText(/Wonder/);
    await expect(effort).toHaveText("High");
    await effort.click();
    await page.getByRole("option", { name: "Default", exact: true }).click();
    await page.getByLabel("Message project").fill("Write notes.md again");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await approval.getByRole("button", { name: "Once", exact: true }).click();
    await expect(page.getByText("Wrote notes.md.", { exact: true })).toHaveCount(2);
    const afterReset = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      afterReset
        // Each fixture process starts numbering sessions at s1; ignore earlier helpers.
        .slice(sent.length)
        .filter((m) =>
          m.method === "session/set_config_option" &&
          m.params.sessionId === effortSession && m.params.configId === "effort",
        )
        .map((m) => m.params.value),
    ).toEqual(["default"]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode 2 offers REA in the skill picker and sends its instructions over ACP", async () => {
  test.setTimeout(90000);
  const body =
    "REA sample instructions: inspect references/native.md before analysis.";
  const { app, page, root, capture } = await launchWithOpenCode({
    skills: [
      {
        id: "reverse-engineer-anything",
        name: "REA",
        description: "Reverse engineer applications (sample skill)",
        path: "/sample-skills/rea/SKILL.md",
        content: body,
        autoinvoke: false,
      },
    ],
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "opencode/big-pickle",
        options: [
          { value: "opencode/big-pickle", name: "opencode/Big Pickle" },
        ],
      },
    ],
    turn: [
      {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "REA skill received." },
        },
      },
    ],
  });
  try {
    await page.reload();
    await page
      .getByRole("button", { name: "Choose model and provider" })
      .click();
    await page
      .getByRole("toolbar", { name: "Model providers" })
      .getByRole("button", { name: "OpenCode", exact: true })
      .click();
    await page.getByRole("option", { name: "Big Pickle", exact: true }).click();
    const input = page.getByLabel("Message project");
    await input.fill("$REA");
    const skill = page.getByRole("option", {
      name: /REA.*Reverse engineer applications/,
    });
    await expect(skill).toBeVisible();
    await screenshot(page, {
      path: join(tmpdir(), "relay-opencode2-skills-picker.png"),
    });
    await skill.click();
    await expect(input).toContainText("REA");
    await input.press("End");
    await page.keyboard.type(" Inspect this application.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText("REA skill received.")).toBeVisible();
    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const blocks = calls
      .filter((m) => m.method === "session/prompt")
      .flatMap((m) => m.params.prompt);
    expect(blocks).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining(body),
        annotations: { audience: ["assistant"] },
      }),
    );
    expect(
      blocks.some((block) =>
        block.text?.includes(
          "Base directory for this skill: /sample-skills/rea",
        ),
      ),
    ).toBe(true);
    const catalog = calls.find((m) => m.api);
    expect(
      new URL(catalog.api[2], "http://localhost").searchParams.get(
        "location[directory]",
      ),
    ).toBe(join(root, "notes"));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode reconnects from the failed answer in Relay, recovers a paused browser check and resumes", async () => {
  test.setTimeout(120000);
  const authRoot = await realpath(
    await mkdtemp(join(tmpdir(), "relay-opencode-login-")),
  );
  const authFile = join(authRoot, "connected");
  const service = await openCodeAuthFixture(authFile);
  const { app, page, root, capture } = await launchWithOpenCode({
    serviceUrl: service.url,
    authFile,
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "opencode/deepseek-free",
        options: [
          { value: "opencode/deepseek-free", name: "opencode/DeepSeek Free" },
        ],
      },
    ],
    turn: [
      {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "DeepSeek resumed after sign-in." },
        },
      },
    ],
  });
  try {
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        (globalThis as any).openedOpenCodeUrl = url;
      };
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Choose model and provider" })
      .click();
    await page
      .getByRole("toolbar", { name: "Model providers" })
      .getByRole("button", { name: "OpenCode", exact: true })
      .click();
    await page
      .getByRole("option", { name: "DeepSeek Free", exact: true })
      .click();
    await page.getByLabel("Message project").fill("Explain this project.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("OpenCode's model provider needs you to sign in again.", {
        exact: false,
      }),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("button", { name: "Sign in to OpenCode", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Connect an OpenCode provider",
    });
    await expect(
      dialog.getByRole("combobox", { name: "Provider", exact: true }),
    ).toHaveValue("opencode");
    await expect(
      dialog.getByRole("combobox", { name: "Sign-in method", exact: true }),
    ).toHaveValue("device");
    await screenshot(dialog, {
      path: join(tmpdir(), "relay-opencode-sign-in-dialog.png"),
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");
    await screenshot(dialog, {
      path: join(tmpdir(), "relay-opencode-sign-in-dialog-dark.png"),
    });
    await dialog.getByRole("button", { name: "Continue in browser" }).click();
    await expect(
      dialog.getByText("Sample sign-in: enter SAMPLE-123 in your browser."),
    ).toBeVisible();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).openedOpenCodeUrl))
      .toContain("https://example.invalid/authorize");
    service.controls.failure = 503;
    await expect(
      dialog.getByRole("button", { name: "Check again" }),
    ).toBeVisible();
    await expect(dialog).toContainText("HTTP 503");
    service.controls.failure = 0;
    await service.complete();
    await dialog.getByRole("button", { name: "Check again" }).click();
    await expect(
      dialog.getByText(
        "Connected to OpenCode Console. Resume the answer when you’re ready.",
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Terminal", exact: true }),
    ).toBeHidden();
    await page
      .getByRole("button", { name: "Resume answer", exact: true })
      .click();
    await expect(
      page.getByText("DeepSeek resumed after sign-in."),
    ).toBeVisible();
    expect(
      service.calls.some(
        (c) => c.body?.answer?.server === "https://example.invalid/console",
      ),
    ).toBe(true);
    expect(
      service.calls.filter(
        (c) => c.method === "POST" && c.path.endsWith("/connect/oauth"),
      ),
    ).toHaveLength(1);
    const sent = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      sent.filter((m) => m.method === "session/prompt").length,
    ).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(sent)).not.toContain("auth login");

    // The same connection form is available before a turn fails, in Settings.
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.getByRole("option", { name: /^OpenCode/ }).click();
    await page.getByRole("button", { name: "Connect provider…" }).click();
    await dialog
      .getByRole("combobox", { name: "Provider", exact: true })
      .selectOption("openrouter");
    await dialog
      .getByLabel("API key", { exact: true })
      .fill("sample-openrouter-key");
    await dialog.getByRole("button", { name: "Save connection" }).click();
    await expect(dialog).toContainText("Connected to OpenRouter.");
    expect(
      service.calls.some(
        (c) =>
          c.path.endsWith("/openrouter/connect/key") &&
          c.body.key === "sample-openrouter-key",
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();

    // Closing a pending browser flow cancels that attempt without deleting accounts.
    await page.getByRole("button", { name: "Connect provider…" }).click();
    await dialog.getByRole("button", { name: "Continue in browser" }).click();
    await expect(dialog).toContainText("SAMPLE-123");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect
      .poll(
        () =>
          [...service.attempts.values()].filter((s) => s === "pending").length,
      )
      .toBe(0);
    expect(
      service.calls
        .filter((c) => c.method === "DELETE")
        .every((c) => c.path.includes("/connect/oauth/")),
    ).toBe(true);
  } finally {
    await app.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
    await rm(authRoot, { recursive: true, force: true });
  }
});
