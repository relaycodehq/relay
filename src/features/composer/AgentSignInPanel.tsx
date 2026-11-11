import type { ReactNode } from "react";
import { LogIn, TerminalSquare } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  agentInfo,
  agentName,
  type AgentProvider,
} from "../../../shared/agents";
import { Spinner } from "../../ui/ui";
import { useAgentSignIn, type SignInPlace } from "../sign-in/useAgentSignIn";
import { ProviderIcon } from "../agents/ComposerModelPicker";

/** The model picker's panel for an agent that's installed where the project runs but signed out. */
export function AgentSignInPanel({
  provider,
  computer,
  place,
  checkAgain,
  stillSignedOut,
  onStarted,
  close,
}: {
  provider: AgentProvider;
  computer?: { id: string; name: string };
  place: SignInPlace;
  /** Shown once a terminal sign-in is under way, to look before the next poll. */
  checkAgain?: ReactNode;
  /** Asks again, so one signed in some other way meanwhile isn't sent to the terminal. */
  stillSignedOut: () => Promise<boolean>;
  onStarted: () => void;
  /** Closes the picker, so the terminal the sign-in went to shows. */
  close: () => void;
}) {
  const qc = useQueryClient();
  const signIn = useAgentSignIn(provider, place);
  const opening = signIn.state === "waiting";
  const inBrowser = signIn.offer?.via === "relay";
  const { cli } = agentInfo(provider);
  const name = agentName(provider);
  const on = computer ? `on ${computer.name}` : "on this computer";

  async function start() {
    // Signed in some other way meanwhile: nothing to type.
    if (!(await stillSignedOut())) return;
    if (!(await signIn.start())) return;
    // Relay's own sign-in is done once it resolves; the models it couldn't list can come now.
    if (inBrowser)
      void qc.invalidateQueries({ queryKey: ["agent-models", provider] });
    onStarted();
    close();
  }

  return (
    <div className="agent-setup">
      <span className="agent-setup-glyph">
        <ProviderIcon provider={provider} />
      </span>
      <h3>
        Sign in to {name}
        {computer ? ` on ${computer.name}` : ""}
      </h3>
      <p>
        {cli} is installed {on} but not signed in, so it can't list its models
        or run.
      </p>
      <div className="agent-setup-actions">
        <button
          type="button"
          className="primary"
          disabled={opening}
          onClick={() => void start()}
        >
          <SignInIcon opening={opening} inBrowser={inBrowser} />
          {signInLabel({ opening, inBrowser, computer })}
        </button>
        {checkAgain}
      </div>
      <p className="agent-setup-hint" role={signIn.hint ? "alert" : undefined}>
        {signIn.hint ?? signInHint({ inBrowser, name, computer })}
      </p>
    </div>
  );
}

function SignInIcon({
  opening,
  inBrowser,
}: {
  opening: boolean;
  inBrowser: boolean;
}) {
  if (opening) return <Spinner size={14} steady />;
  if (inBrowser) return <LogIn size={14} aria-hidden />;
  return <TerminalSquare size={14} aria-hidden />;
}

function signInLabel({
  opening,
  inBrowser,
  computer,
}: {
  opening: boolean;
  inBrowser: boolean;
  computer?: { name: string };
}) {
  if (opening) return inBrowser ? "Signing in…" : "Opening the terminal…";
  return computer ? `Sign in on ${computer.name}` : "Sign in";
}

function signInHint({
  inBrowser,
  name,
  computer,
}: {
  inBrowser: boolean;
  name: string;
  computer?: { name: string };
}) {
  if (inBrowser) return `Opens ${name}'s sign-in in your browser.`;
  if (computer)
    return `Opens the thread's terminal on ${computer.name} with the sign-in typed in. You finish it in your browser; the login stays on ${computer.name}.`;
  return "Opens the thread's terminal with the sign-in typed in, for you to run.";
}
