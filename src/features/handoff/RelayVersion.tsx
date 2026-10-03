import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { updating, type Computer } from "./computer-status";

/**
 * The other computer's Relay, and updating it from here: it checks the
 * release feed itself, downloads, and restarts into the new version; its
 * agents keep going and the link comes back on its own.
 */
export function RelayVersion({
  computer: c,
  onError,
}: {
  computer: Computer;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  // Said once after asking, while the version it was checked at stands.
  const [current, setCurrent] = useState<string>();
  const onUpdate = () => {
    setBusy(true);
    void api
      .updateComputer(c.id)
      .then((state) => {
        if (state.status === "idle") setCurrent(c.version);
      })
      .catch(onError)
      .finally(() => {
        setBusy(false);
        void qc.invalidateQueries({ queryKey: ["computers-overview"] });
      });
  };
  const u = c.update;
  if (!c.version && !c.outdated) return null;
  const underway = updating(c);
  const line =
    underway ??
    (u?.status === "checking"
      ? "Checking for updates…"
      : u?.status === "available"
        ? u.install === "manual"
          ? `${u.version} is out; install it there by hand`
          : `${u.version} is out`
        : u?.status === "error"
          ? "The last update failed"
          : c.outdated
            ? "Older than this computer's; update it to hand threads over"
            : current && current === c.version
              ? "Up to date"
              : undefined);
  const canUpdate =
    !underway &&
    u?.status !== "checking" &&
    u?.status !== "off" &&
    !(u?.status === "available" && u.install === "manual");
  return (
    <div className="cm-version">
      <span title={u?.status === "error" ? u.message : undefined}>
        {c.version ? `Relay ${c.version}` : "An older Relay"}
        {line && (
          <>
            <br />
            <small className={underway ? "busy" : undefined}>{line}</small>
          </>
        )}
      </span>
      {canUpdate && c.version && (
        <button
          className={`cm-text-button ${u?.status === "available" || c.outdated ? "accent" : ""}`}
          disabled={busy}
          title={`Checks for a newer Relay on ${c.name} and restarts it into that; its agents keep going`}
          onClick={onUpdate}
        >
          {busy
            ? "Asking…"
            : u?.status === "available"
              ? `Update to ${u.version}`
              : u?.status === "error"
                ? "Try again"
                : "Update"}
        </button>
      )}
    </div>
  );
}
