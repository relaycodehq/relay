import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Prism, normalizeTokens, themes, type Token } from "prism-react-renderer";
import { mono, useTheme } from "./theme";

const languages: Record<string, string> = {
  ts: "tsx",
  tsx: "tsx",
  mts: "tsx",
  cts: "tsx",
  js: "jsx",
  jsx: "jsx",
  mjs: "jsx",
  cjs: "jsx",
  json: "json",
  md: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  yml: "yaml",
  yaml: "yaml",
  swift: "swift",
  kt: "kotlin",
  graphql: "graphql",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  html: "markup",
  xml: "markup",
  svg: "markup",
};

/** The first lines only; a phone isn't where to read a generated bundle. */
export const maxCodeLines = 5000;

/** A read-only file, highlighted by its extension, one numbered line per row. */
export function Code({ code, path }: { code: string; path: string }) {
  const t = useTheme();
  const dark = t.kind === "dark";
  const lines = useMemo(() => {
    const text = code.split("\n").slice(0, maxCodeLines).join("\n");
    const grammar = Prism.languages[languages[path.split(".").at(-1)!.toLowerCase()] ?? ""];
    const tokens = grammar
      ? Prism.tokenize(text, grammar)
      : [text];
    return normalizeTokens(tokens as Parameters<typeof normalizeTokens>[0]);
  }, [code, path]);
  const colors = useMemo(() => {
    const theme = dark ? themes.oneDark : themes.oneLight;
    const byType = new Map<string, string>();
    for (const rule of theme.styles)
      if (rule.style.color) for (const type of rule.types) byType.set(type, rule.style.color);
    return byType;
  }, [dark]);
  const colorOf = (token: Token) => {
    for (let i = token.types.length - 1; i >= 0; i--) {
      const color = colors.get(token.types[i]!);
      if (color) return color;
    }
    return t.text;
  };
  const gutter = String(lines.length).length * 8 + 12;
  return (
    <FlatList
      data={lines}
      keyExtractor={(_, i) => String(i)}
      initialNumToRender={60}
      windowSize={11}
      renderItem={({ item, index }) => (
        <View style={styles.line}>
          <Text style={[styles.number, { color: t.faint, width: gutter }]}>{index + 1}</Text>
          <Text selectable style={[styles.code, { color: t.text }]}>
            {item.length
              ? item.map((token, i) => (
                  <Text key={i} style={{ color: colorOf(token) }}>
                    {token.content}
                  </Text>
                ))
              : " "}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", paddingRight: 10 },
  number: { fontFamily: mono, fontSize: 11, textAlign: "right", paddingRight: 8, paddingTop: 2 },
  code: { flex: 1, fontFamily: mono, fontSize: 12, lineHeight: 18 },
});
