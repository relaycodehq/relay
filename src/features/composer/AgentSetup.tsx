import { useEffect, useRef, useState } from "react";
import { Download, TerminalSquare } from "lucide-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cantRun,
  isUpdating,
  notLookedFor,
  type AgentVersion,
} from "../../../shared/agent-updates";
import {
  agentInfo,
  agentName,
  isCliProvider,
  type AgentProvider,
} from "../../../shared/agents";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import { api } from "../../lib/api";
import { openSettings } from "../../lib/settings-page";
import { usePoll } from "../../lib/poll";
import { Spinner } from "../../ui/ui";
import { InstallLog, plainOutput } from "../../ui/InstallLog";
import { useAgentSignIn, type SignInPlace } from "../sign-in/useAgentSignIn";
import { useAgentVersions } from "../updates/agent-updates";
import { ProviderIcon, type PickerSetup } from "../agents/ComposerModelPicker";
import "./agent-setup.css";

/** Why an agent can't run where the project does yet. */
type AgentSetup =
  /** The project's computer was paired again under a new identity, or removed. */
  | { kind: "unpaired" }
  | { kind: "unreachable" }
  | { kind: "missing"; reason: string; installable: boolean }
  | { kind: "installing"; queued: boolean; output?: string }
  | { kind: "failed"; message: string; output?: string }
  | { kind: "signed-out" };

type Computer = { id: string; name: string };

/** Agents whose CLI can say whether it's signed in. */
const saysSignedIn = (provider: AgentProvider) =>
  provider === "claude" || provider === "codex";

/** When Sign in was last pressed, by computer and agent: it watches for the login a while. */
const signInsStarted = new Map<string, number>();
/** Long enough to finish a login in the browser; a check every few seconds till then. */
const signInWatch = 5 * 60_000;

const lastLine = (output?: string) =>
  output && plainOutput(output).split("\n").filter(Boolean).at(-1);

/**
 * What the composer's model picker shows for an agent that can't run where
 * the project does (this computer, or the paired `computer`): a way to
 * install it or sign it in, instead of a Default that would only fail.
 * Installs go into Relay's own folder there; a sign-in is typed into the
 * thread's terminal there, for the user to run and finish in their browser,
 * so nothing crosses from this computer.
 */
export function useAgentSetup({
  provider,
  providers,
  computer,
  projectId,
  chatId,
  accountOf,
}: {
  /** The composer's agent, the one Relay looks for first on a computer that hasn't yet. */
  provider: AgentProvider | "message";
  /** The agents the picker offers. */
  providers: readonly AgentProvider[];
  computer?: Computer;
  projectId: string;
  chatId?: string;
  /** The thread's account per agent; only the CLI's usual one has a sign-in to check. */
  accountOf: (provider: AgentProvider) => string | undefined;
}): (provider: AgentProvider) => PickerSetup | undefined {
  const poll = usePoll();
  const qc = useQueryClient();
  const here = useAgentVersions();
  // The same list handoff keeps; asked here, as composer can't import handoff.
  const paired = useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    staleTime: 10_000,
    enabled: !!computer,
  });
  const unpaired =
    !!computer &&
    !!paired.data &&
    !paired.data.some((c) => c.id === computer.id);
  const versionsKey = ["agent-versions", computer?.id];
  const there = useQuery({
    queryKey: versionsKey,
    queryFn: async () => {
      const found = await api.agentVersions(computer!.id);
      // A Relay just started there hasn't looked for its agents yet: it looks now.
      const mine = found.agents.find((a) => a.provider === provider);
      return mine && notLookedFor(mine)
        ? api.checkAgentVersions(computer!.id)
        : found;
    },
    enabled: !!computer && !!paired.data && !unpaired,
    staleTime: 60_000,
    retry: false,
    // While one installs there, how it's going.
    refetchInterval: (query) =>
      poll(query.state.data?.agents.some(installing) ? 2000 : false),
  });
  const versions = computer ? there.data : here;
  const agentOf = (p: AgentProvider) =>
    versions?.agents.find((a) => a.provider === p);

  const where = computer?.id ?? "";
  const watchKey = (p: AgentProvider) => `${where}:${p}`;
  const watching = (p: AgentProvider) =>
    Date.now() - (signInsStarted.get(watchKey(p)) ?? 0) < signInWatch;
  const [, setStarted] = useState(0);
  const checked = providers.filter((p) => {
    const agent = agentOf(p);
    return (
      saysSignedIn(p) &&
      !!agent &&
      !cantRun(agent) &&
      // An extra account's sign-in isn't the one the CLI reports here.
      (!!computer || (accountOf(p) ?? SYSTEM_ACCOUNT) === SYSTEM_ACCOUNT)
    );
  });
  const signedInKey = (p: AgentProvider) => ["agent-signed-in", where, p];
  const signedIn = useQueries({
    queries: checked.map((p) => ({
      queryKey: signedInKey(p),
      // A computer from before it could say answers with an error: no panel.
      queryFn: () => api.agentSignedIn(p, computer?.id),
      staleTime: 60_000,
      retry: false,
      refetchInterval: (query: { state: { data?: boolean | null } }) =>
        poll(query.state.data === false && watching(p) ? 3000 : false),
    })),
  });

  function setupOf(p: AgentProvider): AgentSetup | undefined {
    if (unpaired) return { kind: "unpaired" };
    if (computer && there.isError) return { kind: "unreachable" };
    const agent = agentOf(p);
    if (!agent) return;
    const update = agent.update;
    if (installing(agent))
      return {
        kind: "installing",
        queued: update?.status === "queued",
        output: update?.status === "running" ? update.output : undefined,
      };
    if (update?.status === "failed" && !agent.path)
      return { kind: "failed", message: update.message, output: update.output };
    const reason = cantRun(agent, computer?.name);
    if (reason)
      return {
        kind: "missing",
        reason,
        installable: isCliProvider(p) && !agent.path,
      };
    const i = checked.indexOf(p);
    if (i >= 0 && signedIn[i]?.data === false) return { kind: "signed-out" };
  }

  // An agent that just became usable lists its models: the ones that failed
  // while it was missing or signed out ask again.
  const ready = providers.filter((p) => versions && !setupOf(p));
  const wasReady = useRef<string[]>(undefined);
  useEffect(() => {
    if (!versions) return;
    const before = wasReady.current;
    wasReady.current = ready;
    if (!before || ready.every((p) => before.includes(p))) return;
    void qc.invalidateQueries({
      predicate: (q) =>
        ((q.queryKey[0] === "agent-models" && q.queryKey[2] === computer?.id) ||
          (q.queryKey[0] === "codex-models" &&
            q.queryKey[1] === computer?.id)) &&
        q.state.status === "error",
    });
  }, [ready.join(), qc, computer?.id]);

  const actions: SetupActions = {
    async install(p) {
      try {
        if (!computer) await api.installAgent(p);
        else
          qc.setQueryData(versionsKey, await api.installAgent(p, computer.id));
      } catch {
        if (computer) await there.refetch();
      }
    },
    async checkAgain(p) {
      try {
        const next = await api.checkAgentVersions(computer?.id);
        if (computer) qc.setQueryData(versionsKey, next);
      } catch {
        if (computer) await there.refetch();
        await paired.refetch();
      }
      await qc.refetchQueries({ queryKey: signedInKey(p) });
    },
    async stillSignedOut(p) {
      const status = await qc.query({
        queryKey: signedInKey(p),
        queryFn: () => api.agentSignedIn(p, computer?.id),
        staleTime: 0,
      });
      return status === false;
    },
    watch(p) {
      signInsStarted.set(watchKey(p), Date.now());
      setStarted(Date.now());
    },
  };

  return (p) => {
    const setup = setupOf(p);
    if (!setup) return;
    const name = agentName(p);
    return {
      label:
        setup.kind === "unpaired"
          ? `${computer!.name} isn't paired`
          : setup.kind === "unreachable"
            ? `Can't reach ${computer!.name}`
            : setup.kind === "installing"
              ? `Installing ${name}…`
              : setup.kind === "signed-out"
                ? `Sign in to ${name}`
                : `Set up ${name}`,
      busy: setup.kind === "installing",
      missing:
        (setup.kind === "missing" && setup.installable) ||
        setup.kind === "failed",
      panel: (close) => (
        <AgentSetupPanel
          key={`${p}:${setup.kind}`}
          provider={p}
          setup={setup}
          computer={computer}
          place={{ projectId, chatId, computer }}
          watching={watching(p)}
          actions={actions}
          close={close}
        />
      ),
    };
  };
}

const installing = (agent: AgentVersion) => isUpdating(agent) && !agent.path;

interface SetupActions {
  install: (p: AgentProvider) => Promise<void>;
  checkAgain: (p: AgentProvider) => Promise<void>;
  /** Asks again, so one signed in some other way meanwhile isn't sent to the terminal. */
  stillSignedOut: (p: AgentProvider) => Promise<boolean>;
  /** Its sign-in is under way: looks every few seconds for a while. */
  watch: (p: AgentProvider) => void;
}

function AgentSetupPanel({
  provider,
  setup,
  computer,
  place,
  watching,
  actions,
  close,
}: {
  provider: AgentProvider;
  setup: AgentSetup;
  computer?: Computer;
  place: SignInPlace;
  watching: boolean;
  actions: SetupActions;
  /** Closes the picker, so the terminal the sign-in went to shows. */
  close: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const signIn = useAgentSignIn(provider, place);
  const opening = signIn.state === "waiting";
  const { cli } = agentInfo(provider);
  const name = agentName(provider);
  const on = computer ? `on ${computer.name}` : "on this computer";
  const checkAgain = (
    <button
      type="button"
      className="text-button"
      disabled={checking}
      onClick={() => {
        setChecking(true);
        void actions.checkAgain(provider).finally(() => setChecking(false));
      }}
    >
      {checking ? "Checking…" : "Check again"}
    </button>
  );
  const glyph = (
    <span className="agent-setup-glyph">
      <ProviderIcon provider={provider} />
    </span>
  );

  switch (setup.kind) {
    case "unpaired":
      return (
        <div className="agent-setup">
          <h3>{computer!.name} isn't paired anymore</h3>
          <p>
            So this project can't run there. Pair it again, or add the project
            from where it is now.
          </p>
          <div className="agent-setup-actions">
            <button
              type="button"
              className="primary"
              onClick={() => openSettings("computers")}
            >
              Computers
            </button>
          </div>
        </div>
      );
    case "unreachable":
      return (
        <div className="agent-setup">
          <h3>Couldn't reach {computer!.name}</h3>
          <p>
            Relay couldn't ask it which agents it has. It may be asleep or
            offline.
          </p>
          <div className="agent-setup-actions">{checkAgain}</div>
        </div>
      );
    case "missing":
      return (
        <div className="agent-setup">
          {glyph}
          <h3>
            {setup.installable
              ? `${cli} isn't ${on}`
              : `${name} can't run ${on}`}
          </h3>
          <p>
            {setup.installable
              ? `Install it to run ${name} threads here. Relay${computer ? ` on ${computer.name}` : ""} puts it in its own folder.`
              : setup.reason}
          </p>
          <div className="agent-setup-actions">
            {setup.installable ? (
              <button
                type="button"
                className="primary"
                onClick={() => void actions.install(provider)}
              >
                <Download size={14} aria-hidden />
                {computer ? `Install on ${computer.name}` : "Install"}
              </button>
            ) : (
              !computer && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => openSettings("agents")}
                >
                  Set up in Settings
                </button>
              )
            )}
            {checkAgain}
          </div>
        </div>
      );
    case "installing": {
      const line = lastLine(setup.output);
      return (
        <div className="agent-setup">
          {glyph}
          <h3>
            Installing {cli} {on}
          </h3>
          <p className="agent-setup-progress" role="status">
            <Spinner size={12} steady />
            <span>
              {setup.queued
                ? "Waiting for another agent's install to finish"
                : (line ?? "Starting…")}
            </span>
          </p>
          {setup.output && (
            <div className="agent-setup-actions">
              <span className="agent-setup-log">
                <InstallLog output={setup.output} />
              </span>
            </div>
          )}
        </div>
      );
    }
    case "failed":
      return (
        <div className="agent-setup">
          {glyph}
          <h3>
            Couldn't install {cli} {on}
          </h3>
          <p>{setup.message}</p>
          <div className="agent-setup-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void actions.install(provider)}
            >
              Try again
            </button>
            {setup.output && (
              <span className="agent-setup-log">
                <InstallLog output={setup.output} />
              </span>
            )}
          </div>
        </div>
      );
    case "signed-out":
      return (
        <div className="agent-setup">
          {glyph}
          <h3>
            Sign in to {name}
            {computer ? ` on ${computer.name}` : ""}
          </h3>
          <p>
            {cli} is installed {on} but not signed in, so it can't list its
            models or run.
          </p>
          <div className="agent-setup-actions">
            <button
              type="button"
              className="primary"
              disabled={opening}
              onClick={async () => {
                // Signed in some other way meanwhile: nothing to type.
                if (!(await actions.stillSignedOut(provider))) return;
                if (!(await signIn.start())) return;
                actions.watch(provider);
                close();
              }}
            >
              {opening ? (
                <Spinner size={14} steady />
              ) : (
                <TerminalSquare size={14} aria-hidden />
              )}
              {opening
                ? "Opening the terminal…"
                : computer
                  ? `Sign in on ${computer.name}`
                  : "Sign in"}
            </button>
            {watching && checkAgain}
          </div>
          <p
            className="agent-setup-hint"
            role={signIn.hint ? "alert" : undefined}
          >
            {signIn.hint ??
              (computer
                ? `Opens the thread's terminal on ${computer.name} with the sign-in typed in. You finish it in your browser; the login stays on ${computer.name}.`
                : "Opens the thread's terminal with the sign-in typed in, for you to run.")}
          </p>
        </div>
      );
  }
}
