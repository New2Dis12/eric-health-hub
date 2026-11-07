import type { SessionResults } from "./logging-models";
export type PlayerFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
export class PlayerError extends Error {
  constructor(public kind: "conflict" | "access" | "failed") {
    super(kind);
  }
}
export async function loadPlayerResults(
  fetcher: PlayerFetch,
  sessionId: string,
): Promise<SessionResults> {
  // Offset pages must describe one revision, otherwise restart the bounded read.
  for (let attempt = 0; attempt < 3; attempt++) {
    let offset = 0;
    let result: SessionResults | undefined;
    const seen = new Set<number>();
    for (;;) {
      if (seen.has(offset)) throw new PlayerError("failed");
      seen.add(offset);
      const response = await fetcher(
        `/api/training/results?session=${sessionId}&limit=100&offset=${offset}`,
        { cache: "no-store" },
      );
      if ([401, 403, 404].includes(response.status))
        throw new PlayerError("access");
      if (!response.ok) throw new PlayerError("failed");
      const page = (await response.json()) as SessionResults;
      if (
        page.sessionId !== sessionId ||
        !Number.isInteger(page.sessionRevision) ||
        !Array.isArray(page.entries)
      )
        throw new PlayerError("failed");
      if (result && result.sessionRevision !== page.sessionRevision) break;
      result = result
        ? { ...page, entries: [...result.entries, ...page.entries] }
        : page;
      if (page.nextOffset === null) return result;
      if (
        !Number.isInteger(page.nextOffset) ||
        page.nextOffset <= offset ||
        page.nextOffset > 10000
      )
        throw new PlayerError("failed");
      offset = page.nextOffset;
    }
  }
  throw new PlayerError("conflict");
}
export async function savePlayerItem(
  fetcher: PlayerFetch,
  sessionId: string,
  command: unknown,
) {
  const response = await fetcher("/api/training/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (response.status === 409) throw new PlayerError("conflict");
  if ([401, 403, 404].includes(response.status))
    throw new PlayerError("access");
  if (!response.ok) throw new PlayerError("failed");
  const receipt = await response.json();
  const current = await loadPlayerResults(fetcher, sessionId);
  if (
    receipt.actualSessionId !== sessionId ||
    !Number.isInteger(receipt.sessionRevision) ||
    current.sessionRevision < receipt.sessionRevision
  )
    throw new PlayerError("failed");
  return current;
}
export function proposedReps(exercise: {
  reps: number | null;
  repsRange?: { min: number; max: number };
}) {
  return exercise.repsRange?.max ?? exercise.reps ?? null;
}
export const rpeOptions = Array.from({ length: 21 }, (_, i) => String(i / 2));
