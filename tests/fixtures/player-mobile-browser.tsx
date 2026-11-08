import { createRoot } from "react-dom/client";
import { PlayerView } from "../../app/app/workout-player";
import shell from "../../app/app/stunna.module.css";
import type { WorkoutSession } from "../../lib/training/session";
import type { SessionResults } from "../../lib/training/logging-models";
import type { MetricTarget, Segment } from "../../lib/training/context-models";

const target = (metric: MetricTarget["metric"], unit: MetricTarget["unit"], min: number, max = min) =>
  ({ metric, unit, range: { min, max } });
const interval = (modality: Segment["modality"], durationSeconds: number | null, targets: MetricTarget[]): Segment =>
  ({ phase: "work", modality, label: "Work", durationSeconds, targets, rpe: null });
const bike = interval("bike", 90, [target("power", "W", 120, 160), target("cycling_cadence", "rpm", 75, 90), target("resistance", "level", 12, 18)]);
const run = interval("run", 90, [target("speed", "mph", 5.4, 5.6), target("incline", "%", 0.5, 2.5)]);
const row = interval("row", null, [target("distance", "m", 400), target("rowing_split", "sec/500m", 165, 175), target("stroke_rate", "spm", 20, 22)]);

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

createRoot(document.querySelector("#root")!).render(
  <main className={shell.shell}><div className={shell.content}>
    {workouts.map(workout => <article className={shell.workout} key={workout.id}><div className={shell.startArea}>
      <PlayerView workout={workout} data={result(workout)} busy={false}
        save={async () => { throw Error("Layout fixture has no write service"); }} changed={() => {}} />
    </div></article>)}
  </div></main>,
);
