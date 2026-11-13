import { createRoot } from "react-dom/client";
import { PlayerView, WorkoutPlayer } from "../../app/app/workout-player";
import shell from "../../app/app/stunna.module.css";
import type { WorkoutSession } from "../../lib/training/session";
import type { SessionResults } from "../../lib/training/logging-models";
import { metricTarget, type MetricTarget, type Segment } from "../../lib/training/context-models";

const target = (metric: MetricTarget["metric"], unit: MetricTarget["unit"], min: number, max = min) =>
  metricTarget.parse({ metric, unit, range: { min, max } });
const interval = (modality: Segment["modality"], durationSeconds: number | null, targets: MetricTarget[]): Segment =>
  ({ phase: "work", modality, label: "Work", durationSeconds, targets, rpe: null });
const bike = interval("bike", 90, [target("power", "W", 120, 160), target("cycling_cadence", "rpm", 75, 90), target("resistance", "level", 12, 18)]);
const run = interval("run", 90, [target("speed", "mph", 5.4, 5.6), target("incline", "%", 0.5, 2.5)]);
const row = interval("row", null, [target("distance", "m", 400), target("rowing_split", "sec/500m", 165.5, 175.5), target("stroke_rate", "spm", 20, 22)]);

function session(name: string, segment: Segment, finalized = false): WorkoutSession {
  const occurrences: NonNullable<WorkoutSession["snapshot"]>["occurrences"] = [{ id: "exercise", key: "exercise", exercise: 0, type: "exercise" }];
  for (let repeat = 0; repeat < 3; repeat++) {
    for (let i = 0; i < 2; i++) occurrences.push({ id: `${repeat}:${i}`, key: "exercise", exercise: 0, type: "interval", block: 0, repeat, segment: i });
  }
  return {
    id: name, revision: 1, status: finalized ? "completed" : "in_progress", startedAt: "2026-01-01", prescriptionRevision: 1,
    snapshot: {
      title: name, purpose: "Synthetic layout fixture", kind: segment.modality === "row" ? "other" : segment.modality, overview: null, occurrences,
      exercises: [{
        key: "exercise", name, sets: null, reps: null, durationSeconds: null, target: null, restSeconds: null, notes: null,
        ...(segment.modality === "run" ? { warmups: [{ ...segment, phase: "warmup", durationSeconds: 3540 }] } : {}),
        intervalBlocks: [{ repeat: 3, segments: [segment, { ...segment, phase: "recovery", durationSeconds: segment.modality === "row" ? 90 : 75, targets: [] }] }],
      }],
    },
  };
}
const steady = session("Synthetic steady bike", bike);
steady.snapshot!.exercises[0].intervalBlocks = undefined;
steady.snapshot!.exercises[0].durationSeconds = 600;
steady.snapshot!.exercises[0].targets = bike.targets;
const runSession = session("Synthetic intervals run", run);
runSession.snapshot!.occurrences.push({ id: "warmup", key: "exercise", exercise: 0, type: "warmup", segment: 0 });
const workouts = [runSession, session("Synthetic intervals row", row), session("Synthetic intervals bike", bike, true), steady];
const result = (workout: WorkoutSession): SessionResults =>
  ({ sessionId: workout.id, status: workout.status, sessionRevision: 1, notes: "", notesRevision: 0, entries: [], nextOffset: null });

// Exercise the real completion panels, not only the inner PlayerView layout.
const strengthSession: WorkoutSession = {
  id: "Synthetic completion strength", revision: 1, status: "in_progress",
  startedAt: "2026-01-01", prescriptionRevision: 1,
  snapshot: {
    title: "Synthetic completion strength", purpose: "Synthetic completion flow",
    kind: "strength", overview: null,
    occurrences: [{ id: "strength-occurrence", key: "synthetic-lift", exercise: 0, type: "exercise" }],
    exercises: [{
      key: "synthetic-lift", name: "Synthetic lift", sets: 2, reps: 5,
      durationSeconds: 90, target: null, restSeconds: 60, notes: null,
      warmups: [
        { phase: "warmup", modality: "other", label: "Three minutes of gentle movement with controlled repetitions and comfortable motion",
          durationSeconds: 180, targets: [], rpe: null },
        { phase: "warmup", modality: "strength", label: "Practice the movement slowly before the working sets",
          durationSeconds: null, targets: [], rpe: null,
          strength: { sets: 1, reps: 8, durationSeconds: null, target: { value: 5, unit: "lb" }, loadBasis: "total" } },
      ],
    }],
  },
};
const server = new Map<string, SessionResults>([
  ...workouts.map(workout => [workout.id, result(workout)] as const),
  [strengthSession.id, { ...result(strengthSession), notes: "Synthetic saved overall notes" }],
]);
const probe = { attempts: 0, keys: [] as string[] };
Object.assign(globalThis, { __issue34CompletionProbe: probe });
globalThis.fetch = async (url, init) => {
  if (init?.method === "POST") {
    const command = JSON.parse(String(init.body)) as { sessionId: string; idempotencyKey: string };
    if (command.sessionId !== strengthSession.id) return Response.json({}, { status: 403 });
    probe.attempts++;
    probe.keys.push(command.idempotencyKey);
    if (probe.attempts === 1) return Response.json({ error: "Synthetic ambiguous reply" }, { status: 503 });
    const saved = server.get(strengthSession.id)!;
    server.set(strengthSession.id, { ...saved, status: "completed", sessionRevision: 2 });
    return Response.json({ actualSessionId: strengthSession.id, sessionRevision: 2 });
  }
  const sessionId = new URL(String(url), location.origin).searchParams.get("session");
  const saved = sessionId && server.get(sessionId);
  return saved ? Response.json(saved) : Response.json({}, { status: 404 });
};

createRoot(document.querySelector("#root")!).render(
  <main className={shell.shell}><div className={shell.content}>
    {workouts.map(workout => <article className={shell.workout} key={workout.id}><div className={shell.startArea}>
      {workout.status === "completed" ? (
        <WorkoutPlayer workout={workout} onBack={() => {}} />
      ) : (
        <PlayerView workout={workout} data={result(workout)} busy={false}
          save={async () => { throw Error("Layout fixture has no write service"); }} changed={() => {}} />
      )}
    </div></article>)}
    <article className={shell.workout} data-completion-probe="strength">
      <div className={shell.startArea}>
        <WorkoutPlayer workout={strengthSession} onBack={() => {}} />
      </div>
    </article>
  </div></main>,
);
