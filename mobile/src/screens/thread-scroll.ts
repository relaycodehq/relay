import { useCallback, useRef, useState } from "react";
import { Keyboard, type FlatList, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { ChatMessage } from "../../../shared/projects";
import { offsetAfterResize, pinSlack, scrollAnchor } from "./scroll-anchor";

/** Keeps reading position through streaming and changes below an inverted list. */
export function useThreadScroll(messages: readonly ChatMessage[]) {
  const list = useRef<FlatList<ChatMessage>>(null);
  const offset = useRef(0);
  const height = useRef<number>(undefined);
  const [pinned, setPinned] = useState(true);
  // Once the keyboard has settled, so the list has its final size.
  const revealMessage = useCallback(
    (id: string) => {
      const index = messages.findIndex((m) => m.id === id);
      if (index < 0) return;
      const go = () =>
        setTimeout(
          () =>
            // Inverted, a view position of 0 lines the message's end up with the list's bottom.
            list.current?.scrollToIndex({ index, viewPosition: 0, animated: true }),
          50,
        );
      if (Keyboard.isVisible()) return void go();
      const shown = Keyboard.addListener("keyboardDidShow", () => {
        shown.remove();
        go();
      });
      setTimeout(() => shown.remove(), 1500);
    },
    [messages],
  );
  const toBottom = useCallback(() => {
    offset.current = 0;
    setPinned(true);
    // Inverted, offset 0 is the bottom, where the new message lands.
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  return {
    /** Brings a message's end, where its answer field is, into view above the keyboard. */
    revealMessage,
    /** Back to the latest text, e.g. after sending from further up. */
    toBottom,
    // Only messages already drawn get revealed; one that isn't stays where it is.
    onScrollToIndexFailed: () => {},
    /** At the bottom, following the latest text. */
    pinned,
    ref: list,
    // Native anchor indexes require mounted children, even an empty footer
    // outside the viewport. FlatList still virtualizes its rendered rows.
    removeClippedSubviews: false,
    // FlatList accounts for its header. The permanent footer is the anchor
    // if the answer has no row above it, including a single-message conversation.
    maintainVisibleContentPosition: pinned ? undefined : { minIndexForVisible: scrollAnchor(messages) },
    scrollEventThrottle: 32,
    onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
      offset.current = e.nativeEvent.contentOffset.y;
      setPinned(offset.current <= pinSlack);
    },
    onLayout(e: LayoutChangeEvent) {
      const next = offsetAfterResize(offset.current, height.current, e.nativeEvent.layout.height);
      height.current = e.nativeEvent.layout.height;
      // Keyboard changes count too: keep the text at the same screen height
      // while reading back, and let the latest text follow at the bottom.
      if (next === undefined) return;
      offset.current = next;
      list.current?.scrollToOffset({ offset: offset.current, animated: false });
    },
  };
}
