import { parseRoomInvitation, roomProtocol } from "../../shared/rooms";

/**
 * Whether `url` invites you to a PR room rather than linking a PR. An older
 * invitation without a PR to open throws, as does a malformed URL.
 */
export function isRoomInvitation(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== roomProtocol + ":" &&
    !parsed.hash.startsWith("#join=")
  )
    return false;
  const invitation = parseRoomInvitation(url);
  if (!invitation.project || !invitation.number)
    throw new Error(
      "This older invitation has no PR target. Open its repository and paste the link into its PR room.",
    );
  return true;
}
