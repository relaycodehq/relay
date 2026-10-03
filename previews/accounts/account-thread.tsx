// A thread: the model picker's footer tabs switch the account, and the
// composer's own account control shows once the toolbar builder adds it.
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, UserRound } from "lucide-react";
import { agentName } from "../../shared/agents";
import { headroom, type Accounts } from "./accounts-data";
import { Bars, Dial, ThreadMock } from "./accounts-parts";

export function AccountThread({ store }: { store: Accounts }) {
  const s = store.lastSwitch;
  return (
    <ThreadMock
      store={store}
      note={
        s?.auto
          ? `Continued on ${store.byId(s.to)?.label}: ${store.byId(s.from)?.label} hit its 5h limit.`
          : undefined
      }
      tools={
        <>
          {store.showAccount && <AccountControl store={store} />}
          <span className="acc-spacer" />
          <span className="composer-control usage-ring-trigger" aria-hidden>
            <Dial account={store.byId(store.thread.accountId)!} />
          </span>
        </>
      }
    />
  );
}

function AccountControl({ store }: { store: Accounts }) {
  const { provider, accountId } = store.thread;
  const list = store.of(provider);
  const current = store.byId(accountId)!;
  // One account is nothing to choose between.
  if (list.length < 2) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="composer-control"
        aria-label={`${agentName(provider)} account: ${current.label}`}
      >
        <UserRound size={13} />
        {current.label}
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="composer-popup-positioner" side="top" align="start" sideOffset={6}>
          <Menu.Popup className="composer-select-popup acc-picker-popup">
            <Menu.Group>
              <Menu.GroupLabel className="composer-menu-label">
                {agentName(provider)} account for this thread
              </Menu.GroupLabel>
              <Menu.RadioGroup value={accountId} onValueChange={(id) => store.use(id as string)}>
                {list.map((a) => (
                  <Menu.RadioItem
                    key={a.id}
                    value={a.id}
                    className="composer-select-item acc-picker-item"
                    closeOnClick
                  >
                    <Dial account={a} />
                    <span className="acc-picker-text">
                      <b>{a.label}</b>
                      <small>
                        {a.plan} · {headroom(a)}% left
                      </small>
                    </span>
                    <Menu.RadioItemIndicator>
                      <Check size={13} />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator className="composer-menu-separator" />
            <div className="acc-picker-bars">
              <Bars account={current} wide />
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
