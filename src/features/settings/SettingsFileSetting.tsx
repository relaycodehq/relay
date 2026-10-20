import { useState } from "react";
import { api } from "../../lib/api";
import { revealLabel } from "../../lib/mod-key";
import {
  useSettingsFile,
  useSettingsFileSaveError,
} from "../../lib/settings-file";
import { ErrorBox } from "../../ui/ui";

/** Where settings.json is, a way into it, and why it isn't read if it isn't. */
export function SettingsFileSetting() {
  const file = useSettingsFile();
  const saveError = useSettingsFileSaveError();
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
        file: whatever it leaves out goes back to its default. For example:
      </p>
      <code className="settings-file-example">
        jq '.typography.interfaceSize = 15' settings.json &gt; tmp &amp;&amp; mv
        tmp settings.json
      </code>
      {file.error ? (
        <ErrorBox
          error={`Line ${file.error.line}, column ${file.error.column}: ${file.error.message.toLowerCase()}. Relay keeps the settings it last read until the file is fixed.`}
        />
      ) : (
        saveError && <ErrorBox error={saveError} />
      )}
      {!!error && <ErrorBox error={error} />}
    </>
  );
}
