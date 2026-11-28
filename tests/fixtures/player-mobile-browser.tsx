import { SessionStart } from "../../app/app/session-start";
import { createRoot } from "react-dom/client";
import { PlayerView, WorkoutPlayer } from "../../app/app/workout-player";
import shell from "../../app/app/stunna.module.css";
import type { WorkoutSession } from "../../lib/training/session";
import type { LogInput, SessionResults } from "../../lib/training/logging-models";
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
const finalizedBike = session("Synthetic intervals bike", bike, true);
finalizedBike.snapshot!.exercises[0].loadBasis = "unverified";
const workouts = [runSession, session("Synthetic intervals row", row), finalizedBike, steady];
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
  if(String(url).startsWith('/api/training/sources?')) return Response.json({candidates:[],status:'unavailable',reason:'Synthetic empty list',sessionRevision:1,evidenceRevision:0})
  const sessionId = new URL(String(url), location.origin).searchParams.get("session");
  const saved = sessionId && server.get(sessionId);
  return saved ? Response.json(saved) : Response.json({}, { status: 404 });
};

// Isolated browser acceptance adapter. Session storage emulates a durable synthetic
// results endpoint across navigation; service/security tests exercise real local SQL.
const query=new URLSearchParams(location.search);
const flow=structuredClone(strengthSession);
flow.id="synthetic-accordion";
const snapshot=flow.snapshot!;
snapshot.title="Strength and conditioning";
snapshot.exercises[0]={...snapshot.exercises[0],name:"Single-arm half-kneeling overhead press",sets:1,reps:null,repsRange:{min:6,max:8},restSeconds:150,rpe:{min:7.5,max:8.5},loadBasis:"per_hand"};
snapshot.exercises.push({...snapshot.exercises[0],key:"hold",name:"Side plank hold",sets:2,repsRange:undefined,durationSeconds:45,rpe:undefined,warmups:[]},
  {...steady.snapshot!.exercises[0],key:"ride",name:"Bike cooldown",durationSeconds:180});
snapshot.occurrences.push({id:"hold",key:"hold",exercise:1,type:"exercise"},{id:"ride",key:"ride",exercise:2,type:"exercise"});
if(query.has("flow")) {
  const key="synthetic-61-"+query.get("flow");
  const state=JSON.parse(sessionStorage.getItem(key)??"null")??{started:false,data:result(flow),receipts:{},keys:[],loseSet:true,staleNote:true};
  const persist=()=>sessionStorage.setItem(key,JSON.stringify(state));
  globalThis.fetch=async(url,init)=>{
    const current:SessionResults=state.data;
    const session={...flow,revision:current.sessionRevision,status:current.status};
    if(init?.method!=="POST") return Response.json(String(url).includes("/sources")?{candidates:[]}:
      String(url).includes("/session")?{workout:state.started?session:null}:current);
    const cmd=JSON.parse(String(init.body));
    if(cmd.operation==="start_workout"){state.started=true;persist();return Response.json({workout:session})}
    state.keys.push(cmd.idempotencyKey);
    if(state.receipts[cmd.idempotencyKey]) {persist();return Response.json(state.receipts[cmd.idempotencyKey])}
    const item:LogInput["item"]=cmd.item;
    if(item?.kind==="workout_note" && state.staleNote) {
      state.staleNote=false; current.notes="Synthetic newer note";current.notesRevision++;current.sessionRevision++;persist();
      return Response.json({},{status:409})
    }
    if(cmd.expectedSessionRevision!==current.sessionRevision) return Response.json({},{status:409});
    if(cmd.operation==="complete_workout") current.status="completed";
    else if(item.kind==="workout_note"){current.notes=item.notes;current.notesRevision++}
    else if(item.kind==="exercise_note" || item.kind==="strength_set") {
      const ordinal=item.kind==="strength_set"?item.setOrdinal:0;
      const existing=current.entries.find(e=>e.kind===item.kind && e.occurrence_id===item.occurrenceId && e.set_ordinal===ordinal);
      if((existing?.revision??0)!==cmd.expectedItemRevision) return Response.json({},{status:409});
      current.entries=current.entries.filter(e=>e!==existing);
      current.entries.push({id:crypto.randomUUID(),item_key:item.kind,kind:item.kind,occurrence_id:item.occurrenceId,set_ordinal:ordinal,
        revision:cmd.expectedItemRevision+1,session_revision:current.sessionRevision+1,value:item.kind==="strength_set"?item.actual:{notes:item.notes},
        before_value:existing?.value??null,actor_sub:"synthetic",source:"browser",reason:"fixture",recorded_at:"synthetic"})
    }
    current.sessionRevision++;
    const receipt={actualSessionId:flow.id,sessionRevision:current.sessionRevision};
    state.receipts[cmd.idempotencyKey]=receipt;
    if(item?.kind==="strength_set" && state.loseSet) {state.loseSet=false;persist();return Response.json({},{status:503})}
    persist();return Response.json(receipt)
  }
}
const mode=query.get("cycling");
const sample=session("Cycling intervals",bike,query.get("status")==="finalized");
const example=sample.snapshot!.exercises[0];
example.warmups=[{...bike,phase:"warmup",label:"Easy spin",durationSeconds:4200,targets:[]}];
example.intervalBlocks=[{repeat:12,segments:[{...bike,durationSeconds:150,targets:[target("power","W",225.5,250.5),
  ...(["rpm","both"].includes(mode??"")?[target("cycling_cadence","rpm",95,105)]:[]),
  ...(["res","both"].includes(mode??"")?[target("resistance","%",52.5,57.5)]:[])]},
  {...bike,phase:"recovery",durationSeconds:60,targets:mode==="both"?[target("resistance","%",0)]:[]}]}];
createRoot(document.querySelector("#root")!).render(
  mode?<main className={shell.shell}><div className={shell.content}><section aria-label="Workout player"><PlayerView workout={sample} data={result(sample)} busy={false} changed={()=>{}} save={async()=>{}}/></section></div></main>:query.has("flow")?<main className={shell.shell}><div className={shell.content}><article className={shell.workout}>
    {query.has("player")?<WorkoutPlayer workout={flow} returnHref={"?flow="+query.get("flow")}/>:<SessionStart workoutId={flow.id} prescriptionRevision={1}/>}
  </article></div></main>:<main className={shell.shell}><div className={shell.content}>
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
