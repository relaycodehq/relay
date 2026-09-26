import { useRef, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type, useTheme } from "./theme";

/** A sheet from the bottom of the screen, for pickers, menus and small forms. */
export function Sheet({
  open,
  title,
  onClose,
  onDismiss,
  children,
  scroll = true,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  /** iOS: the sheet has finished animating away. */
  onDismiss?: () => void;
  children: ReactNode;
  scroll?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          style={styles.backdrop}
          accessibilityLabel="Close"
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: t.raised, paddingBottom: 12 + insets.bottom },
          ]}
        >
          <View style={[styles.grip, { backgroundColor: t.border }]} />
          {title && (
            <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          )}
          {scroll ? (
            <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface MenuItem {
  label: string;
  hint?: string;
  icon?: ReactNode;
  destructive?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** A sheet of actions; picking one closes it. */
export function MenuSheet({
  open,
  title,
  items,
  onClose,
}: {
  open: boolean;
  title?: string;
  items: MenuItem[];
  onClose: () => void;
}) {
  // iOS won't present a picker or dialog while this sheet is still leaving,
  // so the picked action waits for it to be gone.
  const picked = useRef<() => void>(undefined);
  const run = () => {
    const action = picked.current;
    picked.current = undefined;
    action?.();
  };
  return (
    <Sheet open={open} title={title} onClose={onClose} onDismiss={run}>
      {items.map((item) => (
        <MenuRow
          key={item.label}
          {...item}
          onPress={() => {
            picked.current = item.onPress;
            onClose();
            if (Platform.OS !== "ios") run();
          }}
        />
      ))}
    </Sheet>
  );
}

export function MenuRow({ label, hint, icon, destructive, checked, disabled, onPress }: MenuItem) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: checked }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: t.hover },
        checked && { backgroundColor: t.accentSoft },
        disabled && { opacity: 0.4 },
      ]}
    >
      {icon}
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: destructive ? t.danger : t.text }]}>
          {label}
        </Text>
        {!!hint && <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  title: { fontSize: type.small, fontWeight: "600", paddingHorizontal: 20, paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    minHeight: 50,
    paddingVertical: 8,
  },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: type.body },
  hint: { fontSize: type.tiny, lineHeight: 17 },
});
