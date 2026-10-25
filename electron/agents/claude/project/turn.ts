import { randomUUID } from "node:crypto";
import { findExecutable } from "../../../platform/executables";
import { runAccount } from "../../accounts";
import {
  sessionConfig,
  sessionSignature,
  type ClaudeRunOptions,
} from "./config";
import { ClaudeTurnReader } from "./reader";
import { claudeImages } from "./sdk";
import { pickableClaudeSkills } from "./catalog";
import { planSkillDispatch } from "../../skill-dispatch";
import { mayMentionSkill } from "../../../../shared/skill-mentions";
import { claudeArgs } from "../../../../shared/settings";
import { guardSteer } from "../../turn-kit";
import {
  closeSession,
  newSession,
  retune,
  sessions,
  setOptions,
  startSession,
} from "./session";
import {
  adopt,
  release,
  settled,
  type ClaudeFrames,
  type ClaudeTurn,
} from "./stream";

export async function runClaudeProject(
  options: ClaudeRunOptions,
): Promise<string> {
  const executable = await findExecutable("claude");
  options.signal.throwIfAborted();
  // Another account is another session: its Claude Code signs in elsewhere.
  const account = await runAccount("claude", options.account);
  options = { ...options, account: account.id };
  const key = options.session?.key;
  const signature = sessionSignature(options);
  let session = key ? sessions.get(key) : undefined;
  const adopting = options.job.kind === "adopt",
    compacting = options.job.kind === "compact";
  let turn: ClaudeTurn;
  if (adopting) {
    turn = adopt(session);
  } else {
    // A turn Claude started itself finishes first, so neither answer lands under the other.
    while (session?.unprompted) {
      await settled(session.unprompted, options.signal);
      session = key ? sessions.get(key) : undefined;
    }
    if (session?.busy)
      throw new Error("This Claude session is already running a turn.");
    // New settings mean a new session, unless Claude still has work running
    // in this one that a restart would end.
    const working = !!session && session.work.any;
    if (
      session &&
      !session.frames.ended &&
      session.signature !== signature &&
      working &&
      (await retune(session, options))
    )
      session.signature = signature;
    if (session && (session.signature !== signature || session.frames.ended)) {
      closeSession(session);
      sessions.delete(key!);
      session = undefined;
    }
    turn = { unprompted: false };
  }
  let succeeded = false;
  // Past the last frame this turn read from the host's log.
  let consumed: number | undefined;
  const controller = session?.controller ?? new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    if (!session) {
      // SDK callbacks outlive a turn. Resolve them against the current local request broker.
      const holder = newSession(options, signature, controller);
      const config = sessionConfig(
        options,
        executable,
        holder.skipsPermissions,
        account.env,
      );
      holder.turn = turn;
      await startSession(holder, config, key);
      session = holder;
      if (key) sessions.set(key, session);
    }
    const reader = new ClaudeTurnReader(options, session);
    setOptions(session, options);
    // The host's log marks the turn, so a restart knows what to show again.
    if (adopting) session.hosted?.mark("start", turn.from);
    session.plan = "";
    session.busy = true;
    const [images, dispatch] = await Promise.all([
      claudeImages(options.images),
      compacting
        ? undefined
        : skillDispatch(
            options.prompt,
            options.cwd,
            account.id,
            options.request,
          ),
    ]);
    options.signal.throwIfAborted();
    if (compacting && !session.threadId && !options.session?.id)
      throw new Error("There is no Claude session to compact yet.");
    if (!adopting) {
      // Claim the stream as the prompt goes out; a turn Claude began meanwhile
      // finishes first. Nothing may await between the check and the claim.
      while (session.unprompted)
        await settled(session.unprompted, options.signal);
      session.turn = turn;
      session.hosted?.mark("start");
      session.input.push({
        type: "user",
        uuid: reader.prompt.uuid,
        session_id: session.threadId ?? "",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: compacting
            ? `/compact ${options.prompt}`.trim()
            : userContent(options.prompt, images, dispatch),
        },
      });
    }
    if (!compacting)
      options.onControl?.({
        steer: (text, id, steerImages, request) =>
          guardSteer(
            () => reader.steerable && !options.signal.aborted,
            () =>
              Promise.all([
                claudeImages(steerImages),
                skillDispatch(text, options.cwd, account.id, request),
              ]),
            ([attached, dispatch]) => {
              const uuid = randomUUID();
              reader.track(uuid, id);
              // "now" cuts Claude off mid-reply or mid-tool, running tools
              // included, and has it answer this message right away.
              session!.input.push({
                type: "user",
                uuid,
                session_id: session!.threadId ?? "",
                parent_tool_use_id: null,
                message: {
                  role: "user",
                  content:
                    attached.length || dispatch
                      ? userContent(text, attached, dispatch)
                      : text,
                },
                priority: "now",
              });
            },
          ),
        retune: async (choice) => {
          const tuned = { ...session!.options, ...claudeArgs(choice), choice };
          // Kept with the session, so the next turn on these settings reuses it.
          if (!(await retune(session!, tuned))) return false;
          session!.options = tuned;
          session!.signature = sessionSignature(tuned);
          return true;
        },
      });
    while (true) {
      const message = await session.frames.next();
      const seq = message && session.hosted?.seqOf(message);
      if (seq !== undefined) consumed = seq + 1;
      if (!message)
        throw new Error(
          session.frames.failure
            ? `Claude stopped before completing this turn: ${session.frames.failure.slice(0, 500)}`
            : "Claude stopped before completing this turn.",
        );
      if (
        "session_id" in message &&
        message.session_id &&
        message.session_id !== session.threadId
      ) {
        session.threadId = message.session_id;
        await options.session?.onId(message.session_id);
      }
      const verdict = reader.read(message);
      // A result read past, like the one a steer cut short, is over: a
      // restart shows the turn from after it.
      if (message.type === "result" && typeof verdict === "string")
        session.hosted?.mark("start", consumed);
      if (verdict === "more") continue;
      if (verdict === "follow-up") {
        if (await startsFollowUp(session.frames)) {
          reader.followUp();
          continue;
        }
        succeeded = true;
        return reader.text;
      }
      succeeded = true;
      return verdict.answer;
    }
  } finally {
    options.signal.removeEventListener("abort", abort);
    if (session) {
      session.busy = false;
      if (!key || !succeeded || options.signal.aborted) {
        closeSession(session);
        if (key) sessions.delete(key);
      } else if (session.turn === turn) {
        session.hosted?.mark("end", consumed);
        release(session);
      }
    }
  }
}

/**
 * For CLIs that don't report steering progress: a steer that arrives after
 * Claude's last step can't fold into the turn, so Claude runs it as its own
 * turn right after the result. That turn opens with an init frame at once; a
 * quiet stream means every steer was folded in. Anything else is left for
 * whatever Claude does next.
 */
async function startsFollowUp(frames: ClaudeFrames) {
  if (!(await frames.wait(2000))) return false;
  const first = frames.peek();
  return first?.type === "system" && first.subtype === "init";
}

function userContent(
  text: string,
  images: Awaited<ReturnType<typeof claudeImages>>,
  dispatch: ReturnType<typeof planSkillDispatch>,
) {
  if (!dispatch)
    return [
      // A screenshot sent alone has no text; the API refuses an empty block.
      ...(text ? [{ type: "text" as const, text }] : []),
      ...images,
    ];
  return [
    ...(dispatch.lead ? [{ type: "text" as const, text: dispatch.lead }] : []),
    // A command block followed by an image doesn't expand.
    ...images,
    { type: "text" as const, text: dispatch.command },
  ];
}

/** A `$skill` in the prompt, laid out so Claude runs it; undefined sends the prompt as it is. */
async function skillDispatch(
  prompt: string,
  cwd: string,
  account: string,
  request?: string,
) {
  if (!mayMentionSkill(request ?? prompt)) return undefined;
  const skills = await pickableClaudeSkills(cwd, account).catch(
    () => new Set<string>(),
  );
  return planSkillDispatch(prompt, skills, request);
}
