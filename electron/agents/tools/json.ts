import { readFile } from "node:fs/promises";
import { parse, type ParseError } from "jsonc-parser";
import { record } from "./presentation";

/** Missing configuration is normal. Broken or unreadable configuration must not look empty. */
export async function readConfig(
  path: string,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Configuration could not be read.");
  }
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (
    errors.length ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  )
    throw new Error("Configuration is not a JSON object.");
  return record(value);
}
