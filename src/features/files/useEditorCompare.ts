import { useEffect, useState } from "react";

const KEY = "relay-editor-compare";

/**
 * Whether the editor shows the committed file side by side. A modal always
 * starts comparing; inline, the editor reads like a plain file with change
 * bars and remembers the last choice. A folder without Git never compares.
 */
export function useEditorCompare(inline: boolean, plain: boolean) {
  const [comparing, setComparing] = useState(
    () => !inline || localStorage.getItem(KEY) === "true",
  );
  useEffect(() => {
    if (inline) localStorage.setItem(KEY, String(comparing));
  }, [inline, comparing]);
  return [comparing && !plain, () => setComparing((v) => !v)] as const;
}
