import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import type { CheckTarget, ProjectCheckInfo } from "../../shared/checks";

export function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
export async function configPath(root: string, path: string) {
  root = await realpath(root);
  const full = resolve(root, path);
  if (!inside(root, full) || !inside(root, await realpath(full)))
    throw new Error(
      "Check configuration must be inside the linked repository.",
    );
  return full;
}
async function json(
  root: string,
  path: string,
): Promise<Record<string, any> | undefined> {
  let full: string;
  try {
    full = await configPath(root, path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  if ((await stat(full)).size > 1024 * 1024)
    throw new Error(`${path} is too large to read as configuration.`);
  const errors: ParseError[] = [];
  const value: unknown = parse(await readFile(full, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (
    errors.length ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    throw new Error(`${path} contains invalid JSON configuration.`);
  return value as Record<string, any>;
}

/** Detect from declarative project metadata only. Never execute project scripts on discovery. */
export async function detectProject(root: string): Promise<ProjectCheckInfo> {
  root = await realpath(root);
  const pkg = await json(root, "package.json");
  const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const workspace = await json(root, "angular.json");
  const targets: CheckTarget[] = [];
  const add = async (
    config: unknown,
    label: string,
    provider: CheckTarget["provider"],
  ) => {
    if (
      typeof config !== "string" ||
      !config ||
      targets.some((t) => t.config === config)
    )
      return;
    await configPath(root, config);
    if (targets.length >= 40)
      throw new Error(
        "This workspace has more than 40 check configurations. Use your IDE to check it.",
      );
    targets.push({ id: `${provider}:${config}`, config, label, provider });
  };
  if (workspace || dependencies["@angular/core"]) {
    for (const [name, project] of Object.entries(workspace?.projects ?? {})) {
      if (!project || typeof project !== "object") continue;
      const definitions =
        (project as any).architect ?? (project as any).targets ?? {};
      for (const kind of ["build", "test"]) {
        const target = definitions[kind];
        await add(
          target?.options?.tsConfig,
          `${name} · ${kind === "build" ? "application" : "tests"}`,
          "angular",
        );
        for (const [configuration, options] of Object.entries(
          target?.configurations ?? {},
        ))
          await add(
            (options as any)?.tsConfig,
            `${name} · ${kind} / ${configuration}`,
            "angular",
          );
      }
    }
    if (!targets.length && (await json(root, "tsconfig.json")))
      await add("tsconfig.json", "Angular project", "angular");
    return {
      framework: "Angular",
      targets,
      ...(!targets.length
        ? { note: "No Angular tsconfig was found in this repository." }
        : {}),
    };
  }
  const seen = new Set<string>();
  const visit = async (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    if (seen.size > 40)
      throw new Error("Too many TypeScript project references.");
    const config = await json(root, name);
    if (!config) return;
    // Solution-style configs delegate checking to their referenced projects.
    if (!(
      Array.isArray(config.files) &&
      config.files.length === 0 &&
      !config.include &&
      config.references?.length
    ))
      await add(name, name, "typescript");
    for (const ref of config.references ?? []) {
      if (typeof ref?.path !== "string") continue;
      let full = resolve(root, name, "..", ref.path);
      if ((await stat(full)).isDirectory()) full = join(full, "tsconfig.json");
      await visit(relative(root, full));
    }
  };
  await visit("tsconfig.json");
  if (!targets.length) await visit("jsconfig.json");
  const framework = dependencies.next
    ? "Next.js"
    : targets.length
      ? targets[0].config.endsWith("jsconfig.json")
        ? "JavaScript"
        : "TypeScript"
      : "Unsupported";
  return {
    framework,
    targets,
    note: targets.length
      ? framework === "Next.js"
        ? "TypeScript checks using this checkout’s existing generated types. Next.js build and route generation are separate."
        : "Uses your compiler settings, including checkJs for JavaScript."
      : "No supported check configuration found. Angular and configured TypeScript/JavaScript projects are supported; other languages can still be reviewed normally.",
  };
}
