import { z } from "zod";
import { secondOpinionAgentSchema } from "../../shared/second-opinion";
import { idSchema } from "../../shared/validation";
import { SecondOpinions } from "../started-threads/second-opinions";
import { takes, type ApiContext, type Handlers } from "./context";

const messageIdSchema = z.string().min(1).max(200);

/** Another agent's second opinion on a thread's answer; see electron/started-threads. */
export function secondOpinionHandlers({ projectChats }: ApiContext) {
  const opinions = new SecondOpinions(projectChats);
  return {
    askSecondOpinion: takes(
      [idSchema, messageIdSchema, secondOpinionAgentSchema],
      (id, answerId, agent) => opinions.ask(id, answerId, agent),
    ),
    sendSecondOpinion: takes([idSchema], (id) => opinions.sendBack(id)),
  } satisfies Handlers;
}
