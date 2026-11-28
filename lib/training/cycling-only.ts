import type { SessionSnapshot } from './session'

/** Only pinned modality information determines which player and discovery rules apply. */
export function cyclingOnly(snapshot: SessionSnapshot | null) {
  if (!snapshot || !['bike', 'other'].includes(snapshot.kind) || !snapshot.exercises.length) return false
  return snapshot.exercises.every(exercise => {
    const blocks = exercise.intervalBlocks ?? []
    const segments = [...(exercise.warmups ?? []), ...blocks.flatMap(block => block.segments)]
    if (snapshot.kind !== 'bike' && !blocks.length) return false
    if (exercise.sets != null || exercise.reps != null || exercise.repsRange || exercise.loadBasis ||
        exercise.target?.unit === 'kg' || exercise.target?.unit === 'lb') return false
    return segments.every(segment => segment.modality === 'bike' && !segment.strength)
  })
}
