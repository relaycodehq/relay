import { useEffect, useState } from "react";
import { api } from "./api";

/** Copies text to the clipboard; `copied` says so for a moment afterwards. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (text: string) =>
    void api.writeClipboard(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return [copied, copy] as const;
}
