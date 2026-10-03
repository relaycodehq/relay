// Settings → Appearance → Composer toolbar, cut down to what the account
// control adds: it starts in the hidden tray, and moves onto the bar like
// any other control. The other controls stand in, inert.
import { useState, type DragEvent } from "react";
import { ArrowUp, ChevronDown, MoveHorizontal, Paperclip, UserRound } from "lucide-react";
import "../../src/features/composer/composer-toolbar.css";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import type { Accounts } from "./accounts-data";
import { Dial } from "./accounts-parts";

export function ToolbarBuilder({ store }: { store: Accounts }) {
  const [dragging, setDragging] = useState<"bar" | "tray" | null>(null);
  const [over, setOver] = useState(false);
  const current = store.byId(store.thread.accountId)!;
  const start = (from: "bar" | "tray") => (e: DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "account");
    setDragging(from);
  };
  const end = () => {
    setDragging(null);
    setOver(false);
  };
  const account = (
    <span className="toolbar-edit-control" inert>
      <span className="composer-control">
        <UserRound size={13} />
        {current.label}
        <ChevronDown size={12} />
      </span>
    </span>
  );
  return (
    <div className="setting block">
      <div className="setting-text">
        <h4>Composer toolbar</h4>
        <p>Drag to reorder. Drop below the bar to hide.</p>
      </div>
      <div className="setting-control">
        <div className="toolbar-edit">
          <div className="project-composer">
            <p className="toolbar-edit-prompt">
              Ask about the code, plan a change, or build something…
            </p>
            <div
              className="composer-tools"
              aria-label="Composer toolbar order"
              onDragOver={(e) => dragging === "tray" && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging === "tray") store.setShowAccount(true);
                end();
              }}
            >
              <span className="toolbar-edit-item">
                <span className="toolbar-edit-control" inert>
                  <span className="composer-control composer-model-trigger">
                    <ProviderIcon provider="claude" />
                    <span>Opus 5.5</span>
                  </span>
                </span>
              </span>
              {store.showAccount && (
                <span
                  className="toolbar-edit-item"
                  draggable
                  tabIndex={0}
                  role="button"
                  aria-label="Account"
                  title="Account · drag to move, or below to hide"
                  data-dragging={dragging === "bar" || undefined}
                  onDragStart={start("bar")}
                  onDragEnd={end}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" || e.key === "Delete") store.setShowAccount(false);
                  }}
                >
                  {account}
                </span>
              )}
              <span className="toolbar-edit-item">
                <span className="toolbar-edit-control" inert>
                  <span className="composer-control">
                    <Paperclip size={15} />
                  </span>
                </span>
              </span>
              <span className="toolbar-edit-gap">
                <MoveHorizontal size={13} aria-hidden />
              </span>
              <span className="toolbar-edit-item">
                <span className="toolbar-edit-control" inert>
                  <span className="composer-control usage-ring-trigger">
                    <Dial account={current} />
                  </span>
                </span>
              </span>
              <button type="button" className="primary send-message" inert>
                <ArrowUp size={18} />
              </button>
            </div>
          </div>
          <div
            className="composer-tools toolbar-edit-tray"
            aria-label="Hidden controls"
            data-armed={dragging === "bar" ? "" : undefined}
            data-over={(over && dragging === "bar") || undefined}
            onDragOver={(e) => {
              if (dragging !== "bar") return;
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging === "bar") store.setShowAccount(false);
              end();
            }}
          >
            {store.showAccount ? (
              <span className="toolbar-edit-empty">
                {dragging === "bar" ? "Drop here to hide" : "Nothing hidden"}
              </span>
            ) : (
              <span
                className="toolbar-edit-hidden"
                draggable
                tabIndex={0}
                role="button"
                title="Drag back onto the bar, or press Enter"
                onDragStart={start("tray")}
                onDragEnd={end}
                onKeyDown={(e) => e.key === "Enter" && store.setShowAccount(true)}
                onDoubleClick={() => store.setShowAccount(true)}
              >
                {account}
                Account
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
