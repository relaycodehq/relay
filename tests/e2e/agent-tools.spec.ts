import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("inspects real agent configuration in Settings and refreshes without exposing secrets", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-tools-e2e-")),
  );
  const folder = join(root, "project");
  const bin = join(root, "bin");
  const claude = join(root, "claude");
  const state = join(root, "tools.json");
  const log = join(root, "requests.log");
  await Promise.all([mkdir(folder), mkdir(bin), mkdir(claude)]);
  await mkdir(join(folder, ".claude/skills/claude-review"), {
    recursive: true,
  });
  await writeFile(
    join(folder, ".claude/skills/claude-review/SKILL.md"),
    "---\ndescription: Review with Claude\n---\nReview",
  );
  await writeFile(
    join(claude, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        "claude-docs": {
          type: "http",
          url: "https://docs.example/SECRET",
          headers: { Authorization: "SECRET" },
        },
      },
    }),
  );
  await writeFile(state, JSON.stringify({ enabled: false }));
  await fakeCli(
    join(bin, "codex"),
    `
const fs=require('node:fs');const path=require('node:path');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id==null)return;
 fs.appendFileSync(process.env.RELAY_TEST_TOOLS_LOG,m.method+'\\n');
 let result={};const cwd=m.params.cwd||m.params.cwds?.[0]||process.cwd();
 if(m.method==='skills/list')result={data:[{cwd,skills:[
  {name:'review',description:'Review this branch',path:path.join(cwd,'review/SKILL.md'),scope:'repo',enabled:true},
  {name:'release',description:'Prepare a release',path:path.join(cwd,'release/SKILL.md'),scope:'repo',enabled:JSON.parse(fs.readFileSync(process.env.RELAY_TEST_TOOLS_STATE,'utf8')).enabled}
 ]}]};
 if(m.method==='config/read')result={config:{mcp_servers:{docs:{url:'https://user:SECRET@docs.example/SECRET?token=SECRET',http_headers:{Authorization:'SECRET'}}}},origins:{'mcp_servers.docs.url':{name:{type:'user',file:path.join(process.env.CODEX_HOME,'config.toml')}}}};
 if(m.method==='account/read')result={account:null,requiresOpenaiAuth:false};
 if(m.method==='model/list')result={data:[],nextCursor:null};
 console.log(JSON.stringify({id:m.id,result}));
});`,
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
      CODEX_HOME: join(root, "codex"),
      CLAUDE_CONFIG_DIR: claude,
      RELAY_TEST_TOOLS_STATE: state,
      RELAY_TEST_TOOLS_LOG: log,
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, folder);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Agent tools", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "AI & agents / Agent tools" }),
    ).toBeVisible();
    const release = page
      .locator(".agent-tool-item")
      .filter({ hasText: "release" });
    await expect(release.locator(".agent-tool-status")).toHaveText("Disabled");
    await release.locator("summary").click();
    await expect(release.locator(".agent-tool-details")).toContainText(
      "Disabled in the agent's configuration",
    );
    await page
      .getByLabel("Tool status", { exact: true })
      .selectOption("disabled");
    await expect(page.locator(".agent-tool-item")).toHaveCount(1);
    await writeFile(state, JSON.stringify({ enabled: true }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No matching tools" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page
      .getByRole("button", { name: "MCP servers (2)", exact: true })
      .click();
    await page
      .locator(".agent-tool-item summary")
      .filter({ hasText: "docs" })
      .click();
    await expect(
      page.getByText("https://docs.example", { exact: true }),
    ).toBeVisible();
    const payload = await page.evaluate(async () =>
      window.relay.agentTools((await window.relay.projects())[0].id, "codex"),
    );
    expect(JSON.stringify(payload)).not.toContain("SECRET");
    await page.screenshot({
      path: join(tmpdir(), "relay-agent-tools-electron.png"),
    });
    await page.getByLabel("Tools agent").selectOption("claude");
    await expect(
      page.locator(".agent-tool-item").filter({ hasText: "claude-docs" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skills (1)", exact: true }).click();
    await expect(
      page.getByText("claude-review", { exact: true }),
    ).toBeVisible();
    const methods = (await readFile(log, "utf8")).split("\n");
    expect(methods).not.toContain("thread/start");
    expect(methods).not.toContain("thread/resume");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
