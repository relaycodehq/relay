import { useState } from "react";
import { api } from "../../lib/api";
import { revealLabel, windows } from "../../lib/mod-key";
import { ErrorBox } from "../../ui/ui";
import { settingsFileProblem, useSettingsFile } from "./useSettingsFile";

/** Where settings.json is, a way into it, and why it isn't read if it isn't. */
export function SettingsFileSetting() {
  const file = useSettingsFile();
  const problem = settingsFileProblem(file);
  const [error, setError] = useState<unknown>();
  const run = (action: () => Promise<void>) => {
    setError(undefined);
    action().catch(setError);
  };
  return (
    <>
      <div className="settings-file">
        <code title={file.path}>{file.path}</code>
        <button
          className="text-button"
          onClick={() => run(() => api.openSettingsFile())}
        >
          Open
        </button>
        <button
          className="text-button"
          onClick={() => run(() => api.revealSettingsFile())}
        >
          {revealLabel}
        </button>
      </div>
      <p className="setting-muted settings-file-note">
        A script should change only the keys it means to, not write the whole
        file: whatever it leaves out goes back to its default.{" "}
        {windows
          ? "In PowerShell, for example, which stops at comments:"
          : "With jq, for example, which stops at comments:"}
      </p>
      <code className="settings-file-example">
        {scriptExample(file.path || "settings.json")}
      </code>
      {!!problem && <ErrorBox error={problem} />}
      {!!error && <ErrorBox error={error} />}
    </>
  );
}

/**
 * Shown above every other Settings page while the file has trouble: a change
 * made there snaps back, and this says why.
 */
export function SettingsFileProblem() {
  const file = useSettingsFile();
  const problem = settingsFileProblem(file);
  const [error, setError] = useState<unknown>();
  if (!problem) return null;
  return (
    <div className="settings-file-problem">
      <ErrorBox error={error ?? problem} />
      <button
        className="text-button"
        onClick={() => {
          setError(undefined);
          api.openSettingsFile().catch(setError);
        }}
      >
        Open settings.json
      </button>
    </div>
  );
}

function scriptExample(path: string) {
  if (windows) {
    const quoted = `'${path.replaceAll("'", "''")}'`;
    return `$f = ${quoted}; $s = Get-Content $f -Raw | ConvertFrom-Json; if (!$s.typography) { $s | Add-Member typography ([pscustomobject]@{}) }; $s.typography | Add-Member interfaceSize 15 -Force; $s | ConvertTo-Json -Depth 9 | Set-Content $f`;
  }
  const quoted = `'${path.replaceAll("'", `'\\''`)}'`;
  return `f=${quoted}; jq '.typography.interfaceSize = 15' "$f" > "$f.tmp" && mv "$f.tmp" "$f"`;
}
