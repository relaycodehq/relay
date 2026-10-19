import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, SquareTerminal } from "lucide-react";
import type { ComputerRoute, ComputersOverview } from "../../../shared/handoff";
import { api } from "../../lib/api";
import { InstallLog } from "../../ui/InstallLog";
import { ErrorBox } from "../../ui/ui";
import { SshHostInput } from "./SshHostInput";

const routeKey = (route: ComputerRoute) =>
  route.kind === "ssh" ? `ssh:${route.host}` : `wsl:${route.distro}`;
const routeWhere = (route: ComputerRoute) =>
  route.kind === "ssh" ? `on ${route.host}` : `in ${route.distro}`;

/**
 * Pairing with a Relay this computer reaches over SSH, or in one of its WSL
 * distributions, for when Tailscale isn't an option: the connection runs
 * inside SSH or wsl.exe, with this computer's own SSH setup.
 */
export function ConnectOverPipe({
  onPaired,
}: {
  onPaired: (id: string) => void;
}) {
  const qc = useQueryClient();
  const distros = useQuery({
    queryKey: ["wsl-distros"],
    queryFn: () => api.wslDistros(),
    staleTime: 60_000,
  });
  const overview = qc.getQueryData<ComputersOverview>(["computers-overview"]);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  /** Where connecting found no Relay: it offers to install it there. */
  const [missing, setMissing] = useState<ComputerRoute>();
  const [installing, setInstalling] = useState<ComputerRoute>();
  const installLog = useQuery({
    queryKey: ["relay-install", installing && routeKey(installing)],
    queryFn: () => api.relayInstallOutput(installing!),
    enabled: !!installing,
    refetchInterval: 1000,
  });
  const connected = (route: ComputerRoute) =>
    overview?.computers.some(
      (c) => c.route && routeKey(c.route) === routeKey(route),
    );
  async function connect(route: ComputerRoute) {
    setBusy(routeKey(route));
    setError(undefined);
    try {
      const list = await api.connectComputer(route);
      if (route.kind === "ssh") setHost("");
      await qc.invalidateQueries({ queryKey: ["computers-overview"] });
      void qc.invalidateQueries({ queryKey: ["paired-computers"] });
      const added = list.find(
        (c) => c.route && routeKey(c.route) === routeKey(route),
      );
      if (added) onPaired(added.id);
    } catch (e) {
      const notThere =
        e instanceof Error && /^Relay isn't installed/.test(e.message);
      setMissing(notThere ? route : undefined);
      setError(notThere ? undefined : e);
    } finally {
      setBusy(undefined);
    }
  }
  async function install(route: ComputerRoute) {
    setMissing(undefined);
    setError(undefined);
    setInstalling(route);
    try {
      await api.installRelayOver(route);
    } catch (e) {
      setError(e);
      return;
    } finally {
      setInstalling(undefined);
    }
    await connect(route);
  }
  // What's typed as a command works too: `ssh box` is box.
  const sshTo = (typed: string) =>
    ({ kind: "ssh", host: typed.trim().replace(/^ssh\s+/, "") }) as const;
  const ssh = sshTo(host);
  return (
    <div className="settings-card cm-card cm-pipe">
      <div className="cm-pipe-head">Without Tailscale</div>
      <ol className="cm-steps">
        <li>
          <span className="cm-step-mark">
            <SquareTerminal size={12} aria-hidden />
          </span>
          <div className="cm-grow">
            <b>Over SSH</b>
            <small>
              Anything you can <em>ssh</em> into, with your keys, SSH config and
              jump hosts. Relay needs to be installed there.
            </small>
            <div className="cm-paste">
              <SshHostInput
                value={host}
                onChange={(value) => {
                  setHost(value);
                  setError(undefined);
                  setMissing(undefined);
                }}
                onConnect={(typed) => {
                  if (!busy && sshTo(typed).host) void connect(sshTo(typed));
                }}
                paired={(name) => !!connected({ kind: "ssh", host: name })}
              />
              <button
                className={ssh.host ? "primary" : undefined}
                disabled={!ssh.host || !!busy}
                onClick={() => void connect(ssh)}
              >
                {busy === routeKey(ssh) ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>
        </li>
        {distros.data?.map((distro) => {
          const route = { kind: "wsl", distro } as const;
          const done = connected(route);
          return (
            <li key={distro}>
              <span className="cm-step-mark">
                <SquareTerminal size={12} aria-hidden />
              </span>
              <div className="cm-grow">
                <b>{distro} in WSL</b>
                <small>
                  {done
                    ? "Paired. Its projects run in it."
                    : "Linux on this computer. Relay needs to be installed in it."}
                </small>
              </div>
              {!done && (
                <button disabled={!!busy} onClick={() => void connect(route)}>
                  {busy === routeKey(route) ? "Connecting…" : "Connect"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {installing ? (
        <div className="cm-install" role="status">
          <Download size={14} aria-hidden />
          <span>Installing Relay {routeWhere(installing)}…</span>
          {!!installLog.data && <InstallLog output={installLog.data} />}
        </div>
      ) : (
        missing && (
          <div className="cm-install" role="status">
            <Download size={14} aria-hidden />
            <span>
              Relay isn't {routeWhere(missing)} yet. It installs in your home
              folder there, no sudo needed.
            </span>
            <button
              type="button"
              className="primary"
              onClick={() => void install(missing)}
            >
              Install Relay there
            </button>
          </div>
        )
      )}
      {!!error && <ErrorBox error={error} />}
    </div>
  );
}
