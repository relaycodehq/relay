import type { Bootstrap } from "../../shared/types";
import { api } from "../lib/api";
import type { SignInFlow } from "../lib/useSignIn";
import { SignIn } from "./SignIn";
import { Modal } from "./ui";

/** The Gitea sign-in form, which also waits out the Keychain's saved login. */
export function SignInDialog({
  boot,
  signIn,
  invitationUrl,
  onRestored,
}: {
  boot: Bootstrap;
  signIn: SignInFlow;
  /** The link that asked for an account, whose server the form takes up. */
  invitationUrl?: string;
  /** Reads the bootstrap again once the saved login is retried or given up. */
  onRestored: () => Promise<unknown>;
}) {
  return (
    <Modal
      title="Gitea account"
      className="project-signin"
      onClose={signIn.cancel}
    >
      <SignIn
        onConnected={signIn.connected}
        loginRestore={boot.loginRestore}
        savedServer={boot.savedServer}
        invitationUrl={invitationUrl}
        platform={boot.platform}
        onRestoreAction={async (action) => {
          if (action === "retry") await api.retryLoginRestore();
          else await api.cancelLoginRestore();
          await onRestored();
        }}
      />
    </Modal>
  );
}
