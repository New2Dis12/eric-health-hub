'use client'
import { WorkoutPlayer } from './workout-player'
import { useEffect, useRef, useState } from 'react'
import type { WorkoutSession } from '@/lib/training/session'
import styles from './stunna.module.css'
import { confirmStartedWorkout, SessionConflict } from '@/lib/training/session-client'

export function SessionStart({ workoutId, prescriptionRevision, isSyntheticDemo = false }: {
  workoutId: string; prescriptionRevision: number | null; isSyntheticDemo?: boolean
}) {
  const [workout, setWorkout] = useState<WorkoutSession | null>(null)
  const [state, setState] = useState<'loading'|'ready'|'saving'|'error'>('loading')
  const [message, setMessage] = useState('Loading saved session…')
  const [opened, setOpened] = useState(false)
  const retry = useRef<{idempotencyKey:string; expectedSessionRevision:number} | null>(null)
  async function load(signal?: AbortSignal) {
    setState('loading')
    try {
      const r = await fetch('/api/training/session?workout=' + workoutId, { cache: 'no-store', signal })
      if (!r.ok) throw new Error()
      const body = await r.json()
      setWorkout(body.workout); setState('ready'); setMessage('')
    } catch { if (!signal?.aborted) { setState('error'); setMessage('Saved session could not be loaded. Retry before starting.') } }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [workoutId]) // each overview owns its session
  async function start() {
    if (state !== 'ready') return
    if (workout && (workout.status === 'completed' || prescriptionRevision === null)) { setOpened(true); return }
    if (prescriptionRevision === null) return
    setState('saving'); setMessage('Starting or resuming…')
    const command = retry.current ?? { idempotencyKey: crypto.randomUUID(), expectedSessionRevision: workout?.revision ?? 0 }
    retry.current = command
    // Do not keep displaying a potentially superseded session while reconciling.
    setWorkout(null); setOpened(false)
    try {
      const current = await confirmStartedWorkout(fetch, workoutId, {
        operation: 'start_workout', reason: 'Start or resume workout', plannedSessionId: workoutId,
        expectedPrescriptionRevision: prescriptionRevision, ...command,
      })
      setWorkout(current); setOpened(true); retry.current = null; setState('ready'); setMessage('Current session confirmed on the server.')
    } catch (error) {
      if (error instanceof SessionConflict) {
        retry.current = null; setMessage('The saved plan or session changed. Reload this page before retrying.'); setState('error')
      } else {
        setState('ready'); setMessage('Could not confirm the current session. Retry safely; no success is assumed.')
      }
    }
  }
  return <div className={styles.startArea}>
    {!opened && <button className={styles.startWorkout} type="button" disabled={state !== 'ready' || (prescriptionRevision === null && !workout)}
      onClick={() => void start()}>{state === 'saving' ? 'Saving…' : workout?.status === 'completed' ? 'View finalized session' : workout ? 'Resume Workout' : 'Start Workout'}</button>}
    {state === 'error' && <button type="button" onClick={() => void load()}>Reload saved session</button>}
    <p role="status" aria-live="polite">{message}</p>
    {isSyntheticDemo && workout && <p className={styles.demoSession}>
      {workout.status === 'completed' ? 'Demo session · finalized for testing' : 'Demo session · previously started for testing'}
    </p>}
    {workout && <p>Saved session · {workout.status === 'completed' ? 'Finalized · read only' : 'In progress'} · revision {workout.revision}
      {workout.prescriptionRevision !== prescriptionRevision && ' · The plan has changed; this session retains its original prescription.'}</p>}
    {opened && workout && <WorkoutPlayer key={workout.id} workout={workout} onBack={()=>setOpened(false)} />}
  </div>
}
