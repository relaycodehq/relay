import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importsOf } from "./layout-graph";

// A computer on a newer Relay sends threads from agents an older phone has
// never heard of, and agentInfo() is undefined for them. Reading a field off
// it without `?.` throws mid-render: the phone showed a blank screen it
// couldn't leave on a Muse thread that way. TypeScript can't catch it, since
// agentInfo(p: AgentProvider) promises an AgentInfo.

const root = resolve(__dirname, "../..");

/** Where `agentInfo(…)` is used as if it can't be undefined, as `line: code`. */
function unguardedAgentInfo(text: string): string[] {
  const found: string[] = [];
  for (const call of text.matchAll(/\bagentInfo\(/g)) {
    const start = call.index;
    if (/function\s+$/.test(text.slice(Math.max(0, start - 20), start)))
      continue;
    let depth = 0;
    let end = start + call[0].length - 1;
    for (; end < text.length; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")" && --depth === 0) break;
    }
    const after = text.slice(end + 1).trimStart();
    const before = text.slice(0, start).trimEnd();
    const unguarded = /^(\.|\[|!(?!=))/.test(after) || /\}\s*=$/.test(before);
    if (!unguarded) continue;
    const line = text.slice(0, start).split("\n").length;
    found.push(`${line}: ${text.slice(start, end + 1 + 12).split("\n")[0]}`);
  }
  return found;
}

/** Every file the phone's code loads at run time: mobile/src and what it imports from shared/. */
function phoneFiles(): string[] {
  const seen = new Set<string>();
  const queue = readdirSync(join(root, "mobile/src"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (e) =>
        e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name),
    )
    .map((e) => join(e.parentPath, e.name));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { specifier, type } of importsOf(readFileSync(file, "utf8"))) {
      if (type || !specifier.startsWith(".")) continue;
      const base = resolve(dirname(file), specifier);
      const target = [".ts", ".tsx", "/index.ts", "/index.tsx", ""]
        .map((ext) => base + ext)
        .find((path) => existsSync(path) && /\.tsx?$/.test(path));
      if (target) queue.push(target);
    }
  }
  return [...seen].map((file) => relative(root, file)).sort();
}

describe("agents the phone doesn't know", () => {
  it("spots agentInfo() read without ?.", () => {
    expect(
      unguardedAgentInfo(`
        {agentInfo(provider).fast && <Row />}
        const { cli } = agentInfo(agent.provider);
        agentInfo(list[0].provider)!.name;
        agentInfo(p)["fast"];
        agentInfo(p)?.fast;
        !!agentInfo(p);
        agentInfo(p) !== undefined;
        export function agentInfo(provider: string) {}
      `),
    ).toEqual([
      "2: agentInfo(provider).fast && <Ro",
      "3: agentInfo(agent.provider);",
      "4: agentInfo(list[0].provider)!.name;",
      '5: agentInfo(p)["fast"];',
    ]);
  });

  it("follows the phone's imports into shared/", () => {
    const files = phoneFiles();
    expect(files).toContain("mobile/src/ui/ModelSheet.tsx");
    expect(files).toContain("shared/agents.ts");
  });

  it("guards every agentInfo() read in code the phone runs", () => {
    const found = phoneFiles().flatMap((file) =>
      unguardedAgentInfo(readFileSync(join(root, file), "utf8")).map(
        (at) => `${file}:${at}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
