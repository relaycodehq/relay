import { useEffect, useState } from "react";
import { readText, writeText } from "../../lib/persisted-store";

const KEY = "relay-editor-compare";

/**
 * Whether the editor shows the committed file side by side. A modal always
 * starts comparing; inline, the editor reads like a plain file with change
 * bars and remembers the last choice. A folder without Git never compares.
 */
export function useEditorCompare(inline: boolean, plain: boolean) {
  const [comparing, setComparing] = useState(
    () => !inline || readText(KEY) === "true",
  );
  useEffect(() => {
    if (inline) writeText(KEY, String(comparing));
  }, [inline, comparing]);
  return [comparing && !plain, setComparing] as const;
}
