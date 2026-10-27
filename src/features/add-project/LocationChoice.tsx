import type { RefObject } from "react";
import { Check, ChevronRight, Laptop, Monitor } from "lucide-react";
import type { PairedComputer } from "../../../shared/handoff";
import { DeviceIcon } from "../handoff/DeviceIcon";

/** Where a project is added: this computer, or a paired one. */
export function LocationCards({
  computer,
  elsewhere,
  focus,
  onHere,
  onChoose,
}: {
  computer: PairedComputer | undefined;
  /** A paired computer is picked, though it may not have answered yet. */
  elsewhere: boolean;
  /** The picked card, focused as the page opens. */
  focus: RefObject<HTMLButtonElement | null>;
  onHere: () => void;
  onChoose: () => void;
}) {
  return (
    <div className="add-location-cards">
      <button
        type="button"
        ref={!elsewhere ? focus : undefined}
        aria-pressed={!elsewhere}
        onClick={onHere}
      >
        <Laptop size={22} />
        <span>This computer</span>
        {!elsewhere && <Check size={14} />}
      </button>
      <button
        type="button"
        ref={elsewhere ? focus : undefined}
        aria-pressed={elsewhere}
        onClick={onChoose}
      >
        {computer ? (
          <DeviceIcon name={computer.name} size={22} />
        ) : (
          <Monitor size={22} />
        )}
        <span>{computer?.name ?? "Another computer"}</span>
        {elsewhere ? <Check size={14} /> : <ChevronRight size={14} />}
      </button>
    </div>
  );
}

/** The heading's way back to choosing the computer. */
export function LocationTrigger({
  computer,
  disabled,
  onClick,
}: {
  computer: PairedComputer | undefined;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="add-location-trigger"
      disabled={disabled}
      onClick={onClick}
    >
      {computer ? (
        <DeviceIcon name={computer.name} size={14} />
      ) : (
        <Laptop size={14} />
      )}
      <span>{computer?.name ?? "This computer"}</span>
      <ChevronRight size={12} />
    </button>
  );
}
