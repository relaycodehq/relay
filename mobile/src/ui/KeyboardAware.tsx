import { createContext, useEffect, useState, type ReactNode } from "react";
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

/**
 * Focuses an input so the keyboard shows, e.g. as a sheet's Modal goes or a
 * tap elsewhere just put it away. Android shows the keyboard only to a focused
 * window, which returns a moment after a Modal unmounts, and drops a focus
 * that comes while the last tap still dismisses it: the input takes the
 * cursor and no keyboard comes. So it tries again until the keyboard shows.
 */
export function focusWithKeyboard(input: { focus(): void; blur(): void }) {
  if (Platform.OS !== "android") return input.focus();
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const shown = Keyboard.addListener("keyboardDidShow", () => {
    shown.remove();
    clearTimeout(timer);
  });
  const attempt = () => {
    // A second focus() on a focused input does nothing, keyboard or not.
    input.blur();
    input.focus();
    if (++tries < 4) timer = setTimeout(attempt, 400);
    else shown.remove();
  };
  attempt();
}

/** Called as a field is focused, to bring it into view above the keyboard. */
export const RevealField = createContext<() => void>(() => {});

/**
 * Scrolls a thread to a message's end once the keyboard is up. Android scrolls
 * a focused field in the inverted thread list the wrong way, to the top of its
 * card, leaving the field under the composer.
 */
export const RevealMessage = createContext<(messageId: string) => void>(() => {});

const styles = StyleSheet.create({ fill: { flex: 1 } });
