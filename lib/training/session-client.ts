import type { WorkoutSession } from './session'

type FetchSession = (url: string, init?: RequestInit) => Promise<Response>
export class SessionConflict extends Error {}

// A write receipt proves the original commit, not the session's current revision.
// Keep POST replay semantics intact and reconcile through the authenticated read.
export async function confirmStartedWorkout(fetchSession: FetchSession, workoutId: string, command: unknown): Promise<WorkoutSession> {
  const response = await fetchSession('/api/training/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
  })
  if (response.status === 409) throw new SessionConflict('Reload the changed plan or session')
  if (!response.ok) throw new Error('Write could not be confirmed')
  const receipt = await response.json()
  if (!receipt.workout?.id || !Number.isInteger(receipt.workout.revision)) throw new Error('Invalid write receipt')
  const read = await fetchSession('/api/training/session?workout=' + workoutId, { cache: 'no-store' })
  if (!read.ok) throw new Error('Current session could not be confirmed')
  const { workout } = await read.json()
  if (!workout || workout.id !== receipt.workout.id || !Number.isInteger(workout.revision) ||
    workout.revision < receipt.workout.revision || !['in_progress', 'completed'].includes(workout.status)) {
    throw new Error('Current session could not be confirmed')
  }
  return workout
}
