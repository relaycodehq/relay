import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useIsFocused } from "expo-router";

/**
 * Lines over a screen (connection, updates) that keep their height while
 * another screen covers it. Android sizes a covered screen that changes size
 * as if it had no header, and leaves it so after going back: its bottom,
 * the New thread button among it, ends up under the navigation bar.
 */
export function HeldWhileCovered({ children }: { children: ReactNode }) {
  const covered = !useIsFocused();
  const [height, setHeight] = useState<number>();
  return (
    <View
      onLayout={(e) => {
        if (!covered) setHeight(e.nativeEvent.layout.height);
      }}
      style={covered && height !== undefined ? { height, overflow: "hidden" } : undefined}
    >
      {children}
    </View>
  );
}
