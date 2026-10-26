import { useEffect, useState } from "react";
import { guestImportLink } from "../../shared/guest-share";
import type { Bootstrap } from "../../shared/types";
import { isSitePullUrl, parseAzurePullUrl } from "../../shared/validation";
import { api } from "../lib/api";
import type { NavigationLock } from "../lib/navigation-lock";
import type { ShellNavigation } from "./useShellNavigation";
import type { SignInFlow } from "../features/settings/useSignIn";

/**
 * Links Relay is asked to open, at launch or later: pull requests open the
 * Pull requests page, a shared thread asks where to carry it on. A link that
 * comes while navigation is locked waits until it's released.
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
    [guestLink, setGuestLink] = useState<string>();
  useEffect(() => {
    // The page took its link when it opened; coming back mustn't open it again.
    if (!inbox) setIncoming(undefined);
  }, [inbox]);
  function openUrl(url: string) {
    if (lock.blocked("Your link will open afterward.")) {
      setQueuedUrl(url);
      return;
    }
    // A shared thread to carry on here, from a guest page's button.
    const guest = guestImportLink(url);
    if (guest) return setGuestLink(guest);
    // One that isn't a guest page's link is no pull request either.
    if (/^relay:\/\/guest\b/i.test(url))
      return setError(new Error("That shared thread link can't be opened."));
    setIncoming({ url });
    setInbox(true);
    // GitHub and Azure DevOps links go through their CLI's login; only
    // Gitea needs signing in here.
    if (!boot?.account && boot?.gitea && !isSitePullUrl(url))
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
    /** The Azure DevOps organization the link is in, which no project may be. */
    azureServer: incoming && azureServerOf(incoming.url),
    /** A shared thread's link, asking which project to carry it on in. */
    guestLink,
    closeGuest: () => setGuestLink(undefined),
  };
}

function azureServerOf(url: string) {
  try {
    return parseAzurePullUrl(url).server;
  } catch {
    return undefined;
  }
}
