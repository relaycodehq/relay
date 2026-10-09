import { useRef, useState } from "react";
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { ChatMessage } from "../../../shared/projects";
import { offsetAfterResize, pinSlack, scrollAnchor } from "./scroll-anchor";

/** Keeps reading position through streaming and changes below an inverted list. */
export function useThreadScroll(messages: readonly ChatMessage[]) {
  const list = useRef<FlatList<ChatMessage>>(null);
  const offset = useRef(0);
  const height = useRef<number>(undefined);
  const [pinned, setPinned] = useState(true);
  return {
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
