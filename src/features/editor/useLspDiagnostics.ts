import { useEffect, useState } from "react";
import type { LspDiagnostic } from "../../../shared/language-servers";
import { onLspDiagnostics } from "../language-servers/client";

/** What the language server reports for one file, empty while no server covers it. */
export function useLspDiagnostics(
  where: string,
  path: string,
  enabled: boolean,
) {
  const [diagnostics, setDiagnostics] = useState<LspDiagnostic[]>([]);
  useEffect(() => {
    setDiagnostics([]);
    if (!enabled) return;
    return onLspDiagnostics(where, path, setDiagnostics);
  }, [enabled, where, path]);
  return diagnostics;
}
