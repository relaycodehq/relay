import { Menu } from "@base-ui/react/menu";
import type { ComponentProps, ReactNode } from "react";

/** A sidebar menu's popup, placed by its trigger. */
export function MenuPopup({
  side,
  align,
  sideOffset = 4,
  children,
}: {
  side: "bottom" | "right" | "top";
  align: "start" | "end";
  sideOffset?: number;
  children: ReactNode;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        side={side}
        align={align}
        className="sb-menu-positioner"
        sideOffset={sideOffset}
      >
        <Menu.Popup className="sb-menu">{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

/** A menu row: an icon, a label, and optionally a quiet note after it. */
export function MenuAction({
  icon,
  hint,
  children,
  ...item
}: Omit<ComponentProps<typeof Menu.Item>, "className"> & {
  icon: ReactNode;
  hint?: string;
}) {
  return (
    <Menu.Item className="sb-menu-item" {...item}>
      <span className="sb-menu-label">
        {icon}
        {children}
      </span>
      {hint && <small>{hint}</small>}
    </Menu.Item>
  );
}
