import { screenshot } from "../fixtures/screenshot";
import { openSignIn, openInbox, openPull } from "../fixtures/navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
let app: ElectronApplication,
  page: Page,
  fixture: Awaited<ReturnType<typeof fixtureServer>>,
  dataDir: string,
  binDir: string,
  testEnv: Record<string, string>;
const screenshots = resolve("test-results/screenshots");
// The tests share one app and build on each other's state, so a failure
// stops the file instead of the rest failing on a fresh one.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
  fixture = await fixtureServer({ grouping: true });
  dataDir = await mkdtemp(join(tmpdir(), "relay-group-e2e-"));
  binDir = await mkdtemp(join(tmpdir(), "relay-group-cli-"));
  const script = `#!${process.execPath}
const fs=require('node:fs');
const path=require('node:path');
fs.writeFileSync(path.join(__dirname,'last-args'),JSON.stringify(process.argv.slice(2)));
let input='';
process.stdin.on('data',d=>input+=d);
process.stdin.on('end',()=>{
 const mode=fs.existsSync(path.join(__dirname,'mode'))?fs.readFileSync(path.join(__dirname,'mode'),'utf8'):'normal';
 fs.appendFileSync(path.join(__dirname,'calls'),'call\\n');
 const candidates=JSON.parse(input.split('\\n\\nChange evidence:\\n')[1]).candidates;
 const result={groups:[{pattern:'p1',name:'Constructor DI → inject()',description:'Replace constructor dependencies with fields.',rule:'Move constructor dependencies into fields and make the required imports; no other changes.'}],files:mode==='invalid'?[]:candidates.map(c=>{const grouped=['src/one.ts','src/two.ts'].includes(c.path)||(mode==='partial'&&c.path==='src/mixed.ts');return {path:c.path,pattern:grouped?'p1':'',decision:grouped?'group':'normal',reason:grouped?'Only the common transformation.':'Contains an unrelated behavior change.',coveredHunks:grouped&&!(mode==='partial'&&c.path==='src/mixed.ts')?Array.from({length:c.hunkCount},(_,i)=>i+1):[]}})};
 if(!result.files.some(f=>f.decision==='group'))result.groups=[];
 fs.appendFileSync(path.join(__dirname,'paths'),JSON.stringify(candidates.map(c=>c.path))+'\\n');
 setTimeout(()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1200,output_tokens:100}}));},mode==='delay'?20000:200);
});
`;
  await fakeCli(join(binDir, "codex"), script);
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pathWith(process.env as Record<string, string>, binDir),
    RELAY_TEST_DATA: dataDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  testEnv = env as Record<string, string>;
  app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: env as Record<string, string>,
  });
  page = await app.firstWindow();
  await openSignIn(page);
  await page
    .getByLabel("Gitea server", { exact: true })
    .fill(fixture.serverUrl);
  await page
    .getByLabel("Personal access token", { exact: true })
    .fill("test-token");
  await page.getByRole("button", { name: "Connect to Gitea" }).click();
  await openInbox(page);
  await openPull(page, /Make pull request reviews/);
});
test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
});

test("groups whole-file migrations, keeps mixed files normal and persists bulk review", async () => {
  await page.evaluate(async () => {
    const settings = await window.relay.aiSettings();
    await window.relay.saveAISettings({
      ...settings,
      grouping: { ...settings.grouping, reasoningEffort: "high" },
    });
  });
  await expect(page.locator("diffs-container")).toBeVisible();
  expect(fixture.requests.filter((r) => r.path.includes("/raw/"))).toHaveLength(
    2,
  );
  await page
    .getByRole("button", { name: "Group changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Constructor DI → inject() 2",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    JSON.parse(await readFile(join(binDir, "last-args"), "utf8")).filter(
      (arg: string) => arg.includes("model_reasoning_effort"),
    ),
  ).toEqual(['model_reasoning_effort="high"']);
  await expect(
    page.getByText("Individual changes · 2", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /mixed.ts/ })).toBeVisible();
  expect(
    await page.evaluate(
      async () =>
        (
          await window.relay.progress({
            owner: "Web",
            name: "web-store",
            number: 7,
          })
        ).read,
    ),
  ).toEqual({});
  await screenshot(page, { path: join(screenshots, "10-groups-light.png") });
  await page
    .getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "src/one.ts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /mixed.ts/ }),
  ).toHaveCount(0);
  await screenshot(page, { path: join(screenshots, "11-group-review.png") });
  await page
    .getByRole("button", { name: "Mark 2 files viewed", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Current file" }),
  ).toHaveValue("src/mixed.ts");
  await page.getByText("Why this file is individual", { exact: true }).click();
  await expect(page.locator(".triage-explanation")).toContainText(
    "Contains an unrelated behavior change.",
  );
  await expect(
    page.getByText("2 of 4 reviewed", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const s = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
      return Object.values(s.progress).map(
        (p: any) => Object.keys(p.read).length,
      )[0];
    })
    .toBe(2);
  expect(fixture.requests.some((r) => r.method !== "GET")).toBe(false);
  // The reload reopens the PR being reviewed.
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("2 of 4 reviewed", { exact: true }),
  ).toBeVisible();
  expect(
    (await readFile(join(binDir, "calls"), "utf8")).trim().split("\n"),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Show all files", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show groups", exact: true }).click();
  await page.getByRole("textbox", { name: "Filter files" }).fill("two.ts");
  await expect(page.getByRole("button", { name: /two.ts/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Filter files" }).fill("");
  await page
    .getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Mark group unviewed", exact: true })
    .click();
  await expect(
    page.getByText("0 of 4 reviewed", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Current file" })
    .selectOption("src/mixed.ts");
  await expect(page.locator("diffs-container")).toBeVisible();
  await screenshot(page, {
    path: join(screenshots, "12-groups-dark.png"),
    animations: "disabled",
  });
});
test("stale groups, cancellation and invalid model output never mark files", async () => {
  fixture.setHead("c".repeat(40));
  await page
    .getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Mark 2 files viewed", exact: true })
    .click();
  await expect(
    page.getByText(
      "This PR has new commits. Refresh before marking a group viewed.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh pull request", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Group changes", exact: true }),
  ).toBeVisible();
  await writeFile(join(binDir, "mode"), "delay");
  await page
    .getByRole("button", { name: "Group changes", exact: true })
    .click();
  await expect(
    page.getByText(/Discovering patterns · 0\/4 files/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause analysis", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume analysis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    }),
  ).toHaveCount(0);
  await writeFile(join(binDir, "mode"), "invalid");
  await page
    .getByRole("button", { name: "Resume analysis", exact: true })
    .click();
  await expect(page.getByText(/4 files need another attempt/)).toBeVisible();
  await page
    .getByText("Analysis incomplete for this file", { exact: true })
    .click();
  await expect(page.locator(".triage-explanation")).toContainText(
    "Codex returned incomplete or invalid decisions for this batch.",
  );
  await screenshot(page, {
    path: join(screenshots, "18-incomplete-analysis.png"),
    animations: "disabled",
  });

  await expect(
    page.getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      async () =>
        (
          await window.relay.progress({
            owner: "Web",
            name: "web-store",
            number: 7,
          })
        ).read,
    ),
  ).toEqual({});
});

test("resumes after a full restart and only retries unfinished files", async () => {
  await writeFile(join(binDir, "mode"), "partial");
  await page
    .getByRole("button", { name: "Resume analysis", exact: true })
    .click();
  await expect(page.getByText(/1 file needs another attempt/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    }),
  ).toBeVisible();
  const caches = await readdir(join(dataDir, "analysis"));
  const stored = JSON.parse(
    await readFile(
      join(
        dataDir,
        "analysis",
        caches.find((n) => n.endsWith(".json"))!,
      ),
      "utf8",
    ),
  );
  expect(stored.checkpoint).toBeTruthy();
  await app.close();
  await writeFile(join(binDir, "mode"), "normal");
  app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: testEnv,
  });
  page = await app.firstWindow();
  await expect(
    page.getByRole("button", { name: "Resume analysis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("diffs-container")).toBeVisible();
  await screenshot(page, {
    path: join(screenshots, "19-resume-checkpoint.png"),
    animations: "disabled",
  });
  const before = (await readFile(join(binDir, "paths"), "utf8"))
    .trim()
    .split("\n").length;
  const rawBefore = fixture.requests.filter((r) =>
    r.path.includes("/raw/"),
  ).length;
  await page
    .getByRole("button", { name: "Resume analysis", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Analyze again", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "About Constructor DI → inject()",
      exact: true,
    }),
  ).toBeVisible();
  const requests = (await readFile(join(binDir, "paths"), "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(requests.slice(before)).toEqual([["src/mixed.ts"]]);
  expect(fixture.requests.filter((r) => r.path.includes("/raw/")).length).toBe(
    rawBefore,
  );
  expect(fixture.requests.some((r) => r.method !== "GET")).toBe(false);
  await expect(
    page.getByText("0 of 4 reviewed", { exact: true }),
  ).toBeVisible();
});
