import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { mayMentionSkill, skillMentions } from "../../../shared/skill-mentions";
import { executableCommand, findExecutable } from "../../platform/executables";
import type { AgentSkill } from "../skill-presentation";
import type { AgentOptions } from "../types";

const exec = promisify(execFile);

const catalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      description: z.string().optional(),
      path: z.string(),
      content: z.string(),
      autoinvoke: z.boolean().optional(),
    }),
  ),
});

/** OpenCode 2's own catalog includes configured sources, plugins and overrides. */
async function catalog(cwd: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ "location[directory]": cwd });
  const line = executableCommand(await findExecutable("opencode"), [
    "api",
    "GET",
    `/api/skill?${query}`,
  ]);
  let stdout: string;
  try {
    ({ stdout } = await exec(line.command, line.args, {
      cwd,
      signal,
      timeout: 30_000,
      // This endpoint includes skill bodies, not just the menu's metadata.
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
      windowsHide: true,
    }));
  } catch (error) {
    signal?.throwIfAborted();
    const stderr = (error as { stderr?: string }).stderr?.trim().slice(-300);
    throw new Error(
      `Couldn't load OpenCode's skills.${stderr ? ` ${stderr}` : " Check that OpenCode's service is running."}`,
    );
  }
  try {
    return catalogSchema.parse(JSON.parse(stdout)).data;
  } catch {
    throw new Error("OpenCode sent an unexpected skill catalog response.");
  }
}

const within = (root: string, path: string) => {
  const from = relative(root, path);
  return !isAbsolute(from) && from !== ".." && !/^\.\.[\\/]/.test(from);
};

/** ACP advertises commands, but OpenCode 2 doesn't advertise its skills there. */
export async function discoverOpenCodeSkills(
  cwd: string,
): Promise<AgentSkill[]> {
  return (await catalog(cwd)).map((skill) => ({
    name: skill.id,
    path: skill.path,
    enabled: true,
    ...(skill.name && skill.name !== skill.id
      ? { displayName: skill.name }
      : {}),
    ...(skill.description ? { description: skill.description } : {}),
    ...(isAbsolute(skill.path) && within(cwd, skill.path)
      ? { scope: "project" }
      : isAbsolute(skill.path) && within(homedir(), skill.path)
        ? { scope: "user" }
        : {}),
    ...(skill.autoinvoke === false
      ? { userInvocationOnly: true as const }
      : {}),
  }));
}

/**
 * ACP has no skill attachment, and OpenCode doesn't expand text mentions over
 * ACP. Attach the selected bodies as assistant context, with their own base
 * directories; only mentions in the user's request may select a skill.
 */
export async function openCodeSkillContext(
  options: Pick<AgentOptions, "cwd" | "prompt" | "request" | "signal">,
): Promise<string[]> {
  const request = options.request ?? options.prompt;
  if (
    !request ||
    !options.prompt.includes(request) ||
    !mayMentionSkill(request)
  )
    return [];
  const skills = await catalog(options.cwd, options.signal);
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const selected = new Set(
    skillMentions(request, new Set(byId.keys())).map((m) => m.name),
  );
  return [...selected].map((id) => {
    const skill = byId.get(id)!;
    return [
      `The user selected the ${id} skill for this request. Follow its instructions.`,
      `Base directory for this skill: ${dirname(skill.path)}`,
      "Resolve relative paths in the skill against that directory.",
      "",
      skill.content,
    ].join("\n");
  });
}
