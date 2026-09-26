import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";

/**
 * Keeps a screen's bottom above the keyboard. Android 15+ draws apps edge to
 * edge, so the window no longer shrinks for the keyboard; padding by the
 * overlap works there and adds nothing where the window did shrink. The
 * header offset puts the view's layout and the keyboard's screen position in
 * the same coordinates.
 */
export function KeyboardAware({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior="padding"
      keyboardVerticalOffset={useHeaderHeight()}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

export function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(
      ios ? "keyboardWillShow" : "keyboardDidShow",
      () => setShown(true),
    );
    const hide = Keyboard.addListener(
      ios ? "keyboardWillHide" : "keyboardDidHide",
      () => setShown(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
