import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

/** One header for every step of project setup. */
export function AddProjectHeading({
  title,
  onBack,
  onClose,
  disabled = false,
  children,
}: {
  title: string;
  onBack?: () => void;
  onClose?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="add-project-heading">
      <div>
        {onBack && (
          <button
            type="button"
            className="icon-button"
            aria-label="Back"
            disabled={disabled}
            onClick={onBack}
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <h2>{title}</h2>
      </div>
      {children}
      {onClose && (
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          disabled={disabled}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
