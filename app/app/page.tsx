import { ArrowLeft, ArrowRight, CalendarDays, Dumbbell } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getWebSubject } from '@/lib/web-auth'
import { getTrainingContext, type TrainingContext } from '@/lib/training/context'
import { contextInput, moveTrainingDate, type Dose, type MetricTarget, type Segment } from '@/lib/training/context-models'
import { durationEstimate, effortSummary, exerciseSummary, type Workout } from '@/lib/training/workout-summary'
import styles from './stunna.module.css'
import { SessionStart } from './session-start'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Stunna', robots: { index: false, follow: false } }

function label(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
}

function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return [minutes ? `${minutes} min` : '', remainder || !minutes ? `${remainder} sec` : ''].filter(Boolean).join(' ')
}

function doseLabel(dose: Dose) {
  return [
    dose.sets === null ? '' : `${dose.sets} ${dose.sets === 1 ? 'set' : 'sets'}`,
    dose.reps === null ? '' : `${dose.reps} reps`,
    dose.durationSeconds === null ? '' : duration(dose.durationSeconds),
    dose.target ? `${dose.target.value} ${dose.target.unit}` : '',
  ].filter(Boolean).join(' · ')
}

function metricLabel(target: MetricTarget) {
  if (!target.range) return target.metric.replaceAll('_', ' ') + ' · Unspecified'
  const clock = (value: number) => Math.floor(Math.round(value) / 60) + ':' + String(Math.round(value) % 60).padStart(2, '0')
  const pace = ['sec/km', 'sec/mi', 'sec/500m'].includes(target.unit)
  const number = (value: number) => pace ? clock(value) : String(value)
  const values = target.range.min === target.range.max
    ? number(target.range.min) : number(target.range.min) + '–' + number(target.range.max)
  return values + ' ' + (pace ? target.unit.replace('sec/', '/') : target.unit)
}

function SegmentLine({ segment }: { segment: Segment }) {
  return <li>
    <strong>{segment.label}</strong> · {segment.modality} · {segment.phase}
    {segment.durationSeconds !== null && <> · {duration(segment.durationSeconds)}</>}
    {segment.targets.map((target, i) => <span key={i}> · {metricLabel(target)}</span>)}
    {segment.rpe && <> · RPE {segment.rpe.min}–{segment.rpe.max}</>}
    {segment.strength && <> · {doseLabel(segment.strength)} · {segment.strength.loadBasis.replaceAll('_', ' ')}</>}
  </li>
}

function PrescriptionDetails({ workout, showPrevious }: { workout: Workout; showPrevious: boolean }) {
  const prescription = workout.prescription
  if (!prescription) return null
  return <details className={styles.prescriptionDetails}>
    <summary>Prescription details & previous performance</summary>
        <ol className={styles.exerciseList}>
          {prescription.exercises.map(exercise => (
            <li className={styles.exercise} key={exercise.position}>
              <span className={styles.position} aria-hidden="true">{String(exercise.position).padStart(2, '0')}</span>
              <div>
                <h3>{exercise.name}{exercise.optional && <small> · Optional</small>}</h3>
                <dl className={styles.targets}>
                  <div><dt>Work</dt><dd>{(exercise.repsRange ? [exercise.sets === null ? '' : exercise.sets + ' sets', exercise.repsRange.min + '–' + exercise.repsRange.max + ' reps'].filter(Boolean).join(' · ') : doseLabel({ ...exercise, target: null })) || 'Unspecified'}</dd></div>
                  <div><dt>Target</dt><dd>{exercise.target ? `${exercise.target.value} ${exercise.target.unit}` : 'Unspecified'}</dd></div>
                  <div><dt>Rest</dt><dd>{exercise.restSeconds === null ? 'Unspecified' : duration(exercise.restSeconds)}</dd></div>
                </dl>
                {exercise.loadBasis && <p className={styles.cue}>Load convention · {exercise.loadBasis.replaceAll('_', ' ')}</p>}
                {exercise.rpe && <p className={styles.cue}>Target RPE {exercise.rpe.min}–{exercise.rpe.max}</p>}
                {exercise.equipment && <p className={styles.cue}>Equipment · {exercise.equipment}</p>}
                {exercise.targets?.map((target, i) => <p className={styles.cue} key={i}>{metricLabel(target)}</p>)}
                {!!exercise.warmups?.length && <div className={styles.segments}><h4>Warm-up</h4><ol>{exercise.warmups.map((segment, i) => <SegmentLine key={i} segment={segment} />)}</ol></div>}
                {exercise.intervalBlocks?.map((block, i) => <div className={styles.segments} key={i}>
                  <h4>{block.repeat} {block.repeat === 1 ? 'round' : 'rounds'}</h4>
                  <ol>{block.segments.map((segment, j) => <SegmentLine key={j} segment={segment} />)}</ol>
                </div>)}
                {exercise.adjustments?.map((adjustment, i) => <div className={styles.condition} key={i}>
                  <strong>{adjustment.condition}</strong><p>{adjustment.action}</p>
                  {adjustment.substitution && <p>Alternative · {adjustment.substitution.name} · {adjustment.substitution.equipment}</p>}
                </div>)}
                {exercise.notes && <p className={styles.cue}>{exercise.notes}</p>}
                {showPrevious && <p className={styles.previous}>
                  <strong>Previous</strong> {exercise.previous
                    ? `${[doseLabel(exercise.previous.performance), ...(exercise.previous.performance.targets ?? []).map(metricLabel)].filter(Boolean).join(' · ')} · ${label(exercise.previous.date, { month: 'short', day: 'numeric', year: 'numeric' })}${exercise.previous.source === 'synthetic' ? ' · Demo' : ''}`
                    : 'No comparable performance recorded'}
                </p>}
              </div>
            </li>
          ))}
        </ol>
        <footer className={styles.revision}>
          <span>Approved revision {prescription.revision}{prescription.source === 'synthetic' ? ' · Demo' : ''}</span>
          <p>{prescription.reason}</p>
        </footer>

  </details>
}

function WorkoutOverview({ workout, showPrevious }: { workout: Workout; showPrevious: boolean }) {
  const prescription = workout.prescription
  const rules = prescription?.exercises.flatMap(exercise =>
    (exercise.adjustments ?? []).map(adjustment => ({ ...adjustment, exercise: exercise.name }))) ?? []
  return <section data-workout-overview>
    <article className={styles.workout}>
      <div className={styles.workoutHeader}>
        <p className={styles.eyebrow}>{workout.kind} · Workout overview</p>
        <h2>{prescription?.title ?? 'Scheduled workout'}</h2>
        <p className={styles.block}>{workout.block.title}</p>
      </div>
      <div className={styles.overviewBody}>
        <dl className={styles.overviewMetrics}>
          <div><dt>Expected duration</dt><dd>{durationEstimate(workout)}</dd></div>
          <div><dt>Intended intensity</dt><dd>{effortSummary(workout)}</dd></div>
        </dl>
        <section className={styles.overviewSection}><h3>Objective</h3><p>{workout.purpose}</p></section>
        <section className={styles.overviewSection}><h3>Why this workout</h3>
          <p>{prescription?.overview?.rationale ?? 'Coaching rationale not specified.'}</p>
        </section>
        {prescription ? <>
          <section className={styles.overviewSection}><h3>The plan</h3>
            <ol className={styles.planOutline}>{prescription.exercises.map(exercise => <li key={exercise.position}>
              <strong>{exercise.name}{exercise.optional ? ' · Optional' : ''}</strong>
              <span>{exerciseSummary(exercise)}</span>
            </li>)}</ol>
          </section>
          <section className={styles.overviewSection}><h3>Adjustments & alternatives</h3>
            {rules.length ? <ul className={styles.adjustmentOutline}>{rules.map((rule, i) => <li key={i}>
              <strong>{rule.exercise}</strong><p>{rule.condition}. {rule.action}</p>
              {rule.substitution && <p>Alternative · {rule.substitution.name} · {rule.substitution.equipment}</p>}
            </li>)}</ul> : <p>No additional adjustment rules specified.</p>}
          </section>
        </> : <p className={styles.empty}>No approved exercise prescription is available for this workout.</p>}
      </div>
      <PrescriptionDetails workout={workout} showPrevious={showPrevious} />
      <SessionStart workoutId={workout.id} prescriptionRevision={prescription?.revision ?? null} />
    </article>
  </section>
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className={styles.shell}><div className={styles.content}>
    <p className={styles.eyebrow}>Stunna</p><h1>{title}</h1>{children}
  </div></main>
}

export default async function StunnaPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  if (process.env.STUNNA_ENABLED !== 'true') notFound()
  let subject: string | null = null
  try { subject = await getWebSubject() } catch {
    return <Notice title="Stunna is unavailable"><p>Browser authentication is unavailable.</p></Notice>
  }
  if (!subject) return <Notice title="Private training workspace">
    <a className={styles.button} href="/auth/login?returnTo=%2Fapp">Sign in to Health Hub</a>
  </Notice>

  const { date } = await searchParams
  const input = contextInput.safeParse({ date })
  if (!input.success) return <Notice title="Invalid training date">
    <a className={styles.button} href="/app">Return to today</a>
  </Notice>

  let context: TrainingContext
  try {
    context = await getTrainingContext({ subject, scopes: ['training.read'], source: 'browser' }, { date: input.data.date })
  } catch {
    return <Notice title="Training plan unavailable">
      <p>The saved plan could not be loaded.</p><a className={styles.button} href={dateLink(input.data.date)}>Retry</a>
    </Notice>
  }

  const isToday = context.date === context.today
  return (
    <main className={styles.shell}>
      <div className={styles.content}>
        <div className={styles.topline}>
          <span className={styles.brand}><Dumbbell size={18} aria-hidden="true" /> Stunna</span>
          <a href="/" className={styles.hubLink}>Health Hub</a>
        </div>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{label(context.date, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1>{isToday ? 'Today’s workouts' : 'Planned workouts'}</h1>
          <p className={styles.muted}>{context.preferences.trainingFocus ?? 'Your saved training prescription'}</p>
        </header>

        <nav className={styles.calendar} aria-label="Training calendar">
          <div className={styles.calendarHead}>
            <div>
              <p className={styles.eyebrow}><CalendarDays size={15} aria-hidden="true" /> Training calendar</p>
              <p>{label(context.calendar[0].date, { month: 'short', day: 'numeric' })} – {label(context.calendar[6].date, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
            </div>
            <div className={styles.arrows}>
              <a className={styles.iconButton} href={dateLink(moveTrainingDate(context.date, -7))} aria-label="Previous week"><ArrowLeft size={18} /></a>
              <a className={styles.iconButton} href={dateLink(moveTrainingDate(context.date, 7))} aria-label="Next week"><ArrowRight size={18} /></a>
            </div>
          </div>
          <ol className={styles.days}>
            {context.calendar.map(day => (
              <li key={day.date}>
                <a href={dateLink(day.date)}
                  aria-current={day.date === context.date ? 'date' : undefined}
                  aria-label={`${label(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${day.workoutCount} workouts`}>
                  <span>{label(day.date, { weekday: 'short' })}</span>
                  <strong>{Number(day.date.slice(-2))}</strong>
                  <span className={styles.marker} data-scheduled={day.workoutCount > 0} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ol>
          <div className={styles.dayNav}>
            <a href={dateLink(moveTrainingDate(context.date, -1))}>Previous day</a>
            <a href="/app">Today</a>
            <a href={dateLink(moveTrainingDate(context.date, 1))}>Next day</a>
          </div>
        </nav>

        {context.workouts[0]?.block.methodology && <details className={styles.methodology}>
          <summary>Block guidance & weekly structure</summary>
          <ul>{context.workouts[0].block.methodology.progressionRules.map((rule, i) => <li key={i}>{rule}</li>)}</ul>
          <ol>{context.workouts[0].block.methodology.weeklyStructure.map((day, i) => <li key={i}>Day {day.weekday} · {day.slots.join(' → ')}</li>)}</ol>
        </details>}
        <div className={styles.scheduleLabel}>
          <span>Workout overviews</span>
        </div>
        <div className={styles.schedule}>
          {context.workouts.length
            ? context.workouts.map(workout => <WorkoutOverview key={workout.id} workout={workout} showPrevious={context.preferences.showPrevious} />)
            : <section className={styles.empty}><h2>No workouts scheduled</h2><p>Select another day to view its saved plan.</p></section>}
          {context.hasMoreWorkouts && <p className={styles.muted}>Showing the first eight workouts scheduled for this day.</p>}
        </div>
      </div>
    </main>
  )
}

function dateLink(date?: string) {
  return date ? `/app?date=${date}` : '/app'
}
