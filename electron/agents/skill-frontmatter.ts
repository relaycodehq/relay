import { parse } from "yaml";

/** A skill's YAML mapping; malformed frontmatter keeps the skill out of the catalog. */
export type Frontmatter =
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "parsed"; fields: Record<string, unknown> };

const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Claude also accepts unquoted `: ` inside plain scalars, as T3's loader repairs them. */
function repairClaudeScalars(yaml: string) {
  return yaml.replace(
    /^([\w-]+:[ \t]*)([^\r\n]*)/gm,
    (line, prefix: string, value: string) => {
      const scalar = value.split(/[ \t]+#/)[0] ?? "";
      if (
        !/:[ \t]/.test(scalar) ||
        /^(?:["'[\]{}|>&*!#%@`]|[-?:](?:[ \t]|$))/.test(scalar)
      )
        return line;
      return `${prefix}${JSON.stringify(scalar)}${value.slice(scalar.length)}`;
    },
  );
}

/** The frontmatter at the top of `text`; only Claude uses its scalar repair. */
export function skillFrontmatter(text: string, claude = false): Frontmatter {
  const match = block.exec(text);
  return match ? parseYamlFields(match[1], claude) : { kind: "missing" };
}

/** Parse the complete YAML document, including multiline quotes, flow maps and native types. */
export function parseYamlFields(yaml: string, claude = false): Frontmatter {
  let fields: unknown;
  try {
    fields = parse(yaml, { logLevel: "error" });
  } catch {
    if (!claude) return { kind: "malformed" };
    try {
      fields = parse(repairClaudeScalars(yaml), { logLevel: "error" });
    } catch {
      return { kind: "malformed" };
    }
  }
  return typeof fields === "object" && fields !== null && !Array.isArray(fields)
    ? { kind: "parsed", fields: fields as Record<string, unknown> }
    : { kind: "malformed" };
}

/** A string field, trimmed; undefined when absent, empty or not a string. */
export function textField(fields: Record<string, unknown>, key: string) {
  const value = fields[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A flag in native YAML types or Claude's YAML 1.1 spellings. */
export function yamlBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "true":
    case "yes":
    case "on":
    case "y":
    case "1":
      return true;
    case "false":
    case "no":
    case "off":
    case "n":
    case "0":
      return false;
    default:
      return undefined;
  }
}
