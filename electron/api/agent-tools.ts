import { homedir } from "node:os";
import { agentProviderSchema } from "../../shared/agents";
import { agentToolsBridge } from "../../shared/remote";
import { idSchema } from "../../shared/validation";
import { agentRuntime } from "../agents";
import { inspectAgentTools } from "../agents/tools";
import { takes, type ApiContext, type Handlers } from "./context";

export function agentToolHandlers(ctx: ApiContext) {
  return {
    agentTools: takes(
      [idSchema.nullable(), agentProviderSchema, idSchema.optional()],
      async (projectId, provider, computerId) => {
        if (computerId) {
          const handoffs = ctx.handoffs();
          if (!handoffs) throw new Error("Relay is still starting.");
          const target = await handoffs.sender.targetOn(
            computerId,
            projectId,
            agentToolsBridge,
          );
          if (target.problem) throw new Error(target.problem);
          if (projectId && !target.project)
            throw new Error(
              "This project could not be found on the selected computer.",
            );
          const client = await handoffs.computers.connected(computerId);
          // Do not forward computerId: the selected computer inspects its own configuration.
          return client.desktop(
            "agentTools",
            target.project?.id ?? null,
            provider,
          );
        }
        const root = projectId ? await ctx.projects.root(projectId) : undefined;
        const runtime = agentRuntime(provider);
        return inspectAgentTools(provider, root, async () =>
          runtime.knownCommands?.(root ?? homedir()),
        );
      },
    ),
  } satisfies Handlers;
}
