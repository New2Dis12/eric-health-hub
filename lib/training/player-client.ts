import type { WorkoutSession } from './session'
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
// Mirror the existing server-side bounds before submitting a strength set.
export function validateStrengthDraft(reps: string, load: string): string | null {
  if (reps.trim() !== "") {
    const value = Number(reps);
    if (!Number.isInteger(value) || value < 0 || value > 500)
      return "Reps must be a whole number between 0 and 500.";
  }
  if (load.trim() !== "") {
    const value = Number(load);
    if (!Number.isFinite(value) || value < 0 || value > 2000)
      return "Load must be between 0 and 2,000 lb or kg.";
  }
  return null;
}
export const rpeOptions = Array.from({ length: 21 }, (_, i) => String(i / 2));

// Count only persisted strength entries. A prescribed but unlogged set is
// unknown, never performed/skipped/zero by inference.
export function completionSummary(workout: WorkoutSession, data: SessionResults) {
  const snapshot = workout.snapshot
  let prescribed = 0, recorded = 0
  for (const [index, exercise] of (snapshot?.exercises ?? []).entries()) {
    const isStrength = exercise.sets !== null &&
      (exercise.reps !== null || !!exercise.repsRange ||
        (snapshot?.kind === 'strength' && !exercise.intervalBlocks?.length))
    if (!isStrength || !exercise.sets) continue
    const occurrence = snapshot?.occurrences.find(o => o.exercise === index && o.type === 'exercise')
    prescribed += exercise.sets
    if (occurrence) recorded += new Set(data.entries.filter(e =>
      e.kind === 'strength_set' && e.occurrence_id === occurrence.id &&
      e.set_ordinal >= 1 && e.set_ordinal <= exercise.sets!).map(e => e.set_ordinal)).size
  }
  return { prescribed, recorded, unrecorded: prescribed - recorded, notes: data.notes }
}

// A lost POST response is ambiguous. Retry the exact same idempotency key;
// never infer that our write succeeded merely from another writer's completion.
export async function completePlayerWorkout(fetcher: PlayerFetch, sessionId: string, command: unknown) {
  let response: Response
  try {
    response = await fetcher('/api/training/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    })
  } catch { throw new PlayerError('failed') }
  if (response.status === 409) throw new PlayerError('conflict')
  if ([401, 403, 404].includes(response.status)) throw new PlayerError('access')
  if (!response.ok) throw new PlayerError('failed')
  let receipt: { actualSessionId?: string; sessionRevision?: number }
  try { receipt = await response.json() } catch { throw new PlayerError('failed') }
  if (receipt.actualSessionId !== sessionId || !Number.isInteger(receipt.sessionRevision))
    throw new PlayerError('failed')
  const current = await loadPlayerResults(fetcher, sessionId)
  if (current.status !== 'completed' || current.sessionRevision < receipt.sessionRevision!)
    throw new PlayerError('failed')
  return current
}
