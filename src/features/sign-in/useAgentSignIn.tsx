import { useState, type ReactNode } from "react";
import type { AgentProvider } from "../../../shared/agents";
import { errorMessage } from "../../../shared/error-message";
import { prefillSignIn } from "../terminal/thread-terminals";
import { signInAgent } from "../updates/agent-updates";
import { OpenCodeSignIn } from "./OpenCodeSignIn";
import { signInOffer } from "./sign-in-offer";

/** Where the agent runs that signs in. */
export interface SignInPlace {
  /** The thread whose terminal a login is typed into; none in Settings. */
  projectId?: string;
  chatId?: string | null;
  /** The paired computer the project lives on: its terminal, its login. */
  computer?: { id: string; name: string };
  /** The folder OpenCode's providers are connected for. */
  directory?: string;
}

/**
 * Signing a signed-out agent in, the same way wherever it's offered: its own
 * login typed into the thread's terminal, Relay's browser sign-in, or
 * OpenCode's dialog. `start` resolves true once it's under way or done;
 * render `dialog` and show `hint` beside the button.
 */
export function useAgentSignIn(provider: AgentProvider, place: SignInPlace) {
  const offer = signInOffer(provider, { away: !!place.computer });
  const [state, setState] = useState<
    "idle" | "waiting" | "busy" | "manual" | "failed"
  >("idle");
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState(false);

  async function start() {
    if (!offer) return false;
    if (offer.via === "opencode") {
      setDialog(true);
      return true;
    }
    // No thread, as in Settings: no terminal to type it into.
    if (offer.via === "terminal" && !place.projectId) {
      setState("manual");
      return false;
    }
    setState("waiting");
    setError(undefined);
    try {
      if (offer.via === "relay") await signInAgent(provider);
      else if (
        !(await prefillSignIn(place.projectId!, place.chatId ?? null, provider))
      ) {
        setState("busy");
        return false;
      }
      setState("idle");
      return true;
    } catch (e) {
      setError(errorMessage(e));
      setState(offer.via === "relay" ? "failed" : "busy");
      return false;
    }
  }

  let hint: ReactNode;
  if (state === "waiting" && offer?.via === "relay")
    hint = "Finish signing in in your browser.";
  else if (state === "busy" && offer?.via === "terminal")
    hint = (
      <>
        Couldn't type the sign-in into the terminal; a command may still be
        running there. Run <code>{offer.command}</code> there once it's free.
      </>
    );
  else if (state === "manual" && offer?.via === "terminal")
    hint = (
      <>
        Run <code>{offer.command}</code> in a terminal to sign in.
      </>
    );
  else if (state === "failed")
    hint = error
      ? `Signing in didn't finish: ${error}`
      : "Signing in didn't finish. Try again.";

  return {
    offer,
    /** "waiting" while the terminal opens or the browser sign-in runs. */
    state,
    start,
    hint,
    dialog: dialog && (
      <OpenCodeSignIn
        directory={place.directory}
        onClose={() => setDialog(false)}
      />
    ),
  };
}
