import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { X } from "lucide-react-native";
import { useReducedMotion } from "./motion";
import { type, useTheme } from "./theme";

/**
 * A message's whole text in a sheet of its own, to select any part of it. In
 * the thread a hold opens the message menu instead, and the rendered Markdown
 * is many separate texts a selection can't cross. Not the drag-to-close
 * Sheet: its pan would take the drag that moves a selection.
 */
export function SelectText({ text, onClose }: { text?: string; onClose: () => void }) {
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={text !== undefined}
      transparent
      animationType={reduced ? "none" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <SafeAreaProvider>
        {text !== undefined && <Body text={text} onClose={onClose} />}
      </SafeAreaProvider>
    </Modal>
  );
}

function Body({ text, onClose }: { text: string; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  return (
    <View style={[styles.fill, { paddingTop: insets.top + 8 }]}>
      <View style={[styles.sheet, { backgroundColor: t.raised, borderColor: t.border }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: t.text }]}>Select text</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() =>
              void Clipboard.setStringAsync(text).then(() => setCopied(true))
            }
          >
            <Text style={[styles.action, { color: t.accent }]}>
              {copied ? "Copied" : "Copy all"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            onPress={onClose}
          >
            <X size={20} color={t.muted} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
        >
          <Text selectable style={[styles.text, { color: t.text }]}>
            {text}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { flex: 1, fontSize: type.title, fontWeight: "600" },
  action: { fontSize: type.small, fontWeight: "600" },
  content: { paddingHorizontal: 18, paddingTop: 8 },
  text: { fontSize: type.body, lineHeight: 23 },
});
