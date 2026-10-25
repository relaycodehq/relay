/** A TextMate rule from a Shiki theme. */
export type ThemeRule = {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string };
};

type Style = { color?: string; fontStyle?: string };

/** The rule's simple selectors. Ones with descendants or exclusions are not supported. */
const selectorsOf = (rule: ThemeRule) =>
  (Array.isArray(rule.scope) ? rule.scope : (rule.scope ?? "").split(","))
    .map((s) => s.trim())
    .filter((s) => s && !/\s/.test(s));

/**
 * What a theme gives `scope`, as TextMate picks it: the longest selector that
 * is the scope or a prefix of it by whole parts, a later rule winning a tie.
 * Colour and font style are settled separately.
 */
export function resolveScope(
  rules: readonly ThemeRule[],
  scope: string,
): Style {
  let color: [number, string] | undefined;
  let font: [number, string] | undefined;
  for (const rule of rules) {
    const { foreground, fontStyle } = rule.settings ?? {};
    if (!foreground && fontStyle === undefined) continue;
    for (const selector of selectorsOf(rule)) {
      if (scope !== selector && !scope.startsWith(selector + ".")) continue;
      const score = selector.length;
      if (foreground && (!color || score >= color[0]))
        color = [score, foreground];
      if (fontStyle !== undefined && (!font || score >= font[0]))
        font = [score, fontStyle];
    }
  }
  return { color: color?.[1], fontStyle: font?.[1] };
}

/** The style of the first of `scopes` the theme styles at all. */
export function firstStyle(
  rules: readonly ThemeRule[],
  scopes: readonly string[],
): Style {
  for (const scope of scopes) {
    const style = resolveScope(rules, scope);
    if (style.color || style.fontStyle) return style;
  }
  return {};
}

/** The colour a theme gives text no scope claims: its rule without a scope. */
export function plainForeground(rules: readonly ThemeRule[]) {
  return rules.find((rule) => !rule.scope && rule.settings?.foreground)
    ?.settings?.foreground;
}
