import { ContextMenu } from "@base-ui/react/context-menu";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api";

/** Right-click menu that copies the image itself to the clipboard. */
export function CopyImageMenu({
  source,
  within,
  inline = false,
  className = "copy-image-trigger",
  children,
}: {
  /** A data URL, or a function that builds one when the menu item is picked. */
  source: string | (() => Promise<string>);
  /**
   * The ancestor the menu renders inside: a modal dialog, whose top layer
   * hides anything outside it, or a hover peek, which closes once the pointer
   * leaves it.
   */
  within?: string;
  /** Wraps in a span, for an image inside a paragraph. */
  inline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (within)
      setContainer(trigger.current?.closest<HTMLElement>(within) ?? null);
  }, [within]);
  const copy = async () =>
    api.writeClipboardImage(
      typeof source === "string" ? source : await source(),
    );
  return (
    <ContextMenu.Root disabled={!!within && !container}>
      <ContextMenu.Trigger
        ref={trigger}
        className={className}
        render={inline ? <span /> : undefined}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal container={container ?? undefined}>
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
