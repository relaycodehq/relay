import { useEffect, useState } from "react";
import { parseRoomInvitation } from "../../shared/rooms";
import type { Bootstrap } from "../../shared/types";
import { api } from "./api";
import type { NavigationLock } from "./navigation-lock";
import type { ShellNavigation } from "./useShellNavigation";
import type { SignInFlow } from "./useSignIn";

/**
 * Links Relay is asked to open, at launch or later: an invitation to a
 * conversation opens its dialog, anything else the Pull requests page. A
 * link that comes while navigating is held waits for the lock.
 */
export function useIncomingLinks(
  boot: Bootstrap | undefined,
  { inbox, setInbox }: Pick<ShellNavigation, "inbox" | "setInbox">,
  signIn: SignInFlow,
  lock: NavigationLock,
  setError: (error: unknown) => void,
) {
  const [incoming, setIncoming] = useState<{ url: string }>(),
    [queuedUrl, setQueuedUrl] = useState<string>(),
    [invitation, setInvitation] = useState<string>();
  useEffect(() => {
    // The page took its link when it opened; coming back mustn't open it again.
    if (!inbox) setIncoming(undefined);
  }, [inbox]);
  function openUrl(url: string) {
    if (lock.blocked("Your link will open afterward.")) {
      setQueuedUrl(url);
      return;
    }
    try {
      const invitation = url.includes("#join=")
        ? parseRoomInvitation(url)
        : null;
      if (invitation?.conversation) setInvitation(url);
      else {
        setIncoming({ url });
        setInbox(true);
      }
      if (!boot?.account) void signIn.withAccount();
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => api.onOpenUrl(openUrl), [boot?.account]);
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
    /** A conversation's invitation to join. */
    invitation,
    setInvitation,
  };
}
