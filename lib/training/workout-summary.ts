import type { TrainingContext } from './context'
import type { Segment } from './context-models'

export type Workout = TrainingContext['workouts'][number]
type Exercise = NonNullable<Workout['prescription']>['exercises'][number]

export function durationEstimate(workout: Workout) {
  const range = workout.prescription?.overview?.expectedDurationMinutes
  if (!range) return 'Duration not specified'
  return range.min === range.max ? 'About ' + range.min + ' min' : 'About ' + range.min + '–' + range.max + ' min'
}

export function effortSummary(workout: Workout) {
  const range = workout.prescription?.overview?.rpe
  if (!range) return 'Intensity not specified'
  return range.min === range.max ? 'RPE ' + range.min : 'RPE ' + range.min + '–' + range.max
}

function segmentDose(segment: Segment) {
  if (segment.durationSeconds !== null) {
    const seconds = segment.durationSeconds
    return seconds >= 60 && seconds % 60 === 0 ? seconds / 60 + ' min' : seconds + ' sec'
  }
  const distance = segment.targets.find(target => target.metric === 'distance' && target.range !== null)
  if (distance?.range) return (distance.range.min === distance.range.max
    ? String(distance.range.min) : distance.range.min + '–' + distance.range.max) + ' ' + distance.unit
  return segment.label
}

export function exerciseSummary(exercise: Exercise) {
  if (exercise.intervalBlocks?.length) {
    return exercise.intervalBlocks.map(block =>
      block.repeat + ' rounds · ' + block.segments.map(segment =>
        segmentDose(segment) + ' ' + segment.phase).join(' / ')).join(' · ')
  }
  const parts = [
    exercise.sets === null ? '' : exercise.sets + ' sets',
    exercise.repsRange ? exercise.repsRange.min + '–' + exercise.repsRange.max + ' reps' :
      exercise.reps === null ? '' : exercise.reps + ' reps',
    exercise.durationSeconds === null ? '' : exercise.durationSeconds + ' sec',
  ]
  return parts.filter(Boolean).join(' · ') || 'Dose not specified'
}

export function workoutLink(date: string, id: string) {
  return '/app?date=' + date + '&workout=' + id
}
