import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  clampRenderHeight,
  renderHeightAt,
  RENDER_MIN_HEIGHT,
  type HtmlRender,
} from "../../../../shared/html-render";
import { phoneRenderDocument } from "../../../../shared/html-render-phone";
import { renderBridge } from "../../../../shared/remote";
import { useRemote } from "../../remote/RemoteProvider";
import { ImageCache } from "../images/image-cache";
import { type, useTheme } from "../theme";
import { RenderNotes } from "../TurnNotices";
import { RenderFrame } from "./RenderFrame";
import { renderTheme } from "./render-theme";

// A page never changes once saved, so the HTML is kept by identity; scrolling
// back to a thread, or the list unmounting a row, doesn't fetch it again.
const pages = new ImageCache();
// The height each page last settled at, so a row mounted again opens at it.
const settled = new Map<string, number>();

export function usePage(chatId: string, renderId: string, page: number) {
  const { call, status, active } = useRemote();
  const key = `${active}:${chatId}:${renderId}:${page}`;
  const [result, setResult] = useState<{ key: string; html?: string }>();
  useEffect(() => {
    if (pages.get(key) !== undefined || status !== "online") return;
    let live = true;
    pages
      .load(key, () => call("renderPage", chatId, renderId, page))
      .then((html) => live && setResult({ key, html }))
      .catch(() => live && setResult({ key, html: undefined }));
    return () => {
      live = false;
    };
  }, [key, chatId, renderId, page, status, call]);
  const html = pages.get(key);
  return { html, failed: html === undefined && result?.key === key };
}

/** Pages the agent showed with show_html, drawn under its message; an older desktop can't send them. */
export function RenderCards({
  chatId,
  renders,
  onCompose,
}: {
  chatId: string;
  renders: HtmlRender[];
  /** Puts what a page's `relay.compose()` says in the composer. */
  onCompose?: (text: string) => void;
}) {
  const { overview } = useRemote();
  if ((overview?.bridge ?? 1) < renderBridge) return <RenderNotes renders={renders} />;
  return renders.map((render) => (
    <RenderCard key={render.id} chatId={chatId} render={render} onCompose={onCompose} />
  ));
}

function RenderCard({
  chatId,
  render,
  onCompose,
}: {
  chatId: string;
  render: HtmlRender;
  onCompose?: (text: string) => void;
}) {
  const t = useTheme();
  const [index, setIndex] = useState(0);
  const variants = render.pages.length > 1;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={[styles.title, { color: t.muted }]}>
          {render.title}
        </Text>
        {variants && (
          <View style={styles.tabs}>
            {render.pages.map((page, i) => (
              <Pressable
                key={i}
                accessibilityRole="tab"
                accessibilityState={{ selected: i === index }}
                onPress={() => setIndex(i)}
                hitSlop={6}
              >
                <Text
                  style={[
                    styles.tab,
                    { color: i === index ? t.text : t.muted },
                    i === index && styles.tabOn,
                  ]}
                >
                  {page.label || `${i + 1}`}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <View style={[styles.box, { borderColor: t.border }]}>
        <RenderPage
          // Another variant is another page, not a redraw of this one.
          key={index}
          chatId={chatId}
          render={render}
          index={index}
          onCompose={onCompose}
        />
      </View>
    </View>
  );
}

function RenderPage({
  chatId,
  render,
  index,
  onCompose,
}: {
  chatId: string;
  render: HtmlRender;
  index: number;
  onCompose?: (text: string) => void;
}) {
  const t = useTheme();
  const { html, failed } = usePage(chatId, render.id, index);
  const width = Math.round(useWindowDimensions().width - 34);
  const key = `${render.id}:${index}:${width}`;
  const estimate =
    settled.get(key) ??
    renderHeightAt(render.pages[index]?.heights, width) ??
    clampRenderHeight(RENDER_MIN_HEIGHT * 2);
  const theme = useMemo(() => renderTheme(t), [t]);
  const page = useMemo(
    () => (html === undefined ? undefined : phoneRenderDocument(html, theme)),
    [html, theme],
  );
  const note = (
    <View style={styles.note}>
      <Text style={[styles.hint, { color: t.muted }]}>
        {failed ? "This page couldn't be loaded." : "Loading page…"}
      </Text>
    </View>
  );
  if (!page) return <View style={{ height: estimate }}>{note}</View>;
  return (
    <RenderFrame
      page={page}
      height={estimate}
      placeholder={note}
      onCompose={onCompose}
      onSize={(height) => settled.set(key, height)}
    />
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { flexShrink: 1, fontSize: type.tiny },
  tabs: { flexDirection: "row", gap: 14 },
  tab: { fontSize: type.tiny },
  tabOn: { fontWeight: "600" },
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: "hidden" },
  note: { flex: 1, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: type.tiny },
});
