import { Menu } from "@base-ui/react/menu";
import { Check, Copy, Ellipsis, FileCode, ImageDown } from "lucide-react";
import { useRef } from "react";

export type RenderAction = "copy" | "png" | "html";

const ITEMS: { action: RenderAction; label: string; icon: typeof Copy }[] = [
  { action: "copy", label: "Copy image", icon: Copy },
  { action: "png", label: "Save as PNG…", icon: ImageDown },
  { action: "html", label: "Save as HTML…", icon: FileCode },
];

/** The ⋯ menu that copies or saves a page; the pick runs once the menu has gone, so a picture of the page doesn't show it. */
export function RenderActions({
  onPick,
  done,
  container,
}: {
  onPick: (action: RenderAction) => void;
  /** Swaps the icon for a check while an action has just finished. */
  done: boolean;
  /** Where the menu renders: the expanded page sits in the top layer, which hides the rest. */
  container?: HTMLElement | null;
}) {
  const picked = useRef<RenderAction>(undefined);
  return (
    <Menu.Root
      onOpenChangeComplete={(open) => {
        const action = picked.current;
        picked.current = undefined;
        if (!open && action) onPick(action);
      }}
    >
      <Menu.Trigger
        className="pane-toggle html-render-action"
        aria-label="Copy or save"
        title="Copy or save"
      >
        {done ? <Check size={14} /> : <Ellipsis size={14} />}
      </Menu.Trigger>
      <Menu.Portal container={container ?? undefined}>
        <Menu.Positioner
          className="sb-menu-positioner"
          align="end"
          sideOffset={6}
        >
          <Menu.Popup className="sb-menu">
            {ITEMS.map(({ action, label, icon: Icon }) => (
              <Menu.Item
                key={action}
                className="sb-menu-item"
                onClick={() => (picked.current = action)}
              >
                <span className="sb-menu-label">
                  <Icon size={13} />
                  {label}
                </span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
