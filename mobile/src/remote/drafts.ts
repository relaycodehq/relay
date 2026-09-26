// Unsent composer text per thread, as the desktop keeps it: leaving a thread,
// switching to another or Android closing the app doesn't lose what you typed.
// Photos stay in memory only; one can be over a megabyte.
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const storageKey = (key: string) => `relay-draft:${key}`;

function save(key: string, text: string) {
  void (text.trim()
    ? AsyncStorage.setItem(storageKey(key), text)
    : AsyncStorage.removeItem(storageKey(key)));
}

/** Loads `key`'s draft into the composer, then keeps it saved as it changes. */
export function useDraft(
  key: string | undefined,
  text: string,
  setText: Dispatch<SetStateAction<string>>,
) {
  const loaded = useRef<string>(undefined);
  const latest = useRef({ key, text });
  latest.current = { key, text };
  useEffect(() => {
    if (!key) return;
    let live = true;
    void AsyncStorage.getItem(storageKey(key)).then((saved) => {
      if (!live) return;
      if (saved) setText((typed) => typed || saved);
      loaded.current = key;
    });
    return () => {
      live = false;
    };
  }, [key, setText]);
  useEffect(() => {
    if (!key || loaded.current !== key) return;
    const timer = setTimeout(() => save(key, text), 400);
    return () => clearTimeout(timer);
  }, [key, text]);
  // Leaving the screen within the pause still keeps the last few letters.
  useEffect(
    () => () => {
      const { key: last, text: typed } = latest.current;
      if (last && loaded.current === last) save(last, typed);
    },
    [],
  );
}
