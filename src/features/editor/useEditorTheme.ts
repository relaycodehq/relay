import { useEffect, useState } from "react";
import { getResolvedOrResolveTheme } from "@pierre/diffs";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useSyntaxThemes } from "../../lib/appearance";
import { useTheme } from "../../lib/useTheme";
import { highlightStyleFor, type ThemeRule } from "./syntax-theme";

type Resolved = { name: string; extension: Extension };
const cache = new Map<string, Promise<Resolved>>();
/** The theme the last editor showed, so the next one opens in colour. */
let last: Resolved | undefined;

const fallbackColors = {
  added: "#3fb950",
  modified: "#4c8df6",
  removed: "#e5534b",
};

function resolve(name: string): Promise<Resolved> {
  let pending = cache.get(name);
  if (!pending) {
    pending = Promise.resolve(getResolvedOrResolveTheme(name)).then(
      (theme) => {
        const colors = (theme.colors ?? {}) as Record<string, string>;
        const pick = (keys: string[], fallback: string) =>
          keys.map((k) => colors[k]).find(Boolean) ?? fallback;
        const rules = (theme.settings ?? theme.tokenColors ?? []) as ThemeRule[];
        return {
          name,
          extension: [
            syntaxHighlighting(highlightStyleFor(rules)),
            EditorView.editorAttributes.of({
              style: [
                `--editor-added: ${pick(["editorGutter.addedBackground", "gitDecoration.addedResourceForeground"], fallbackColors.added)}`,
                `--editor-modified: ${pick(["editorGutter.modifiedBackground", "gitDecoration.modifiedResourceForeground"], fallbackColors.modified)}`,
                `--editor-removed: ${pick(["editorGutter.deletedBackground", "gitDecoration.deletedResourceForeground"], fallbackColors.removed)}`,
              ].join(";"),
            }),
          ],
        };
      },
    );
    pending.catch(() => cache.delete(name));
    cache.set(name, pending);
  }
  return pending;
}

/**
 * The Shiki theme the diffs and chat use, as the editor's highlighting.
 * Undefined only while the very first one loads; switching themes keeps the
 * old colours until the new ones are in.
 */
export function useEditorTheme(): Extension | undefined {
  const mode = useTheme();
  const themes = useSyntaxThemes();
  const name = themes[mode];
  const [resolved, setResolved] = useState<Resolved | undefined>(() => last);
  useEffect(() => {
    let current = true;
    resolve(name).then(
      (value) => {
        last = value;
        if (current) setResolved(value);
      },
      (error) => console.error(`Couldn't load the ${name} theme`, error),
    );
    return () => {
      current = false;
    };
  }, [name]);
  return resolved?.extension;
}
