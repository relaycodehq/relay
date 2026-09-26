import { memo, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { lexer, type Token, type Tokens } from "marked";
import { mono, type, useTheme, type Palette } from "./theme";

/** An agent's answer: the markdown agents actually write, drawn natively. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const tokens = lexer(text);
  return <View style={styles.root}>{blocks(tokens, theme)}</View>;
});

function blocks(tokens: Token[], t: Palette): ReactNode[] {
  return tokens.map((token, i) => block(token, t, i)).filter(Boolean);
}

function block(token: Token, t: Palette, key: number): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "paragraph":
      return (
        <Text key={key} selectable style={[styles.body, { color: t.text }]}>
          {inline((token as Tokens.Paragraph).tokens, t)}
        </Text>
      );
    case "heading": {
      const h = token as Tokens.Heading;
      return (
        <Text
          key={key}
          selectable
          style={[
            styles.heading,
            { color: t.text, fontSize: h.depth <= 1 ? 19 : h.depth === 2 ? 17 : 15 },
          ]}
        >
          {inline(h.tokens, t)}
        </Text>
      );
    }
    case "code": {
      const code = token as Tokens.Code;
      return (
        <ScrollView
          key={key}
          horizontal
          style={[styles.codeBlock, { backgroundColor: t.code, borderColor: t.border }]}
          contentContainerStyle={styles.codeContent}
        >
          <Text selectable style={[styles.code, { color: t.text }]}>
            {code.text}
          </Text>
        </ScrollView>
      );
    }
    case "list": {
      const list = token as Tokens.List;
      const start = typeof list.start === "number" ? list.start : 1;
      return (
        <View key={key} style={styles.list}>
          {list.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text style={[styles.body, styles.bullet, { color: t.muted }]}>
                {item.task ? (item.checked ? "☑" : "☐") : list.ordered ? `${start + i}.` : "•"}
              </Text>
              <View style={styles.itemBody}>{itemBlocks(item.tokens, t)}</View>
            </View>
          ))}
        </View>
      );
    }
    case "blockquote":
      return (
        <View key={key} style={[styles.quote, { borderColor: t.border }]}>
          {blocks((token as Tokens.Blockquote).tokens, t)}
        </View>
      );
    case "hr":
      return <View key={key} style={[styles.hr, { backgroundColor: t.border }]} />;
    case "table": {
      const table = token as Tokens.Table;
      const row = (cells: Tokens.TableCell[], header: boolean, k: number) => (
        <View key={k} style={[styles.tableRow, { borderColor: t.border }]}>
          {cells.map((cell, c) => (
            <Text
              key={c}
              selectable
              style={[
                styles.cell,
                { color: t.text, fontWeight: header ? "600" : "400" },
              ]}
            >
              {inline(cell.tokens, t)}
            </Text>
          ))}
        </View>
      );
      return (
        <ScrollView key={key} horizontal style={styles.table}>
          <View>
            {row(table.header, true, -1)}
            {table.rows.map((cells, r) => row(cells, false, r))}
          </View>
        </ScrollView>
      );
    }
    case "text": {
      const text = token as Tokens.Text;
      return (
        <Text key={key} selectable style={[styles.body, { color: t.text }]}>
          {text.tokens ? inline(text.tokens, t) : text.text}
        </Text>
      );
    }
    default:
      return "raw" in token && token.raw.trim() ? (
        <Text key={key} selectable style={[styles.body, { color: t.text }]}>
          {token.raw.trim()}
        </Text>
      ) : null;
  }
}

/** A list item's tight text flows as one paragraph; loose items hold blocks. */
function itemBlocks(tokens: Token[], t: Palette) {
  return tokens.map((token, i) =>
    token.type === "text" ? (
      <Text key={i} selectable style={[styles.body, { color: t.text }]}>
        {(token as Tokens.Text).tokens
          ? inline((token as Tokens.Text).tokens!, t)
          : (token as Tokens.Text).text}
      </Text>
    ) : (
      block(token, t, i)
    ),
  );
}

function inline(tokens: Token[] | undefined, t: Palette): ReactNode[] {
  return (tokens ?? []).map((token, i) => {
    switch (token.type) {
      case "strong":
        return (
          <Text key={i} style={styles.strong}>
            {inline((token as Tokens.Strong).tokens, t)}
          </Text>
        );
      case "em":
        return (
          <Text key={i} style={styles.em}>
            {inline((token as Tokens.Em).tokens, t)}
          </Text>
        );
      case "del":
        return (
          <Text key={i} style={styles.del}>
            {inline((token as Tokens.Del).tokens, t)}
          </Text>
        );
      case "codespan":
        return (
          <Text
            key={i}
            style={[styles.codespan, { backgroundColor: t.code, color: t.text }]}
          >
            {decode((token as Tokens.Codespan).text)}
          </Text>
        );
      case "link": {
        const link = token as Tokens.Link;
        const web = /^https?:\/\//i.test(link.href);
        return (
          <Text
            key={i}
            style={{ color: t.accent }}
            onPress={web ? () => void Linking.openURL(link.href) : undefined}
          >
            {inline(link.tokens, t)}
          </Text>
        );
      }
      case "br":
        return "\n";
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens ? (
          <Text key={i}>{inline(text.tokens, t)}</Text>
        ) : (
          decode(text.text)
        );
      }
      case "escape":
        return decode((token as Tokens.Escape).text);
      case "image":
        return `[${(token as Tokens.Image).text || "image"}]`;
      default:
        return "raw" in token ? token.raw : null;
    }
  });
}

/** marked escapes entities in text; native Text shows them literally. */
function decode(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  body: { fontSize: type.body, lineHeight: 22 },
  heading: { fontWeight: "600", lineHeight: 24, marginTop: 4 },
  strong: { fontWeight: "600" },
  em: { fontStyle: "italic" },
  del: { textDecorationLine: "line-through" },
  codespan: { fontFamily: mono, fontSize: 13.5 },
  codeBlock: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  codeContent: { padding: 12 },
  code: { fontFamily: mono, fontSize: 12.5, lineHeight: 18 },
  list: { gap: 6 },
  item: { flexDirection: "row", gap: 8 },
  bullet: { minWidth: 16, textAlign: "right" },
  itemBody: { flex: 1, gap: 6 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, gap: 8 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  table: { flexGrow: 0 },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { width: 140, padding: 6, fontSize: type.small },
});
