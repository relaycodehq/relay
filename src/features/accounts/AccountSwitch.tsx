import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, UserRound } from "lucide-react";
import { agentName } from "../../../shared/agents";
import {
  accountsOf,
  hasAccounts,
  type AccountProvider,
} from "../../../shared/agent-accounts";
import { creditsLabel } from "../../../shared/provider-usage";
import { UsageMeters } from "../agents/UsageMeters";
import { AccountBars, AccountDial, headroom } from "./AccountBars";
import type { ThreadAccounts } from "./useThreadAccounts";
import { useAccountsUsage } from "./useAccountUsage";
import "./accounts.css";

/**
 * The model picker's footer for an agent with several accounts: each one as
 * a tab with what it has left, and the meters of the one this thread runs on.
 * Null with one account, where the picker's own meters do.
 */
export function AccountUsageFooter({
  provider,
  accounts,
  now,
}: {
  provider: string;
  accounts: ThreadAccounts;
  now: number;
}) {
  if (!hasAccounts(provider) || !accounts.several(provider)) return null;
  return <AccountTabs provider={provider} accounts={accounts} now={now} />;
}

function AccountTabs({
  provider,
  accounts,
  now,
}: {
  provider: AccountProvider;
  accounts: ThreadAccounts;
  now: number;
}) {
  const list = accountsOf(accounts.state!, provider);
  const usage = useAccountsUsage(
    provider,
    list.map((a) => a.id),
  );
  const current = accounts.of(provider);
  return (
    <>
      <div
        className="account-tabs"
        role="radiogroup"
        aria-label={`${agentName(provider)} account`}
      >
        {list.map((account) => {
          const left = headroom(usage[account.id]);
          const credits = usage[account.id]?.credits;
          const detail = [
            left !== null && `${left}% left`,
            credits && creditsLabel(credits),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={account.id}
              type="button"
              role="radio"
              aria-checked={account.id === current}
              onClick={() =>
                account.id !== current && accounts.pick(provider, account.id)
              }
            >
              <AccountDial usage={usage[account.id]} />
              {account.label}
              {detail && <small>{detail}</small>}
            </button>
          );
        })}
      </div>
      <UsageMeters usage={current ? usage[current] : undefined} now={now} />
    </>
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
        className="composer-control"
        aria-label={`${agentName(provider)} account: ${label}`}
      >
        <UserRound size={13} />
        {label}
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
