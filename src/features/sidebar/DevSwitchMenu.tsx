import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import { Check, GitBranch } from "lucide-react";
import type { DevCheckout, DevSwitchState } from "../../../shared/types";
import { api } from "../../lib/api";
import { ContextMenuItem } from "../../ui/ContextMenuItem";
import { MenuAction, MenuPopup } from "./SidebarMenu";

const nameOf = (c: DevCheckout) =>
  c.main ? "main" : (c.branch ?? c.path.split(/[\\/]/).pop()!);

/** Null outside the `npm run dev` supervisor, so release builds show nothing. */
function useDevSwitch() {
  const query = useQuery({
    queryKey: ["dev-switch"],
    queryFn: () => api.devSwitchState(),
    staleTime: Infinity,
  });
  const [switching, setSwitching] = useState(false);
  const state = query.data ?? null;
  const running = state?.checkouts.find((c) => c.path === state.running);
  return {
    state,
    running,
    switching,
    refresh: () => void query.refetch(),
    switchTo: (path: string) => {
      setSwitching(true);
      api.devSwitch(path).catch((e) => {
        setSwitching(false);
        console.warn("Could not switch:", e);
      });
    },
  };
}

function rows(
  state: DevSwitchState,
  render: (c: DevCheckout, current: boolean) => ReactNode,
) {
  return state.checkouts.map((c) => render(c, c.path === state.running));
}

/**
 * Under `npm run dev`: right-click the Relay mark to run Relay from another of
 * the repository's worktrees on the same data. Anywhere else, just the mark.
 */
export function DevSwitchMark({ children }: { children: ReactNode }) {
  const { state, running, switching, refresh, switchTo } = useDevSwitch();
  if (!state) return children;
  return (
    <ContextMenu.Root
      disabled={switching}
      onOpenChange={(open) => open && refresh()}
    >
      <ContextMenu.Trigger
        className="relay-mark-trigger"
        title={`Relay runs from ${running ? nameOf(running) : state.running} · right-click to switch`}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="sb-menu-positioner">
          <ContextMenu.Popup className="sb-menu">
            <div className="sb-menu-heading">Run Relay from</div>
            {rows(state, (c, current) => (
              <ContextMenuItem
                key={c.path}
                icon={current ? <Check size={13} /> : <GitBranch size={13} />}
                hint={c.problem}
                disabled={!!c.problem || current}
                onClick={() => switchTo(c.path)}
              >
                {nameOf(c)}
              </ContextMenuItem>
            ))}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * The worktree's name in the footer while Relay runs from one, so it is never
 * mistaken for main. Nothing on main.
 */
export function DevCheckoutLabel() {
  const { state, running, switching, refresh, switchTo } = useDevSwitch();
  if (!state || !running || running.main) return null;
  return (
    <Menu.Root onOpenChange={(open) => open && refresh()}>
      <Menu.Trigger
        className="sb-update sb-dev-switch"
        disabled={switching}
        title={`Relay runs from ${state.running}`}
        aria-label={`Relay runs from ${nameOf(running)}`}
      >
        <GitBranch size={13} />
        <span>{nameOf(running)}</span>
      </Menu.Trigger>
      <MenuPopup side="top" align="start">
        <div className="sb-menu-heading">Run Relay from</div>
        {rows(state, (c, current) => (
          <MenuAction
            key={c.path}
            icon={current ? <Check size={13} /> : <GitBranch size={13} />}
            hint={c.problem}
            disabled={!!c.problem || current}
            title={c.problem ?? c.path}
            onClick={() => switchTo(c.path)}
          >
            {nameOf(c)}
          </MenuAction>
        ))}
      </MenuPopup>
    </Menu.Root>
  );
}
