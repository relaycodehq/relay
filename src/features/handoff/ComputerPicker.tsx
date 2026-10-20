import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import type { PairedComputer } from "../../../shared/handoff";
import { AddComputer } from "./AddComputer";
import { DeviceIcon } from "./DeviceIcon";
import { computerLine, reachable } from "./computer-status";
import { usePairedComputers, useWakeComputer } from "./usePairedComputers";
import { ErrorBox } from "../../ui/ui";
import "./computers.css";
import "../../ui/palette.css";

/** The same connection form as Settings, alongside computers already paired. */
export function ComputerPicker({
  onPick,
  onBusy,
}: {
  onPick: (computer: PairedComputer) => void;
  onBusy: (busy: boolean) => void;
}) {
  const computers = usePairedComputers(true);
  const [adding, setAdding] = useState(false);
  const [working, setWorking] = useState(false);
  const handleBusy = useCallback(
    (busy: boolean) => {
      setWorking(busy);
      onBusy(busy);
    },
    [onBusy],
  );
  const [error, setError] = useState<unknown>();
  const wake = useWakeComputer(setError);
  return (
    <div className="palette-body computer-picker">
      {computers.isPending && (
        <p className="headline-project-empty" role="status">
          Loading computers…
        </p>
      )}
      {(computers.data ?? []).map((c) => (
        <div className="computer-picker-row" key={c.id}>
          <button
            className="headline-project-row palette-row"
            disabled={working || !reachable(c)}
            onClick={() => onPick(c)}
          >
            <DeviceIcon name={c.name} size={20} />
            <span className="headline-project-row-label">
              <strong>{c.name}</strong>
              <small>{computerLine(c)}</small>
            </span>
          </button>
          {c.stopped && (
            <button disabled={wake.waking} onClick={() => void wake.wake(c.id)}>
              Reconnect
            </button>
          )}
        </div>
      ))}
      {!!computers.error && <ErrorBox error={computers.error} />}
      {!!error && <ErrorBox error={error} />}
      {adding || computers.data?.length === 0 ? (
        <AddComputer
          onStart={() => setAdding(true)}
          focusRequest={1}
          onConnected={onPick}
          onBusy={handleBusy}
        />
      ) : (
        <button
          className="headline-project-row palette-row"
          onClick={() => setAdding(true)}
        >
          <Plus size={20} />
          <span>Connect another computer…</span>
        </button>
      )}
    </div>
  );
}
