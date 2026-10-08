import { useEffect, useState } from "react";
import type { Bootstrap } from "../../shared/types";
import { isGithubPullUrl } from "../../shared/validation";
import { api } from "../lib/api";
import type { NavigationLock } from "../lib/navigation-lock";
import type { ShellNavigation } from "./useShellNavigation";
import type { SignInFlow } from "../features/settings/useSignIn";

/**
 * Links Relay is asked to open, at launch or later, which open the Pull
 * requests page. A link that comes while navigation is locked waits until
 * it's released.
 */
export function useIncomingLinks(
  boot: Bootstrap | undefined,
  { inbox, setInbox }: Pick<ShellNavigation, "inbox" | "setInbox">,
  signIn: SignInFlow,
  lock: NavigationLock,
  setError: (error: unknown) => void,
) {
  const [incoming, setIncoming] = useState<{ url: string }>(),
    [queuedUrl, setQueuedUrl] = useState<string>();
  useEffect(() => {
    // The page took its link when it opened; coming back mustn't open it again.
    if (!inbox) setIncoming(undefined);
  }, [inbox]);
  function openUrl(url: string) {
    if (lock.blocked("Your link will open afterward.")) {
      setQueuedUrl(url);
      return;
    }
    setIncoming({ url });
    setInbox(true);
    // GitHub links go through the `gh` login; only Gitea needs signing in here.
    if (!boot?.account && boot?.gitea && !isGithubPullUrl(url))
      void signIn.withAccount();
  }
  useEffect(() => api.onOpenUrl(openUrl), [boot?.account, boot?.gitea]);
  useEffect(() => {
    if (!lock.locked && queuedUrl) {
      setQueuedUrl(undefined);
      setError(undefined);
      openUrl(queuedUrl);
    }
  }, [lock.locked, queuedUrl]);
  useEffect(() => {
    if (boot?.pendingUrl) openUrl(boot.pendingUrl);
  }, [boot?.pendingUrl]);
  return {
    /** The link the Pull requests page opens on. */
    incoming,
  };
}
