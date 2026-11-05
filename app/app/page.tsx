import { ArrowLeft, ArrowRight, CalendarDays, Dumbbell } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getWebSubject } from '@/lib/web-auth'
import { getTrainingContext, type TrainingContext } from '@/lib/training/context'
import { contextInput, moveTrainingDate, type Dose } from '@/lib/training/context-models'
import styles from './stunna.module.css'

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

function Workout({ workout, timeZone, showPrevious }: {
  workout: TrainingContext['workouts'][number]
  timeZone: string
  showPrevious: boolean
}) {
  const prescription = workout.prescription
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    .format(new Date(workout.scheduledAt))
  return (
    <article className={styles.workout}>
      <div className={styles.workoutHeader}>
        <p className={styles.eyebrow}>{workout.kind} · {time}</p>
        <h2>{prescription?.title ?? 'Scheduled workout'}</h2>
        <p className={styles.muted}>{workout.purpose}</p>
        <p className={styles.block}><strong>{workout.block.title}</strong> · {workout.block.goal}</p>
      </div>
      {prescription ? <>
        <ol className={styles.exerciseList}>
          {prescription.exercises.map(exercise => (
            <li className={styles.exercise} key={exercise.position}>
              <span className={styles.position} aria-hidden="true">{String(exercise.position).padStart(2, '0')}</span>
              <div>
                <h3>{exercise.name}</h3>
                <dl className={styles.targets}>
                  <div><dt>Work</dt><dd>{doseLabel({ ...exercise, target: null }) || 'Unspecified'}</dd></div>
                  <div><dt>Target</dt><dd>{exercise.target ? `${exercise.target.value} ${exercise.target.unit}` : 'Unspecified'}</dd></div>
                  <div><dt>Rest</dt><dd>{exercise.restSeconds === null ? 'Unspecified' : duration(exercise.restSeconds)}</dd></div>
                </dl>
                {exercise.notes && <p className={styles.cue}>{exercise.notes}</p>}
                {showPrevious && <p className={styles.previous}>
                  <strong>Previous</strong> {exercise.previous
                    ? `${doseLabel(exercise.previous.performance)} · ${label(exercise.previous.date, { month: 'short', day: 'numeric', year: 'numeric' })}${exercise.previous.source === 'synthetic' ? ' · Demo' : ''}`
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
      </> : <p className={styles.empty}>No approved exercise prescription is available for this workout.</p>}
    </article>
  )
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
    context = await getTrainingContext({ subject, scopes: ['training.read'], source: 'browser' }, input.data)
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
          <h1>{isToday ? 'Today’s workout' : 'Scheduled workouts'}</h1>
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

        <div className={styles.scheduleLabel}>
          <span>Prescription</span><span>{context.timeZone}</span>
        </div>
        <div className={styles.schedule}>
          {context.workouts.length
            ? context.workouts.map(workout => <Workout key={workout.id} workout={workout} timeZone={context.timeZone} showPrevious={context.preferences.showPrevious} />)
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
