import { Alert } from "react-native";
import { Unanswered } from "../../../shared/remote-client";

/**
 * Says an action failed, unless its request went out and only the answer
 * didn't come back: the computer may still do it, so `unsure` says that
 * instead of a flat failure.
 */
export function alertFailure(e: unknown, failed: string, unsure?: string) {
  const why = e instanceof Error ? e.message : String(e);
  if (unsure && e instanceof Unanswered)
    Alert.alert(
      unsure,
      `${why} The request went out, so it may still happen once the computer answers.`,
    );
  else Alert.alert(failed, why);
}
