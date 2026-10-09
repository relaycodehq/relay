import { homedir } from "node:os";
import { withTimeout } from "../../util/timeout";
import type { AcpProfile } from "./profiles";
import { acquireAcpAgent } from "./sessions";

/** As long as Antigravity itself waits for the browser. */
const signInTimeout = 5 * 60_000;

/**
 * Has the agent sign in the way it does without a terminal, in a process of
 * its own: Antigravity opens Google's page in the browser and answers once the
 * user is through. Rejects when it can't, or the sign-in didn't finish.
 */
export async function signInAcp(profile: AcpProfile) {
  await profile.setUp?.();
  const wanted = await profile.authMethod?.();
  const agent = await acquireAcpAgent(profile, undefined, homedir());
  try {
    // Without a choice of Relay's, the first sign-in the agent offers.
    const method = wanted ?? agent.caps?.auth[0];
    if (!method || !agent.caps?.auth.includes(method))
      throw new Error(
        `${profile.name} can't sign in from Relay. Sign in with its CLI in a terminal.`,
      );
    await withTimeout(
      agent.connection.request("authenticate", { methodId: method }),
      signInTimeout,
      `Signing in to ${profile.name} didn't finish in time.`,
    );
  } finally {
    agent.close();
  }
}

/** Signs the agent out through ACP's `logout`, for agents that answer it. */
export async function signOutAcp(profile: AcpProfile) {
  const agent = await acquireAcpAgent(profile, undefined, homedir());
  try {
    if (!agent.caps?.logout)
      throw new Error(`${profile.name} can't sign out from Relay.`);
    await withTimeout(
      agent.connection.request("logout", {}),
      30_000,
      `Signing out of ${profile.name} didn't finish in time.`,
    );
  } finally {
    agent.close();
  }
}
