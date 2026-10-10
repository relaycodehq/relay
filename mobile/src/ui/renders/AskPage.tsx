import { useMemo, useState, type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  clampRenderHeight,
  renderHeightAt,
  type HtmlRender,
} from "../../../../shared/html-render";
import { phoneRenderDocument } from "../../../../shared/html-render-phone";
import { Button } from "../Button";
import { type, useTheme } from "../theme";
import { RenderFrame } from "./RenderFrame";
import { usePage } from "./Renders";
import { renderTheme } from "./render-theme";

/** A page Relay couldn't measure opens at this height, then fits itself. */
const UNMEASURED_HEIGHT = 240;

/**
 * The page an agent asks with (ask_html), in the request card: the same page
 * the desktop shows. It hands over its answer with relay.answer() as the user
 * picks; Send gives the agent the last one, Skip tells it to decide itself.
 */
export function AskPage({
  chatId,
  page,
  head,
  busy,
  onAnswer,
}: {
  chatId: string;
  page: HtmlRender;
  head: ReactNode;
  busy: boolean;
  /** JSON from the page, or null to skip. */
  onAnswer: (json: string | null) => void;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const { html, failed } = usePage(chatId, page.id, 0);
  const [answer, setAnswer] = useState<string>();
  const document = useMemo(
    () => (html === undefined ? undefined : phoneRenderDocument(html, renderTheme(t))),
    [html, t],
  );
  const height = clampRenderHeight(
    renderHeightAt(page.pages[0]?.heights, width) ?? UNMEASURED_HEIGHT,
  );
  return (
    <>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
      >
        {head}
        {document ? (
          <RenderFrame page={document} height={height} onAnswer={setAnswer} />
        ) : (
          <Text style={[styles.hint, { color: t.muted }]}>
            {failed ? "The page didn't load. Answer it on the computer." : "Loading the page…"}
          </Text>
        )}
      </ScrollView>
      <View style={styles.actions}>
        <Button label="Skip" disabled={busy} onPress={() => onAnswer(null)} />
        <Button
          label="Send answer"
          primary
          disabled={busy || answer === undefined}
          onPress={() => answer !== undefined && onAnswer(answer)}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  body: { flexShrink: 1 },
  content: { gap: 10 },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
});
