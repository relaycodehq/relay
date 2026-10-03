import { posix } from "node:path";

// Folder-level import graphs for layout.test.ts: what each file imports, which
// folder that lands in, and the groups of folders that import each other.

export type Source = { path: string; text: string };
export type Import = { specifier: string; type: boolean };
export type Loop = {
  /** Folders along the loop, the first one repeated at the end. */
  path: string[];
  /** One `a -> b: file -> file` import for each step. */
  examples: string[];
};
export type Cycle = {
  /** Every folder in the strongly connected group, sorted. */
  folders: string[];
  /** Shortest loops that between them pass through every folder of the group. */
  loops: Loop[];
};

// A line-start `import … from "x"`, `export … from "x"` or `import "x"`. The
// clause may span lines, so it can only hold what a clause holds, and it can't
// run into a string or another statement. Anchoring at the line start keeps
// comments and text inside strings out.
const staticImport =
  /^(?:import\s*["']([^"']+)["']|(?:import|export)\b(\s+type\b)?([\w\s{},*$]*?)\bfrom\s*["']([^"']+)["'])/gm;
// `import("x")` in an expression is a value import; `typeof import("x")` and
// `import("x").Name` are type positions.
const dynamicImport =
  /(\btypeof\s+)?\bimport\(\s*["']([^"']+)["']\s*\)(\s*\.\s*[A-Z])?/g;

/** `{ type A, type B }` is erased by the compiler; a default or namespace isn't. */
function isTypeOnly(clause: string): boolean {
  const named = clause.match(/\{([^}]*)\}/);
  if (!named || clause.replace(/\{[^}]*\}/, "").replace(/[\s,]/g, ""))
    return false;
  const names = named[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((name) => /^type\s/.test(name));
}

export function importsOf(text: string): Import[] {
  const found: Import[] = [];
  for (const [, bare, typeKeyword, clause, specifier] of text.matchAll(
    staticImport,
  ))
    found.push({
      specifier: bare ?? specifier,
      type:
        Boolean(typeKeyword) || (clause !== undefined && isTypeOnly(clause)),
    });
  const code = text.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, "");
  for (const [, typeof_, specifier, member] of code.matchAll(dynamicImport))
    found.push({ specifier, type: Boolean(typeof_ || member) });
  return found;
}

const toPosix = (path: string) => path.split("\\").join("/");

/**
 * `from folder -> to folder -> one example import`, for the relative imports of
 * the non-test files in `group`'s subfolders (the folder is the first segment
 * under `group`). `vendor/` is skipped, and so are type imports when
 * `valuesOnly` is set.
 */
export function folderEdges(
  files: Source[],
  group: string,
  { valuesOnly }: { valuesOnly: boolean },
): Map<string, Map<string, string>> {
  const folderOf = (path: string) => {
    const [folder, ...rest] = posix.relative(group, path).split("/");
    return rest.length && !folder.startsWith(".") && folder !== "vendor"
      ? folder
      : undefined;
  };
  const edges = new Map<string, Map<string, string>>();
  for (const { path: raw, text } of files) {
    const path = toPosix(raw);
    const from = folderOf(path);
    if (!from || /\.test\.[a-z]+$/.test(path)) continue;
    for (const { specifier, type } of importsOf(text)) {
      if (!specifier.startsWith(".") || (valuesOnly && type)) continue;
      const target = posix.join(posix.dirname(path), specifier);
      const to = folderOf(target);
      if (!to || to === from) continue;
      const tos = edges.get(from) ?? new Map<string, string>();
      if (!tos.has(to)) tos.set(to, `${path} -> ${target}`);
      edges.set(from, tos);
    }
  }
  return edges;
}

/** Tarjan's strongly connected components, keeping those with a cycle in them. */
function components(edges: Map<string, Map<string, string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const found: string[][] = [];
  const visit = (node: string) => {
    index.set(node, index.size);
    low.set(node, index.get(node)!);
    stack.push(node);
    for (const next of edges.get(node)?.keys() ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (stack.includes(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      group.push(member);
    } while (member !== node);
    if (group.length > 1) found.push(group.sort());
  };
  for (const node of [...edges.keys()].sort())
    if (!index.has(node)) visit(node);
  return found.sort((a, b) => a.join().localeCompare(b.join()));
}

/** The shortest way back to `start` along edges that stay inside `members`. */
function loopThrough(
  start: string,
  members: Set<string>,
  edges: Map<string, Map<string, string>>,
): string[] {
  const before = new Map<string, string>();
  const queue = [start];
  for (let node = queue.shift(); node; node = queue.shift()) {
    for (const next of [...(edges.get(node)?.keys() ?? [])].sort()) {
      if (!members.has(next)) continue;
      if (next === start) {
        const loop = [start];
        for (let at = node; at !== start; at = before.get(at)!)
          loop.splice(1, 0, at);
        return [...loop, start];
      }
      if (!before.has(next)) {
        before.set(next, node);
        queue.push(next);
      }
    }
  }
  return [start];
}

export function findCycles(
  files: Source[],
  group: string,
  options: { valuesOnly: boolean },
): Cycle[] {
  const edges = folderEdges(files, group, options);
  return components(edges).map((folders) => {
    const members = new Set(folders);
    const covered = new Set<string>();
    const loops: Loop[] = [];
    for (const folder of folders) {
      if (covered.has(folder)) continue;
      const path = loopThrough(folder, members, edges);
      path.forEach((step) => covered.add(step));
      loops.push({
        path,
        examples: path
          .slice(1)
          .map(
            (to, step) =>
              `${path[step]} -> ${to}: ${edges.get(path[step])!.get(to)}`,
          ),
      });
    }
    return { folders, loops };
  });
}

export function describeCycle({ loops }: Cycle): string {
  return loops
    .map(
      ({ path, examples }) =>
        `  ${path.join(" → ")}\n${examples.map((line) => `    ${line}`).join("\n")}`,
    )
    .join("\n");
}
