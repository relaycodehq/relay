import { ContextMenu } from "@base-ui/react/context-menu";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api";

/** Right-click menu that copies the image itself to the clipboard. */
export function CopyImageMenu({
  source,
  inDialog = false,
  inline = false,
  className = "copy-image-trigger",
  children,
}: {
  /** A data URL, or a function that builds one when the menu item is picked. */
  source: string | (() => Promise<string>);
  inDialog?: boolean;
  /** Wraps in a span, for an image inside a paragraph. */
  inline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  // A modal dialog sits in the top layer, so its menu has to render inside it to show.
  useEffect(() => {
    if (inDialog) setDialog(trigger.current?.closest("dialog") ?? null);
  }, [inDialog]);
  const copy = async () =>
    api.writeClipboardImage(
      typeof source === "string" ? source : await source(),
    );
  return (
    <ContextMenu.Root disabled={inDialog && !dialog}>
      <ContextMenu.Trigger
        ref={trigger}
        className={className}
        render={inline ? <span /> : undefined}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal container={dialog ?? undefined}>
        <ContextMenu.Positioner className="sb-menu-positioner">
          <ContextMenu.Popup className="sb-menu">
            <ContextMenu.Item
              className="sb-menu-item"
              onClick={() => void copy().catch(console.error)}
            >
              <span className="sb-menu-label">
                <Copy size={13} />
                Copy image
              </span>
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
