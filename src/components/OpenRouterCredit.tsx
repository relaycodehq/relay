import { memo, useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Flame, RefreshCw } from "lucide-react";
import {
  creditLeft,
  creditPace,
  formatDollars,
  limitResetsAt,
  type OpenRouterCredit,
} from "../../shared/openrouter-credit";
import { resetsIn } from "../../shared/provider-usage";
import { api } from "../lib/api";
import "./composer-model-picker.css";

const REFRESH_MS = 60_000;

const PACE_NOTE = {
  ok: null,
  warn: "Under this week's spend",
  hot: "Under today's spend",
  spent: "Out of credit",
} as const;

/**
 * What's left to spend on OpenRouter, in dollars, beside the send button while
 * OpenCode runs an OpenRouter model. Pay-as-you-go has no windows to ring.
 */
export const OpenRouterCreditButton = memo(function OpenRouterCreditButton({
  threadCost,
}: {
  /** What this thread's answers cost so far, as OpenCode priced them. */
  threadCost?: number;
}) {
  const [credit, setCredit] = useState<OpenRouterCredit>();
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef<(force: boolean) => Promise<void>>(undefined);
  useEffect(() => {
    let cancel = false;
    const load = (force = false) =>
      api
        .openRouterCredit(force)
        .then((value) => {
          if (!cancel) setCredit(value);
        })
        .catch(() => {
          if (!cancel)
            setCredit({
              balance: null,
              limit: null,
              spent: null,
              message: "Couldn't read credit",
            });
        });
    loadRef.current = load;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, []);
  const refresh = () => {
    if (refreshing || !loadRef.current) return;
    setRefreshing(true);
    void loadRef.current(true).finally(() => setRefreshing(false));
  };
  const left = credit && creditLeft(credit);
  // Unreadable credit hides the button, like an agent without limits.
  if (credit && left == null) return null;
  const pace = credit ? creditPace(credit) : "ok";
  const hot = pace === "hot" || pace === "spent";
  const amount = left == null ? null : formatDollars(left);
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={150}
        type="button"
        className="composer-control credit-trigger"
        data-pace={pace}
        data-loading={amount ? undefined : true}
        aria-label={
          amount
            ? `OpenRouter credit: ${amount} left`
            : "OpenRouter credit, checking…"
        }
      >
        {amount ?? "$…"}
        {hot && <Flame size={8} className="usage-ring-flame" aria-hidden />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          side="top"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup className="composer-select-popup usage-ring-popup credit-popup">
            <div className="usage-ring-header">
              <p className="usage-ring-heading">OpenRouter credit</p>
              <button
                type="button"
                className="icon-button usage-ring-refresh"
                onClick={refresh}
                disabled={refreshing}
                aria-label="Refresh OpenRouter credit"
                title="Refresh"
              >
                <RefreshCw
                  size={12}
                  className={refreshing ? "spin" : undefined}
                  aria-hidden
                />
              </button>
            </div>
            {!!threadCost && (
              <div className="credit-thread">
                <span>This thread</span>
                <span>
                  {threadCost < 0.01 ? "<$0.01" : formatDollars(threadCost)}
                </span>
              </div>
            )}
            {credit ? (
              <CreditRows credit={credit} />
            ) : (
              <p className="usage-ring-status">Checking credit…</p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
});

function CreditRows({ credit }: { credit: OpenRouterCredit }) {
  const pace = creditPace(credit);
  const note = PACE_NOTE[pace];
  const { balance, limit, spent } = credit;
  // Whichever runs out first carries the warning.
  const binding =
    balance != null && (!limit || balance <= limit.remaining)
      ? "balance"
      : "limit";
  const reset = limit?.reset && limitResetsAt(limit.reset, Date.now());
  return (
    <>
      {balance != null && (
        <div
          className="usage-row"
          data-pace={binding === "balance" ? pace : "ok"}
        >
          <div className="usage-row-top">
            <span className="usage-row-label">
              <span className="usage-row-dot" aria-hidden />
              Account
            </span>
            <span className="usage-row-value">
              <span className="usage-row-left">
                {formatDollars(Math.max(0, balance))} left
              </span>
            </span>
          </div>
          {binding === "balance" && note && (
            <div className="usage-row-bottom">
              <span />
              <span className="usage-row-limit">{note}</span>
            </div>
          )}
        </div>
      )}
      {limit && (
        <div
          className="usage-row"
          data-kind="weekly"
          data-pace={binding === "limit" ? pace : "ok"}
        >
          <div className="usage-row-top">
            <span className="usage-row-label">
              <span className="usage-row-dot" aria-hidden />
              Key limit
            </span>
            <span className="usage-row-value">
              <span className="usage-row-left">
                {formatDollars(Math.max(0, limit.remaining))} of{" "}
                {formatDollars(limit.amount)}
              </span>
            </span>
          </div>
          <div
            className="usage-row-track"
            role="progressbar"
            aria-label="Key limit left"
            aria-valuemin={0}
            aria-valuemax={limit.amount}
            aria-valuenow={Math.max(0, limit.remaining)}
          >
            <span
              className="usage-row-fill"
              style={{
                width: `${limit.amount > 0 ? Math.min(100, Math.max(0, (limit.remaining / limit.amount) * 100)) : 0}%`,
              }}
            />
          </div>
          <div className="usage-row-bottom">
            <span>
              {reset
                ? resetsIn(reset, Date.now())
                : limit.reset && `Resets ${limit.reset}`}
            </span>
            {binding === "limit" && note && (
              <span className="usage-row-limit">{note}</span>
            )}
          </div>
        </div>
      )}
      {spent && (
        <dl className="credit-spent">
          {(
            [
              ["Spent today", spent.day],
              ["This week", spent.week],
              ["This month", spent.month],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatDollars(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
