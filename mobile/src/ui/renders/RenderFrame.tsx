import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { RENDER_MAX_HEIGHT } from "../../../../shared/html-render";
import { parseRenderMessage } from "../../../../shared/html-render-phone";

/**
 * A page from an agent (shared/html-render-phone makes the document) in a
 * WebView with nothing to reach: no navigation, no storage, no files. It tells
 * its height, which the frame takes once, and what it shows meanwhile keeps
 * the place so the thread doesn't jump.
 */
export const RenderFrame = memo(function RenderFrame({
  page,
  height: initial,
  placeholder,
  onCompose,
  onAnswer,
  onSize,
}: {
  /** The whole document, from phoneRenderDocument; a new one reloads the page. */
  page: string;
  /** Until the page has told its own. */
  height: number;
  /** Shown behind the page until it has drawn, and instead if it can't. */
  placeholder?: ReactNode;
  onCompose?: (text: string) => void;
  /** What an asked page (ask_html) hands over with relay.answer(), as JSON. */
  onAnswer?: (json: string) => void;
  onSize?: (height: number) => void;
}) {
  const [height, setHeight] = useState(initial);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => ({ html: page }), [page]);
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseRenderMessage(event.nativeEvent.data);
      if (!message) return;
      if (message.relayRender === "size") {
        setHeight(message.height);
        setDrawn(true);
        onSize?.(message.height);
      } else if (message.relayRender === "link")
        void Linking.openURL(message.href).catch(() => {});
      else if (message.relayRender === "compose") onCompose?.(message.text);
      else if (message.relayRender === "answer") onAnswer?.(message.json);
    },
    [onCompose, onAnswer, onSize],
  );
  const fail = useCallback(() => setFailed(true), []);
  return (
    <View style={[styles.frame, { height }]}>
      {(!drawn || failed) && placeholder}
      {!failed && (
        <WebView
          source={source}
          style={[styles.web, { opacity: drawn ? 1 : 0 }]}
          onMessage={onMessage}
          onError={fail}
          onRenderProcessGone={fail}
          // Every navigation is refused but the page itself; links go through
          // the page's own click handler, which posts them for the app to open.
          // "*" keeps React Native from opening what isn't listed on its own.
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={(request) =>
            request.url === "" || request.url.startsWith("about:")
          }
          javaScriptEnabled
          domStorageEnabled={false}
          incognito
          cacheEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          mixedContentMode="never"
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          allowsLinkPreview={false}
          // The system's font size would rescale a page laid out in CSS pixels,
          // and pinching one would pull the thread's scroll out of the user's hand.
          textZoom={100}
          scalesPageToFit={false}
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          // The page is as tall as it says; only one past the cap scrolls itself.
          scrollEnabled={height >= RENDER_MAX_HEIGHT}
          nestedScrollEnabled
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          androidLayerType="hardware"
          backgroundColor="transparent"
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { overflow: "hidden" },
  web: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "transparent" },
});
