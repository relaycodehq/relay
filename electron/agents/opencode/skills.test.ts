import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { setLinkedAgents } from "../../platform/executables";
import { acpRuntime } from "../acp";
import { acpProfiles } from "../acp/profiles";
import { disposeAcp } from "../acp/sessions";
import type { AgentOptions } from "../types";
import { discoverOpenCodeSkills, openCodeSkillContext } from "./skills";

let root: string;
let log: string;

const skill = {
  id: "reverse-engineer-anything",
  name: "REA",
  path: "/skills/reverse-engineer-anything/SKILL.md",
  description: "Reverse engineer an application",
  content: "Read references/native.md before analyzing the supplied binary.",
};

const scenario = (extra: Record<string, unknown> = {}) =>
  vi.stubEnv(
    "RELAY_ACP_SCENARIO",
    JSON.stringify({ skills: [skill], ...extra }),
  );

beforeEach(async () => {
  root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-opencode-skills-")),
  );
  log = join(root, "sent.jsonl");
  const cli = await fakeCli(
    join(root, "opencode"),
    await readFile(resolve("tests/fixtures/acp-agent.cjs"), "utf8"),
    "opencode v2.0.32",
  );
  setLinkedAgents({ opencode: cli });
  vi.stubEnv("RELAY_ACP_LOG", log);
  scenario();
});

afterEach(async () => {
  disposeAcp(acpProfiles.opencode);
  setLinkedAgents({});
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const options = (prompt: string, request = prompt): AgentOptions => ({
  job: { kind: "prompt" },
  cwd: root,
  prompt,
  request,
  signal: new AbortController().signal,
  choice: { model: "", reasoningEffort: "", fast: false },
  onText() {},
});

it("offers native skills through the OpenCode 2 runtime and loads a picked skill over ACP", async () => {
  scenario({
    skills: [
      { ...skill, path: join(root, "skills/rea/SKILL.md"), autoinvoke: false },
    ],
  });
  const runtime = acpRuntime("opencode");
  expect(await runtime.commands(root)).toEqual([
    {
      name: skill.id,
      displayName: "REA",
      skill: true,
      source: "project",
      description: skill.description,
    },
  ]);
  await runtime.run(
    options(
      "Relay context\nUse $reverse-engineer-anything on this binary.",
      "Use $reverse-engineer-anything on this binary.",
    ),
  );
  const sent = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const query = new URL(sent.find((m) => m.api)?.api[2], "http://localhost");
  expect(query.pathname).toBe("/api/skill");
  expect(query.searchParams.get("location[directory]")).toBe(root);
  const blocks = sent.find((m) => m.method === "session/prompt").params.prompt;
  expect(blocks[0]).toMatchObject({
    type: "text",
    annotations: { audience: ["assistant"] },
  });
  expect(blocks[0].text).toContain(skill.content);
  expect(blocks[0].text).toContain(
    `Base directory for this skill: ${join(root, "skills/rea")}`,
  );
  expect(blocks[1]).toEqual({
    type: "text",
    text: "Relay context\nUse $reverse-engineer-anything on this binary.",
  });
});

it("uses path-derived IDs, keeps manual skills pickable and reads catalogs over one megabyte", async () => {
  const file = join(root, "scenario.json");
  await writeFile(
    file,
    JSON.stringify({
      skills: [{ ...skill, content: "x".repeat(1_100_000), autoinvoke: false }],
    }),
  );
  vi.stubEnv("RELAY_ACP_SCENARIO_FILE", file);
  expect(await discoverOpenCodeSkills(root)).toEqual([
    expect.objectContaining({
      name: skill.id,
      displayName: "REA",
      userInvocationOnly: true,
      enabled: true,
    }),
  ]);
});

it("loads each mentioned skill once and leaves unknown dollars and the request untouched", async () => {
  scenario({
    skills: [skill, { ...skill, id: "other", content: "Other instructions" }],
  });
  const prompt =
    "$reverse-engineer-anything $HOME $other $reverse-engineer-anything costs $20";
  const context = await openCodeSkillContext(options(prompt));
  expect(context).toHaveLength(2);
  expect(context[0]).toContain(skill.content);
  expect(context[1]).toContain("Other instructions");
});

it("doesn't load mentions from framing, history or helper jobs", async () => {
  expect(
    await openCodeSkillContext(
      options("History: $reverse-engineer-anything\nHello", "Hello"),
    ),
  ).toEqual([]);
  expect(
    await openCodeSkillContext(options("Hello", "$reverse-engineer-anything")),
  ).toEqual([]);
  const runtime = acpRuntime("opencode");
  await runtime.run({
    ...options("$reverse-engineer-anything"),
    job: { kind: "helper", instructions: "Name this request" },
  });
  const sent = await readFile(log, "utf8");
  expect(sent).not.toContain('"api"');
  expect(sent).not.toContain(skill.content);
});

it("surfaces discovery failures and retries the next call instead of caching an empty catalog", async () => {
  const runtime = acpRuntime("opencode");
  scenario({ skillError: "HTTP 503 Service Unavailable" });
  await expect(runtime.commands(root)).rejects.toThrow(
    "Couldn't load OpenCode's skills.",
  );
  await expect(
    runtime.run(options("$reverse-engineer-anything")),
  ).rejects.toThrow("Couldn't load OpenCode's skills.");
  scenario();
  expect(await runtime.commands(root)).toEqual([
    expect.objectContaining({ name: skill.id, skill: true }),
  ]);
});

it("rejects malformed catalogs without exposing their contents", async () => {
  scenario({
    skillResponse: {
      data: [{ ...skill, id: null, content: "private skill content" }],
    },
  });
  await expect(discoverOpenCodeSkills(root)).rejects.toThrow(
    "OpenCode sent an unexpected skill catalog response.",
  );
});
