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
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("Antigravity asks fixed questions in full access, compacts, plans, and offers isolated accounts and quota groups", async () => {
  test.setTimeout(120000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-antigravity-e2e-")),
  );
  const data = join(root, "data"),
    bin = join(root, "bin"),
    repo = join(root, "project");
  const home = join(root, "gemini"),
    capture = join(root, "acp.jsonl");
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
  await writeFile(
    join(home, "antigravity-acp", "settings.json"),
    JSON.stringify({ auth: { type: "oauth-personal" } }),
  );
  await writeFile(
    join(home, "antigravity-acp", "acp_token.json"),
    JSON.stringify({
      client_id: "fixture",
      client_secret: "fixture",
      refresh_token: "fixture",
    }),
  );
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "README.md"), "# Fixture\n");
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
  const say = (text: string) => ({
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  });
  const scenario = {
    signedIn: true,
    signIn: "oauth-personal",
    saveGoogleLogin: true,
    resume: true,
    sessions: ["s1", "s2"],
    captureEnvKeys: ["GEMINI_HOME", "AGY_ACP_FORCE_FILE_STORAGE"],
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "gemini-fixture",
        options: [{ value: "gemini-fixture", name: "Gemini Fixture" }],
      },
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "default",
        options: ["default", "yolo"].map((value) => ({ value, name: value })),
      },
    ],
    turn: [
      {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "batch",
          title: "Running start_subagent",
          kind: "other",
          status: "in_progress",
        },
      },
      {
        ask: {
          toolCall: {
            toolCallId: "interaction_env",
            title: "Which environment?",
          },
          options: [
            { optionId: "dev", name: "Development", kind: "allow_once" },
            { optionId: "prod", name: "Production", kind: "allow_once" },
          ],
        },
      },
      {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "batch",
          status: "completed",
          rawOutput: "Batch submitted; individual child status unavailable.",
        },
      },
      say("Selected Production."),
    ],
    turnByPrefix: {
      "Summarize this conversation": [
        say(
          "The user selected Production. The next task is to design the API.",
        ),
      ],
      "[Compacted conversation]": [say("Ready to continue.")],
      "/plan": [
        {
          update: {
            sessionUpdate: "plan",
            entries: [{ content: "Inspect the API", status: "in_progress" }],
          },
        },
        say("Proposed plan: inspect the API, then implement it."),
      ],
    },
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
      RELAY_ACP_LOG: capture,
      RELAY_ACP_SCENARIO: JSON.stringify(scenario),
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ net }) => {
      net.fetch = async () => new Response(null, { status: 503 });
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token")
          return Response.json({ access_token: "fixture", expires_in: 3600 });
        if (url.endsWith(":retrieveUserQuotaSummary"))
          return Response.json({
            buckets: [
              {
                bucketId: "gemini-5h",
                window: "5h",
                remainingFraction: 0.7,
                resetTime: "2026-10-22T12:00:00Z",
              },
              {
                bucketId: "gemini-weekly",
                window: "weekly",
                remainingFraction: 0.4,
                resetTime: "2026-10-28T12:00:00Z",
              },
              {
                bucketId: "3p-5h",
                window: "5h",
                remainingFraction: 0.9,
                resetTime: "2026-10-22T12:00:00Z",
              },
              {
                bucketId: "3p-weekly",
                window: "weekly",
                remainingFraction: 0.6,
                resetTime: "2026-10-28T12:00:00Z",
              },
            ],
          });
        return new Response(null, { status: 503 });
      };
    });
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page
      .getByRole("button", { name: "Choose model and provider" })
      .click();
    await page
      .getByRole("toolbar", { name: "Model providers" })
      .getByRole("button", { name: "Antigravity", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Gemini Fixture", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Runtime mode", exact: true })
      .click();
    await page.getByRole("option", { name: /Full access/ }).click();
    await page.getByLabel("Message project").fill("Choose the target.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const question = page.getByRole("region", {
      name: "Antigravity has a question",
    });
    await expect(question).toBeVisible();
    await expect(question.locator("input")).toHaveCount(0);
    await expect(
      question.getByRole("button", { name: /Development/ }),
    ).toBeVisible();
    await screenshot(page, {
      path: join(tmpdir(), "relay-antigravity-question.png"),
    });
    await question.getByRole("button", { name: /Production/ }).click();
    await expect(
      page.getByText("Selected Production.", { exact: true }),
    ).toBeVisible();
    const ring = page.getByRole("button", { name: /^Antigravity usage:/ });
    await expect(ring).toBeVisible();
    await ring.click();
    await expect(page.getByText("Gemini · 5h", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Claude & GPT · Weekly", { exact: true }),
    ).toBeVisible();
    await screenshot(page, {
      path: join(tmpdir(), "relay-antigravity-quotas.png"),
    });
    await page.keyboard.press("Escape");

    await page.getByLabel("Message project").fill("/compact");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await readFile(capture, "utf8")).includes("[Compacted conversation]"),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Show what the context was compacted to" })
      .click();
    await expect(
      page.getByText(
        "The user selected Production. The next task is to design the API.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByLabel("Message project").fill("/plan on");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByLabel("Message project").fill("Design the API.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Proposed plan: inspect the API, then implement it.", {
        exact: true,
      }),
    ).toBeVisible();
    await screenshot(page, {
      path: join(tmpdir(), "relay-antigravity-plan.png"),
    });

    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "AI & agents", exact: true })
      .click();
    const agents = page.getByRole("region", { name: "Your agents" });
    await agents
      .getByRole("button", { name: "Check now", exact: true })
      .click();
    await agents.getByRole("option", { name: /^Antigravity/ }).click();
    await expect(agents.getByText("~/.gemini", { exact: true })).toBeVisible();
    await agents
      .getByRole("button", { name: "Add account", exact: true })
      .click();
    await agents
      .getByRole("textbox", { name: "Account name" })
      .fill("Work Google");
    await agents
      .getByRole("button", { name: "Sign in with Antigravity", exact: true })
      .click();
    const workRow = agents
      .locator(".accounts-row")
      .filter({ hasText: "Work Google" });
    await expect(workRow).toBeVisible();
    await expect(workRow.getByText("Signed out", { exact: true })).toHaveCount(
      0,
    );
    await workRow.getByText("Work Google", { exact: true }).click();
    await expect(agents.locator(".accounts-row[data-in-use]")).toContainText(
      "Work Google",
    );
    await screenshot(page, {
      path: join(tmpdir(), "relay-antigravity-accounts.png"),
    });
    await page.getByRole("button", { name: "Back to app" }).click();
    await page
      .getByRole("button", { name: "Choose model and provider" })
      .click();
    const tabs = page.getByRole("radiogroup", { name: "Antigravity account" });
    await tabs.getByRole("radio", { name: /Work Google/ }).click();
    await page.keyboard.press("Escape");
    const accounts = await page.evaluate(() => window.relay.agentAccounts());
    const work = accounts.accounts.find(
      (a) => a.provider === "antigravity" && a.label === "Work Google",
    )!;
    const project = await page.evaluate(
      async () => (await window.relay.projects())[0]!.id,
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (project) =>
            (await window.relay.projectChats(project))[0]?.accounts
              ?.antigravity,
          project,
        ),
      )
      .toBe(work.id);
    await page.getByLabel("Message project").fill("Verify the work account.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect
      .poll(async () => {
        const wire = (await readFile(capture, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        return wire.filter((m) => m.environment).at(-1)?.environment
          .GEMINI_HOME;
      })
      .toBe(join(data, "agent-accounts", "antigravity", work.id));
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    const sent = (await readFile(capture, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(sent.some((m) => m.result?.outcome?.optionId === "prod")).toBe(true);
  } catch (error) {
    const page = await app.firstWindow();
    await screenshot(page, {
      path: join(tmpdir(), "relay-antigravity-failure.png"),
    });
    await writeFile(
      join(tmpdir(), "relay-antigravity-failure.txt"),
      await page.locator("body").innerText(),
    );
    await writeFile(
      join(tmpdir(), "relay-antigravity-failure-wire.jsonl"),
      await readFile(capture, "utf8").catch(() => ""),
    );
    throw error;
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
