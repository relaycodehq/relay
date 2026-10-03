import type { ReactNode } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";

export function ContextMenuItem({
  icon,
  children,
  hint,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <ContextMenu.Item
      className="sb-menu-item"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="sb-menu-label">
        {icon}
        {children}
      </span>
      {hint && <small>{hint}</small>}
    </ContextMenu.Item>
  );
}
