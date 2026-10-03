import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Account, Bootstrap } from "../../../shared/types";
import { api } from "../../lib/api";

export type SignInFlow = ReturnType<typeof useSignIn>;

/** Signing in to Gitea, through tea's login or the sign-in form, and out again. */
export function useSignIn(boot: Bootstrap | undefined) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  /** What asked for the sign-in form, to carry on once it connects. */
  const afterSignIn = useRef<() => unknown>(undefined);
  useEffect(() => {
    if (!boot?.account) return;
    setOpen(false);
    afterSignIn.current = undefined;
  }, [boot?.account?.id]);
  const connected = async (account: Account) => {
    const next = await api.bootstrap();
    qc.removeQueries({
      predicate: (q) =>
        !["bootstrap", "project-chat", "project-chats"].includes(
          String(q.queryKey[0]),
        ),
    });
    qc.setQueryData(["bootstrap"], { ...next, account });
    setOpen(false);
    const then = afterSignIn.current;
    afterSignIn.current = undefined;
    await then?.();
  };
  /**
   * Runs `then` signed in to Gitea: right away, through tea's login when it
   * has one, and only otherwise after the sign-in form.
   */
  async function withAccount(then?: () => unknown) {
    if (boot?.account) return then?.();
    // The form shows the Keychain wait; tea mustn't race the saved token.
    if (boot?.loginRestore !== "unlocking") {
      const logins = (await api.teaSetup().catch(() => null))?.logins ?? [];
      const saved = boot?.savedServer && new URL(boot.savedServer);
      const login =
        logins.find((l) => saved && new URL(l.url).host === saved.host) ??
        logins[0];
      // On failure the form offers the same login and shows why.
      const account =
        login && (await api.connectWithTea(login.name).catch(() => null));
      if (account) {
        afterSignIn.current = then;
        return connected(account);
      }
    }
    afterSignIn.current = then;
    setOpen(true);
  }
  return {
    /** The sign-in form shows. */
    open,
    withAccount,
    connected,
    cancel: () => {
      setOpen(false);
      afterSignIn.current = undefined;
    },
    async signOut() {
      await api.disconnect();
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "bootstrap" });
      qc.setQueryData(["bootstrap"], { ...boot, account: null });
    },
  };
}
