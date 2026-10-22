import { api } from "./api";
import { useFlash } from "./useFlash";

/** Copies text, and any HTML version of it, to the clipboard; `copied` says so for a moment afterwards. */
export function useCopy() {
  const [copied, setCopied] = useFlash(1500);
  const copy = (text: string, html?: string) =>
    void api.writeClipboard(text, html).then(
      () => setCopied(true),
      () => setCopied(undefined),
    );
  return [!!copied, copy] as const;
}
