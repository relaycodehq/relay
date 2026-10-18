import { homedir } from "node:os";
import { agentProviderSchema } from "../../shared/agents";
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
          const client = await handoffs.computers.connected(computerId);
          let remoteProject: string | null = null;
          if (projectId) {
            const target = (await handoffs.sender.startTargets(projectId)).find(
              (t) => t.id === computerId,
            );
            if (!target?.project)
              throw new Error(
                target?.problem ||
                  "This project could not be found on the selected computer.",
              );
            remoteProject = target.project.id;
          }
          // Do not forward computerId: the selected computer inspects its own configuration.
          return client.desktop("agentTools", remoteProject, provider);
        }
        const root = projectId ? await ctx.projects.root(projectId) : undefined;
        return inspectAgentTools(provider, root, () =>
          agentRuntime(provider).commands(root ?? homedir()),
        );
      },
    ),
  } satisfies Handlers;
}
