import { useEffect, useState, useSyncExternalStore } from "react";
import type { FileDocument } from "./documents";

/** The document's status, file, and how it shows its changes. Re-renders when any of them changes, never per keystroke. */
export function useDocument(doc: FileDocument) {
  const status = useSyncExternalStore(
    (listener) => doc.subscribe(listener),
    () => doc.status,
  );
  const file = useSyncExternalStore(
    (listener) => doc.subscribe(listener),
    () => doc.file,
  );
  const comparing = useSyncExternalStore(
    (listener) => doc.subscribe(listener),
    () => doc.comparing,
  );
  const comparedWith = useSyncExternalStore(
    (listener) => doc.subscribe(listener),
    () => doc.comparedWith,
  );
  return { status, file, comparing, comparedWith };
}

/**
 * The text, `delay` ms after the last keystroke, for whatever reads all of it
 * (checks, Markdown preview, blame). Typing itself never re-renders.
 */
export function useSettledText(doc: FileDocument, delay = 200) {
  const [text, setText] = useState<string | undefined>(() =>
    doc.state ? doc.text() : undefined,
  );
  useEffect(() => {
    setText(doc.state ? doc.text() : undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setText(doc.text()), delay);
    };
    const offState = doc.onState(settle);
    // The file as first read is shown right away, without waiting.
    const offStatus = doc.subscribe(() => {
      if (doc.state) setText((current) => current ?? doc.text());
    });
    return () => {
      clearTimeout(timer);
      offState();
      offStatus();
    };
  }, [doc, delay]);
  return text;
}
