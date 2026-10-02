import type { Fetch } from "./client";

/**
 * Asks OpenRouter's System One `model` the `questions` about `state`, giving
 * each answered question's yes-probability. A busy OpenRouter is asked
 * again, up to three times in all.
 */
export async function askSystemOne(
  fetch: Fetch,
  key: string,
  model: string,
  state: unknown,
  questions: Record<string, unknown>,
) {
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch("https://openrouter.ai/api/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, state, questions }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("OpenRouter could not be reached.");
    }
    if ((res.status !== 429 && res.status !== 529) || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  if (!res!.ok) {
    const body = (await res!.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      res!.status === 401
        ? "OpenRouter rejected the API key."
        : `Filter failed: ${body?.error?.message ?? res!.status}`,
    );
  }
  const body = (await res!.json()) as {
    answers?: Record<string, { type: string; noul?: number }>;
  };
  return Object.fromEntries(
    Object.entries(body.answers ?? {})
      .filter(
        ([, a]) => typeof a.noul === "number" && a.noul >= 0 && a.noul <= 1,
      )
      .map(([k, a]) => [k, a.noul!]),
  );
}
