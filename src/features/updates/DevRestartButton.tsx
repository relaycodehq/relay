import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { api } from "../../lib/api";

/**
 * Titlebar control under `npm run dev`, by the mark: shows once the main process's
 * sources changed since Relay started, which a window reload doesn't pick up.
 */
export function DevRestartButton() {
  const [stale, setStale] = useState<string[]>([]);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    let live = true;
    const off = api.onDevBuild(setStale);
    api
      .devBuildState()
      .then((state) => live && setStale(state))
      .catch((e) => console.warn("Could not read the dev build state:", e));
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!stale.length) return null;
  return (
    <button
      type="button"
      className="sb-update"
      aria-label="Restart Relay"
      disabled={restarting}
      title={`Changed since Relay started: ${stale.join(", ")}. Restart to load it; agents keep running.`}
      onClick={() => {
        setRestarting(true);
        void api.restartDevBuild();
      }}
    >
      <RotateCw size={13} />
      <span className="dev-restart-label">Restart</span>
    </button>
  );
}
