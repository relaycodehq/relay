import { createContext, memo, useContext, type ReactNode } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Marked, type Token, type Tokens } from "marked";
import { normalizeMath } from "../../../shared/math-delimiters";
import { texToPlain } from "../../../shared/tex-plain";
import { MathBlock } from "./math/MathBlock";
import { mathExtensions, type InlineMathToken, type MathToken } from "./math/marked-math";
import { mono, type, useTheme, type Palette } from "./theme";

const marked = new Marked({ extensions: mathExtensions });

/**
 * What pressing a link's destination or a piece of inline code does, when it
 * names something the app can open; nothing leaves it as text.
 */
export type OpenLink = (value: string, inline: boolean) => (() => void) | undefined;
/** Draws an `![alt](src)` the app can show; undefined leaves nothing, or a link for a web image. */
export type ShowImage = (src: string, alt: string) => ReactNode | undefined;

/** An agent's answer: the markdown agents actually write, drawn natively. */
export const Markdown = memo(function Markdown({
  text,
  small,
  onLink,
  image,
}: {
  text: string;
  /** The size of an agent's commentary between tool calls. */
  small?: boolean;
  /** Files and folders the answer names; web links open without it. */
  onLink?: OpenLink;
  image?: ShowImage;
}) {
  const theme = useTheme();
  const tokens = marked.lexer(normalizeMath(text));
  return (
    <View style={styles.root}>
      <Small.Provider value={!!small}>
        <Links.Provider value={onLink}>
          <Images.Provider value={image}>{blocks(tokens, theme)}</Images.Provider>
        </Links.Provider>
      </Small.Provider>
    </View>
  );
});

const Small = createContext(false);
const Links = createContext<OpenLink | undefined>(undefined);
const Images = createContext<ShowImage | undefined>(undefined);

/**
 * A web image stays a link in the text, as on the desktop: loading it would tell
 * its server the thread was read.
 */
const webImage = (token: Tokens.Image) => /^https?:\/\//i.test(token.href);

/** An image as a block of its own, or nothing if the app can't show it. */
function BlockImage({ token }: { token: Tokens.Image }) {
  return useContext(Images)?.(token.href, token.text) ?? null;
}

/**
 * A paragraph's text stays whole and its images follow it: native text can't hold
 * a block, and an image that doesn't load then leaves the sentence as it reads.
 */
function Paragraph({ tokens, t }: { tokens: Token[]; t: Palette }) {
  const drawn = (token: Token): token is Tokens.Image =>
    token.type === "image" && !webImage(token as Tokens.Image);
  const images = tokens.filter(drawn);
  if (!images.length) return <Body>{inline(tokens, t)}</Body>;
  // "Before ![](a.png) after" reads "Before after", not with the image's two spaces.
  const text: Token[] = [];
  let gap = false;
  for (const token of tokens) {
    if (drawn(token)) {
      gap = true;
      continue;
    }
    const before = text.at(-1);
    text.push(
      gap && token.type === "text" && before?.type === "text" && /\s$/.test(before.raw)
        ? { ...token, text: (token as Tokens.Text).text.trimStart() }
        : token,
    );
    gap = false;
  }
  return (
    <View style={styles.root}>
      {text.some((token) => ("raw" in token ? token.raw.trim() : true)) && (
        <Body>{inline(text, t)}</Body>
      )}
      {images.map((image, i) => (
        <BlockImage key={i} token={image} />
      ))}
    </View>
  );
}

/**
 * A formula inside a sentence, as plain text: a WebView can't sit in a line of
 * text. One this can't set in plain text (a matrix, an unknown command) stays
 * as its source, which reads better than a half-translation.
 */
function InlineMath({ tex }: { tex: string }) {
  const t = useTheme();
  const plain = texToPlain(tex);
  return plain === null ? (
    <Text style={[styles.codespan, { color: t.muted }]}>{tex}</Text>
  ) : (
    <Text style={styles.math}>{plain}</Text>
  );
}

/** Inline code; a path in the thread's folder opens, in the accent colour. */
function CodeSpan({ children }: { children: string }) {
  const t = useTheme();
  const open = useContext(Links)?.(children.trim(), true);
  return (
    <Text
      accessibilityRole={open ? "link" : undefined}
      onPress={open}
      style={[styles.codespan, { backgroundColor: t.code, color: open ? t.accent : t.text }]}
    >
      {children}
    </Text>
  );
}

/** A web link opens in the browser and a file on the phone; any other stays text, as on the desktop. */
function Link({ href, children }: { href: string; children: ReactNode }) {
  const t = useTheme();
  const file = useContext(Links)?.(href, false);
  const open = file ?? (/^https?:\/\//i.test(href) ? () => void Linking.openURL(href) : undefined);
  return open ? (
    <Text accessibilityRole="link" style={{ color: t.accent }} onPress={open}>
      {children}
    </Text>
  ) : (
    <Text>{children}</Text>
  );
}

function Bullet({ children }: { children: string }) {
  const t = useTheme();
  const small = useContext(Small);
  return (
    <Text style={[styles.body, small && styles.small, styles.bullet, { color: t.muted }]}>
      {children}
    </Text>
  );
}

/** Body text; smaller inside commentary. */
function Body({ children }: { children: ReactNode }) {
  const t = useTheme();
  const small = useContext(Small);
  return (
    <Text
      selectable
      style={[styles.body, small && styles.small, { color: t.text }]}
    >
      {children}
    </Text>
  );
}

function blocks(tokens: Token[], t: Palette): ReactNode[] {
  return tokens.map((token, i) => block(token, t, i)).filter(Boolean);
}

function block(token: Token, t: Palette, key: number): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "math": {
      const math = token as MathToken;
      return <MathBlock key={key} tex={math.text} closed={math.closed} />;
    }
    case "paragraph":
      return <Paragraph key={key} tokens={(token as Tokens.Paragraph).tokens} t={t} />;
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
              <Bullet>
                {item.task ? (item.checked ? "☑" : "☐") : list.ordered ? `${start + i}.` : "•"}
              </Bullet>
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
      return text.tokens ? (
        <Paragraph key={key} tokens={text.tokens} t={t} />
      ) : (
        <Body key={key}>{text.text}</Body>
      );
    }
    default:
      return "raw" in token && token.raw.trim() ? (
        <Body key={key}>{token.raw.trim()}</Body>
      ) : null;
  }
}

/** A list item's tight text flows as one paragraph; loose items hold blocks. */
function itemBlocks(tokens: Token[], t: Palette) {
  return tokens.map((token, i) =>
    token.type === "text" ? (
      (token as Tokens.Text).tokens ? (
        <Paragraph key={i} tokens={(token as Tokens.Text).tokens!} t={t} />
      ) : (
        <Body key={i}>{(token as Tokens.Text).text}</Body>
      )
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
      case "inlineMath":
        return <InlineMath key={i} tex={(token as InlineMathToken).text} />;
      case "codespan":
        return <CodeSpan key={i}>{decode((token as Tokens.Codespan).text)}</CodeSpan>;
      case "link": {
        const link = token as Tokens.Link;
        return (
          <Link key={i} href={link.href}>
            {inline(link.tokens, t)}
          </Link>
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
      // A web image is a link; any other gets here only inside a link or emphasis, where a block can't go.
      case "image": {
        const image = token as Tokens.Image;
        return webImage(image) ? (
          <Link key={i} href={image.href}>
            {image.text || image.href}
          </Link>
        ) : (
          image.text
        );
      }
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
  small: { fontSize: 13, lineHeight: 19 },
  heading: { fontWeight: "600", lineHeight: 24, marginTop: 4 },
  strong: { fontWeight: "600" },
  em: { fontStyle: "italic" },
  del: { textDecorationLine: "line-through" },
  codespan: { fontFamily: mono, fontSize: 13.5 },
  math: { fontFamily: Platform.select({ ios: "Times New Roman", default: "serif" }), fontStyle: "italic" },
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
