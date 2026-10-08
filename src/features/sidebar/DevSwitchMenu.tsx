import { useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, GitBranch } from "lucide-react";
import type { DevCheckout, DevSwitchState } from "../../../shared/types";
import { api } from "../../lib/api";
import { MenuAction, MenuPopup } from "./SidebarMenu";

const nameOf = (c: DevCheckout) =>
  c.main ? "main" : (c.branch ?? c.path.split(/[\\/]/).pop()!);

/**
 * Under `npm run dev`: which checkout this Relay runs from, and a switch to
 * another of the repository's worktrees on the same data. Named in the footer
 * when it isn't main, so a worktree's Relay is never mistaken for it.
 */
export function DevSwitchMenu() {
  const [state, setState] = useState<DevSwitchState | null>(null);
  const [switching, setSwitching] = useState(false);
  const load = () =>
    api
      .devSwitchState()
      .then(setState)
      .catch((e) => console.warn("Could not list the dev checkouts:", e));
  useEffect(() => void load(), []);
  if (!state) return null;
  const running = state.checkouts.find((c) => c.path === state.running);
  const away = running && !running.main;
  return (
    <Menu.Root onOpenChange={(open) => open && void load()}>
      <Menu.Trigger
        className={away ? "sb-update sb-dev-switch" : "icon-button"}
        disabled={switching}
        title={`Relay runs from ${state.running}`}
        aria-label={`Relay runs from ${running ? nameOf(running) : state.running}`}
      >
        <GitBranch size={away ? 13 : 15} />
        {away && <span>{nameOf(running)}</span>}
      </Menu.Trigger>
      <MenuPopup side="top" align="start">
        <div className="sb-menu-heading">Run Relay from</div>
        {state.checkouts.map((c) => (
          <MenuAction
            key={c.path}
            icon={
              c.path === state.running ? (
                <Check size={13} />
              ) : (
                <GitBranch size={13} />
              )
            }
            hint={c.problem}
            disabled={!!c.problem || c.path === state.running}
            title={c.problem ?? c.path}
            onClick={() => {
              setSwitching(true);
              api.devSwitch(c.path).catch((e) => {
                setSwitching(false);
                console.warn("Could not switch:", e);
              });
            }}
          >
            {nameOf(c)}
          </MenuAction>
        ))}
      </MenuPopup>
    </Menu.Root>
  );
}
