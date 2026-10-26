import { LRLanguage, LanguageDescription, LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Tag, styleTags, tags as t } from "@lezer/highlight";

const loaded = new Map<string, Promise<LanguageSupport | null>>();

/** Extensions language-data doesn't know, each mapped to a file name it does know. */
const aliases: Record<string, string> = {
  ".mts": "x.ts",
  ".cts": "x.ts",
  ".mjs": "x.js",
  ".cjs": "x.js",
  ".jsonc": "x.json",
  ".json5": "x.json",
  ".kts": "x.kt",
  ".gradle": "x.groovy",
  ".zsh": "x.sh",
  ".bash": "x.sh",
  ".env": "x.sh",
  ".mdx": "x.md",
};

// A class method's name is a function being declared, as themes colour it,
// where the stock parser tags it like a field.
const methodNames = styleTags({
  "MethodDeclaration/PropertyDefinition": t.function(t.definition(t.propertyName)),
});

/** A PHP `$variable`, which JetBrains' themes colour apart from other names. */
export const phpVariable = Tag.define(t.variableName);

const extraTags: Record<string, typeof methodNames> = {
  JavaScript: methodNames,
  TypeScript: methodNames,
  JSX: methodNames,
  TSX: methodNames,
  // Only commas and semicolons are separators there; `::`, `:` and `\` stay plain.
  PHP: styleTags({ VariableName: phpVariable, ":: : \\": t.punctuation }),
};

function withExtraTags(name: string, support: LanguageSupport) {
  const tags = extraTags[name];
  if (!tags || !(support.language instanceof LRLanguage)) return support;
  return new LanguageSupport(support.language.configure({ props: [tags] }), support.support);
}

/** The language a file's name says it's in, if CodeMirror knows one. */
export function describeLanguage(path: string) {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  const alias = dot >= 0 ? aliases[name.slice(dot).toLowerCase()] : undefined;
  return (
    LanguageDescription.matchFilename(languages, name) ??
    (alias ? LanguageDescription.matchFilename(languages, alias) : null)
  );
}

/**
 * The parser and its extras (folding, indentation, brackets) for `path`,
 * loaded on first use and shared after. Null for a file nobody parses.
 */
export function loadLanguage(path: string): Promise<LanguageSupport | null> {
  const description = describeLanguage(path);
  if (!description) return Promise.resolve(null);
  let pending = loaded.get(description.name);
  if (!pending) {
    pending = description.load().then((support) => withExtraTags(description.name, support)).catch((error) => {
      console.error(`Couldn't load ${description.name} highlighting`, error);
      loaded.delete(description.name);
      return null;
    });
    loaded.set(description.name, pending);
  }
  return pending;
}
