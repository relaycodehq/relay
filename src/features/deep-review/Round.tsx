import type { DeepReviewState } from "../../../shared/deep-review";
import type { PublishedReport } from "../../../shared/findings";
import type { ChatMessage } from "../../../shared/projects";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { DeepReviewCouncil } from "./Council";
import { leadStoppedLast } from "./lead-halted";
import { DeepReviewRequest } from "./Request";

/** One round of a deep review where it was asked for: the request, then its reviewers. */
export function ReviewRound({
  message,
  state,
  latest,
  lead,
  messages,
  reportUnder,
  onResume,
  onStop,
  onStopMember,
  onResumeMember,
  onLead,
  ...council
}: {
  message: ChatMessage;
  state: DeepReviewState;
  /** Only the thread's latest round still runs or can be picked back up. */
  latest: boolean;
  /** The lead's first answer to this round, once there is one. */
  lead: ChatMessage | undefined;
  messages: ChatMessage[];
  reportUnder: (messageId: string) => PublishedReport | undefined;
  busy: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onResume: () => void;
  onStop: () => void;
  onStopMember: (slot: number) => void;
  onResumeMember: (slot: number) => void;
  onLead: () => void;
}) {
  return (
    <>
      <DeepReviewRequest message={message} state={state} />
      <DeepReviewCouncil
        {...council}
        state={state}
        kept={lead && reportUnder(lead.id)?.findings.length}
        hasLead={!!lead}
        leadHalted={
          latest && leadStoppedLast(messages, state.leadStopped ?? lead?.id)
        }
        {...(latest
          ? { onResume, onStop, onStopMember, onResumeMember, onLead }
          : {})}
      />
    </>
  );
}
