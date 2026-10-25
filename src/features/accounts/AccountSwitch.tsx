import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, UserRound } from "lucide-react";
import { agentName } from "../../../shared/agents";
import {
  accountsOf,
  hasAccounts,
  type AccountProvider,
} from "../../../shared/agent-accounts";
import { creditsLabel } from "../../../shared/provider-usage";
import { UsageStrip } from "../agents/UsageStrip";
import { AccountBars, AccountDial, headroom } from "./AccountBars";
import type { ThreadAccounts } from "./useThreadAccounts";
import { useAccountsUsage } from "./useAccountUsage";
import "./accounts.css";

/** "Codex · Personal": whose usage a reset would spend, as the confirm names it. */
export function accountUsageName(provider: string, accounts: ThreadAccounts) {
  if (!hasAccounts(provider) || !accounts.state) return undefined;
  const current = accounts.of(provider);
  const selected = accountsOf(accounts.state, provider).find(
    (a) => a.id === current,
  );
  return `${agentName(provider)} · ${selected?.label ?? "Default"}`;
}

/** The picker's account selector and usage summary share one compact strip. */
export function accountUsageFooter(
  provider: string,
  accounts: ThreadAccounts,
  now: number,
  container?: HTMLElement,
) {
  if (!hasAccounts(provider) || !accounts.state) return null;
  return (
    <AccountUsageStrip
      provider={provider}
      accounts={accounts}
      now={now}
      container={container}
    />
  );
}

function AccountUsageStrip({
  provider,
  accounts,
  now,
  container,
}: {
  provider: AccountProvider;
  accounts: ThreadAccounts;
  now: number;
  container?: HTMLElement;
}) {
  const list = accountsOf(accounts.state!, provider);
  const usage = useAccountsUsage(
    provider,
    list.map((a) => a.id),
  );
  const current = accounts.of(provider);
  const selected = list.find((a) => a.id === current);
  return (
    <UsageStrip
      usage={current ? usage[current] : undefined}
      now={now}
      accountId={current}
      accountName={accountUsageName(provider, accounts)}
      container={container}
      accountControl={
        list.length > 1 ? (
          <select
            aria-label={`${agentName(provider)} account`}
            value={current}
            onChange={(e) => accounts.pick(provider, e.target.value)}
          >
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        ) : (
          (selected?.label ?? agentName(provider))
        )
      }
    />
  );
}

/** The account as a composer control of its own, for those who put it on the bar. */
export function AccountControl({
  provider,
  accounts,
}: {
  provider: string;
  accounts: ThreadAccounts;
}) {
  if (!hasAccounts(provider) || !accounts.several(provider)) return null;
  return <AccountMenu provider={provider} accounts={accounts} />;
}

function AccountMenu({
  provider,
  accounts,
}: {
  provider: AccountProvider;
  accounts: ThreadAccounts;
}) {
  const list = accountsOf(accounts.state!, provider);
  const usage = useAccountsUsage(
    provider,
    list.map((a) => a.id),
  );
  const current = accounts.of(provider)!;
  const label = list.find((a) => a.id === current)?.label;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="composer-control composer-account"
        aria-label={`${agentName(provider)} account: ${label}`}
        title={label}
      >
        <UserRound size={13} />
        <span>{label}</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          side="top"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup className="composer-select-popup account-menu">
            <Menu.Group>
              <Menu.GroupLabel className="composer-menu-label">
                {agentName(provider)} account for this thread
              </Menu.GroupLabel>
              <Menu.RadioGroup
                value={current}
                onValueChange={(id) => accounts.pick(provider, id as string)}
              >
                {list.map((account) => {
                  const left = headroom(usage[account.id]);
                  const credits = usage[account.id]?.credits;
                  return (
                    <Menu.RadioItem
                      key={account.id}
                      value={account.id}
                      className="composer-select-item"
                      closeOnClick
                    >
                      <AccountDial usage={usage[account.id]} />
                      <span className="account-menu-text">
                        <b>{account.label}</b>
                        <small>
                          {[
                            account.plan,
                            left !== null && `${left}% left`,
                            credits && creditsLabel(credits),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                      <Menu.RadioItemIndicator>
                        <Check size={13} />
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  );
                })}
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator className="composer-menu-separator" />
            <div className="account-menu-bars">
              <AccountBars usage={usage[current]} resets />
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
