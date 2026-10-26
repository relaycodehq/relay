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
    // CodeMirror's highlighting is built from TextMate scopes, so the editor
    // takes that form of the theme whatever the diffs use.
    pending = Promise.resolve(getResolvedOrResolveTheme(name, "shiki-js")).then(
      ({ textmate }) => {
        const colors = (textmate?.colors ?? {}) as Record<string, string>;
        const pick = (keys: string[], fallback: string) =>
          keys.map((k) => colors[k]).find(Boolean) ?? fallback;
        const rules = (textmate?.settings ?? textmate?.tokenColors ?? []) as ThemeRule[];
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
 * The syntax theme the diffs and chat use, as the editor's highlighting.
 * Undefined only while the very first one loads; switching themes keeps the
 * old colours until the new ones are in.
 */
export function useEditorTheme(): Extension | undefined {
  const mode = useTheme();
  const themes = useSyntaxThemes();
  return useEditorThemeNamed(themes[mode]);
}

/** The editor's highlighting for the Shiki theme `name`, for a page that has its own theme. */
export function useEditorThemeNamed(name: string): Extension | undefined {
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
