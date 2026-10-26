import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import {
  AppWindow,
  Check,
  ChevronDown,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import type { OpenWithApp } from "../../../shared/open-with";
import { api } from "../../lib/api";
import { fileManager, revealLabel } from "../../lib/mod-key";
import { persistedStore } from "../../lib/persisted-store";
import "./open-with.css";

/** One way to open the file elsewhere: an editor found here, the file manager, or the default app. */
interface Opener {
  id: string;
  /** Its name in the menu. */
  name: string;
  /** What the button does with it, for the tooltip. */
  action: string;
  icon: ReactNode;
  open: () => Promise<void>;
}

/** The opener the button's main part uses, per device; unset until the user picks one. */
const preferredOpener = persistedStore<string | null>(
  "relay-open-with",
  (saved) => saved,
  (id) => id,
);

/**
 * The status line's way out of Relay: the main part opens the file in the
 * preferred app, the arrow lists every app found here and the file manager.
 * Picking one opens the file there and makes it the preferred app.
 */
export function OpenWithButton({
  where,
  path,
  external,
  onError,
}: {
  where: string;
  path: string;
  /** A file the system can open in another app. */
  external?: boolean;
  onError: (error: unknown) => void;
}) {
  const { pending, editors, system, main } = useOpeners(
    where,
    path,
    !!external,
  );
  const open = (opener: Opener) => void opener.open().catch(onError);
  const pick = (opener: Opener) => {
    preferredOpener.set(opener.id);
    open(opener);
  };
  const item = (opener: Opener) => (
    <Menu.Item
      key={opener.id}
      className="composer-select-item"
      onClick={() => pick(opener)}
    >
      {opener.icon}
      <span className="open-with-name">{opener.name}</span>
      {opener.id === main.id && (
        <Check size={13} className="open-with-check" aria-label="In use" />
      )}
    </Menu.Item>
  );
  return (
    <div className="open-with" role="group" aria-label="Open elsewhere">
      <button
        type="button"
        className="icon-button open-with-main"
        title={main.action}
        aria-label={main.action}
        // Until the list is in, the main part would flash the file manager.
        disabled={pending}
        onClick={() => open(main)}
      >
        {pending ? <span className="open-with-icon" /> : main.icon}
      </button>
      <Menu.Root>
        <Menu.Trigger
          className="icon-button open-with-more"
          aria-label="Open in another app"
          title="Open in another app"
        >
          <ChevronDown size={12} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            className="composer-popup-positioner"
            side="top"
            align="end"
            sideOffset={6}
          >
            <Menu.Popup className="composer-select-popup open-with-menu">
              {editors.map(item)}
              {editors.length > 0 && (
                <Menu.Separator className="composer-menu-separator" />
              )}
              {system.map(item)}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

/** Every way found to open the file, and the one the button's main part uses. */
function useOpeners(where: string, path: string, external: boolean) {
  const apps = useQuery({
    queryKey: ["open-with-apps"],
    queryFn: () => api.openWithApps(),
    staleTime: 60_000,
  });
  const editors = (apps.data ?? []).map((app) =>
    editorOpener(app, where, path),
  );
  const system = systemOpeners(where, path, external);
  const preferredId = preferredOpener.use();
  const main =
    [...editors, ...system].find((opener) => opener.id === preferredId) ??
    editors[0] ??
    system[0];
  return { pending: apps.isPending, editors, system, main };
}

function editorOpener(app: OpenWithApp, where: string, path: string): Opener {
  return {
    id: app.id,
    name: app.name,
    action: `Open in ${app.name}`,
    icon: app.icon ? (
      <img className="open-with-icon" src={app.icon} alt="" draggable={false} />
    ) : (
      <AppWindow size={14} />
    ),
    open: () => api.openProjectPathWith(where, path, app.id),
  };
}

function systemOpeners(where: string, path: string, external: boolean) {
  const openers: Opener[] = [
    {
      id: "file-manager",
      // "file manager" on Linux starts a sentence here.
      name: fileManager[0].toUpperCase() + fileManager.slice(1),
      action: revealLabel,
      icon: <FolderOpen size={14} />,
      open: () => api.revealProjectPath(where, path),
    },
  ];
  if (external)
    openers.push({
      id: "default-app",
      name: "Default app",
      action: "Open with default app",
      icon: <ExternalLink size={14} />,
      open: () => api.openProjectPath(where, path),
    });
  return openers;
}
