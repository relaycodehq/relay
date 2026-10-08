import { request } from "node:http";
import type { ProjectTask } from "../../shared/tasks";

/** A bounded HTTP probe, so a database/debugger port is never chosen as a page. */
function http(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      { hostname: "localhost", port, path: "/", method: "HEAD" },
      (res) => {
        res.destroy();
        resolve(true);
      },
    );
    req.setTimeout(750, () => req.destroy());
    req.once("error", () => resolve(false));
    req.end();
  });
}

/** Select a live HTTP listener belonging to this folder; ambiguous servers require a port. */
export async function runningServerPorts(tasks: ProjectTask[]) {
  const ports = [...new Set(tasks.flatMap((task) => task.ports))];
  return (
    await Promise.all(
      ports.map(async (port) => ((await http(port)) ? port : undefined)),
    )
  ).filter((port): port is number => port !== undefined);
}

export async function runningServerPort(
  tasks: ProjectTask[],
  configured?: number,
) {
  const live = await runningServerPorts(tasks);
  if (configured && live.includes(configured)) return configured;
  return live.length === 1 ? live[0] : undefined;
}
