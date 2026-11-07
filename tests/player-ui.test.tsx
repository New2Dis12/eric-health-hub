import React from "react";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { PlayerView, WorkoutPlayer } from "../app/app/workout-player";
import {
  loadPlayerResults,
  savePlayerItem,
  proposedReps,
  PlayerError,
  rpeOptions,
} from "../lib/training/player-client";
import type { WorkoutSession } from "../lib/training/session";
import type { SessionResults } from "../lib/training/logging-models";
const workout: WorkoutSession = {
  id: "synthetic-session",
  revision: 1,
  status: "in_progress",
  startedAt: "2026-01-01",
  prescriptionRevision: 1,
  snapshot: {
    title: "Synthetic strength",
    kind: "strength",
    purpose: "Fixture",
    overview: null,
    occurrences: [
      {
        id: "exercise-a",
        exercise: 0,
        key: "synthetic-squat",
        type: "exercise",
      },
      { id: "exercise-b", exercise: 1, key: "synthetic-run", type: "exercise" },
    ],
    exercises: [
      {
        key: "synthetic-squat",
        name: "Synthetic squat",
        sets: 2,
        reps: 5,
        repsRange: { min: 8, max: 10 },
        durationSeconds: null,
        target: null,
        restSeconds: 60,
        notes: "Synthetic cue",
      },
      {
        key: "synthetic-run",
        name: "Synthetic run",
        sets: null,
        reps: null,
        durationSeconds: 60,
        target: null,
        restSeconds: null,
        notes: null,
        intervalBlocks: [
          {
            repeat: 2,
            segments: [
              {
                phase: "work",
                modality: "run",
                label: "Run work",
                durationSeconds: 60,
                targets: [],
                rpe: null,
              },
              {
                phase: "recovery",
                modality: "run",
                label: "Recover",
                durationSeconds: 30,
                targets: [],
                rpe: null,
              },
            ],
          },
        ],
      },
    ],
  },
};
const data: SessionResults = {
  sessionId: workout.id,
  sessionRevision: 1,
  status: "in_progress",
  notes: "",
  notesRevision: 0,
  entries: [],
  nextOffset: null,
};
function text(tree: ReactTestRenderer) {
  return JSON.stringify(tree.toJSON());
}
test("mobile component hierarchy has unsaved upper-bound proposed reps, native half-step RPE, end-of-exercise and overall notes", async () => {
  let tree!: ReactTestRenderer,
    writes = 0;
  await act(async () => {
    tree = create(
      <PlayerView
        workout={workout}
        data={data}
        busy={false}
        save={async () => {
          writes++;
        }}
        changed={() => {}}
      />,
    );
  });
  const rows = tree.root.findAll((node) => node.type === "div" && node.props.className === "strengthRow");
  const cells = (row: typeof rows[number]) => row.children.map((child) =>
    typeof child === "string" ? child : child.props["aria-label"] ?? child.props.children
  );
  const cardioRows = tree.root.findAll((node) => node.type === "div" && node.props.className === "cardioRow");
  assert.deepEqual(cells(rows[0]), ["Completion", "Set", "Load", "Reps", "Edit"]);
  assert.deepEqual(cells(cardioRows[0]), ["Completion", "Workout segment", "Running clock", "Speed/Output"]);
  assert.deepEqual(cardioRows.slice(1).map((row) => cells(row)[2]), ["0:00–1:00", "1:00–1:30", "1:30–2:30", "2:30–3:00"]);
  assert.deepEqual(cells(rows[1]).filter((_, i) => i !== 1), ["Log Set 1", "—", 10, "Edit"]);
  assert.equal(tree.root.findAllByType("input").length, 0);
  const edit = (row: number) => rows[row].findAllByType("button").at(-1)!;
  await act(async () => edit(1).props.onClick());
  assert.equal(tree.root.findAllByType("input").length, 2);
  assert.equal(tree.root.findAllByType("input")[0].props.value, "10");
  assert.equal(tree.root.findAllByType("input")[1].props.value, "");
  await act(async () => edit(2).props.onClick());
  assert.equal(tree.root.findAllByType("input").length, 2);
  assert.equal(edit(1).props["aria-expanded"], false);
  assert.equal(edit(2).props["aria-expanded"], true);
  assert.equal(writes, 0);
  assert.match(text(tree), /Proposed/);
  assert.match(text(tree), /interval entry coming next/);
  const rpe = tree.root
    .findAllByType("select")
    .find((n) =>
      n.findAllByType("option").some((o) => o.props.children === "0.5"),
    )!;
  assert.equal(rpe.props.value, "");
  assert.equal(rpe.findAllByType("option").length, 22);
  const sections = tree.root.findAllByType("section");
  assert.equal(sections.length, 2);
  for (const section of sections)
    assert.match(
      JSON.stringify(
        section.findAllByType("fieldset").at(-1)!.findByType("textarea").parent!
          .props.children[0],
      ),
      /Exercise Notes/,
    );
  assert.equal(tree.root.findAllByType("textarea").length, 3);
  const snapshot = {
    exerciseCount: sections.length,
    setCount: rows.length - 1,
    noteCount: tree.root.findAllByType("textarea").length,
    rpeOptionCount: rpe.findAllByType("option").length,
    proposedReps: tree.root.findAllByType("input")[0].props.value,
    initialLoad: tree.root.findAllByType("input")[1].props.value,
  };
  assert.deepEqual(snapshot, JSON.parse(readFileSync(new URL("./fixtures/player-mobile.snapshot.json", import.meta.url), "utf8")));
  const css = readFileSync(new URL("../app/app/player.module.css", import.meta.url), "utf8");
  assert.match(css, /min-height: 44px/);
  assert.match(css, /44px minmax\(0, 0.8fr\) minmax\(0, 1.4fr\) minmax\(0, 0.65fr\) 44px/);
  await act(async () => tree.root.findAllByType("input")[0].props.onChange({ target: { value: "7" } }));
  await act(async () => tree.root.findAllByType("button").find((n) => n.props.children === "Save")!.props.onClick());
  assert.equal(writes, 1);
  await act(async () => tree.unmount());
});
test("server actual replaces prescription on reload; finalized fields disabled and session views isolated", async () => {
  const saved = {
    ...data,
    status: "completed",
    notes: "Synthetic saved",
    entries: [
      {
        id: "entry",
        item_key: "key",
        kind: "strength_set",
        occurrence_id: "exercise-a",
        set_ordinal: 1,
        revision: 1,
        session_revision: 2,
        value: {
          reps: 3,
          load: { value: 20, unit: "lb", basis: "per_hand" },
          rpe: 7.5,
          source: "user_reported",
        },
        before_value: null,
        actor_sub: "synthetic",
        source: "browser",
        reason: "Fixture",
        recorded_at: "synthetic",
      },
    ],
  } as SessionResults;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <PlayerView
        workout={workout}
        data={saved}
        busy={false}
        save={async () => {
          throw Error("no write");
        }}
        changed={() => {}}
      />,
    );
  });
  assert.equal(tree.root.findAllByType("input").length, 0);
  assert.match(text(tree), /Logged/);
  assert.match(text(tree), /20 lb/);
  assert.equal(tree.root.findAllByType("fieldset")[0].props.disabled, true);
  assert.match(text(tree), /per hand/);
  assert.equal(
    tree.root.findAllByType("textarea").at(-1)!.props.value,
    "Synthetic saved",
  );
  await act(async () => {
    tree.update(
      <PlayerView
        key="other"
        workout={{ ...workout, id: "other" }}
        data={{ ...data, sessionId: "other" }}
        busy={false}
        save={async () => {}}
        changed={() => {}}
      />,
    );
  });
  assert.equal(tree.root.findAllByType("textarea").at(-1)!.props.value, "");
  await act(async () => tree.unmount());
});
test("conflict preserves changed reps and notes, shows server truth; transient error keeps retry payload", async () => {
  let tree!: ReactTestRenderer,
    keys: unknown[] = [],
    conflict = true;
  const save = async (
    _item: unknown,
    _rev: number,
    pending: { current: unknown },
  ) => {
    pending.current ??= "same-key";
    keys.push(pending.current);
    throw new PlayerError(conflict ? "conflict" : "failed");
  };
  await act(async () => {
    tree = create(
      <PlayerView
        workout={workout}
        data={data}
        busy={false}
        save={save}
        changed={() => {}}
      />,
    );
  });
  const area = tree.root.findAllByType("textarea")[0];
  await act(async () =>
    area.props.onChange({ target: { value: "Unsaved synthetic draft" } }),
  );
  await act(async () =>
    tree.root
      .findAllByType("button")
      .find((n) => n.props.children === "Save Notes")!
      .props.onClick(),
  );
  assert.match(text(tree), /Draft retained/);
  assert.equal(
    tree.root.findAllByType("textarea")[0].props.value,
    "Unsaved synthetic draft",
  );
  conflict = false;
  await act(async () =>
    tree.root
      .findAllByType("button")
      .find((n) => n.props.children === "Save Notes")!
      .props.onClick(),
  );
  assert.equal(keys[0], keys[1]);
  assert.match(text(tree), /retry safely/);
  await act(async () => tree.unmount());
});
test("paged current results load all rows and restart when revisions change", async () => {
  let calls = 0;
  const pages = [
    { ...data, entries: [], nextOffset: 100 },
    { ...data, sessionRevision: 2, entries: [], nextOffset: null },
    { ...data, sessionRevision: 2, entries: [], nextOffset: 100 },
    { ...data, sessionRevision: 2, entries: [], nextOffset: null },
  ];
  const read = await loadPlayerResults(
    async () => Response.json(pages[calls++]),
    workout.id,
  );
  assert.equal(read.sessionRevision, 2);
  assert.equal(calls, 4);
  await assert.rejects(
    loadPlayerResults(
      async () => new Response("{}", { status: 401 }),
      workout.id,
    ),
  );
});
test("successful write requires fresh confirmed read; replay does not manufacture a saved state", async () => {
  let commands: string[] = [],
    failRead = true;
  const fetcher = async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      commands.push(init.body as string);
      return Response.json({ actualSessionId: workout.id, sessionRevision: 2 });
    }
    return failRead
      ? new Response("{}", { status: 503 })
      : Response.json({ ...data, sessionRevision: 2 });
  };
  const command = { idempotencyKey: "synthetic-same-key" };
  await assert.rejects(savePlayerItem(fetcher, workout.id, command));
  failRead = false;
  assert.equal(
    (await savePlayerItem(fetcher, workout.id, command)).sessionRevision,
    2,
  );
  assert.equal(commands[0], commands[1]);
  assert.equal(proposedReps({ reps: null }), null);
  assert.equal(proposedReps({ reps: 5 }), 5);
  assert.equal(rpeOptions.length, 21);
});

test('normal player entry reads saved notes, confirms saves/clear by readback and retains identical retry after a lost confirmation',async()=>{
  const previousFetch=globalThis.fetch
  const previousWindow=globalThis.window
  Object.assign(globalThis,{window:{addEventListener(){},removeEventListener(){},confirm(){return true}}})
  let server={...data},failRead=false,postBodies:string[]=[],tree!:ReactTestRenderer
  globalThis.fetch=(async(_url:unknown,init?:RequestInit)=>{
    if(init?.method==='POST'){
      postBodies.push(String(init.body))
      const command=JSON.parse(String(init.body))
      server={...server,notes:command.item.notes,notesRevision:1,sessionRevision:2}
      return Response.json({actualSessionId:workout.id,sessionRevision:2})
    }
    return failRead?new Response('{}',{status:503}):Response.json(server)
  }) as typeof fetch
  try{
    await act(async()=>{tree=create(<WorkoutPlayer workout={workout} onBack={()=>{}}/> )})
    await act(async()=>tree.root.findAllByType('textarea').at(-1)!.props.onChange({target:{value:'Synthetic workout note'}}))
    failRead=true
    await act(async()=>tree.root.findAllByType('button').filter(n=>n.props.children==='Save Notes').at(-1)!.props.onClick())
    assert.match(text(tree),/Failed/)
    assert.equal(tree.root.findAllByType('textarea').at(-1)!.props.value,'Synthetic workout note')
    failRead=false
    await act(async()=>tree.root.findAllByType('button').filter(n=>n.props.children==='Save Notes').at(-1)!.props.onClick())
    assert.equal(postBodies[0],postBodies[1]);assert.match(text(tree),/Saved/)
    await act(async()=>tree.root.findAllByType('textarea').at(-1)!.props.onChange({target:{value:''}}))
    await act(async()=>tree.root.findAllByType('button').filter(n=>n.props.children==='Save Notes').at(-1)!.props.onClick())
    assert.equal(tree.root.findAllByType('textarea').at(-1)!.props.value,'')
    assert.notEqual(JSON.parse(postBodies[0]).idempotencyKey,JSON.parse(postBodies[2]).idempotencyKey)
    await act(async()=>tree.unmount())
  }finally{globalThis.fetch=previousFetch;Object.assign(globalThis,{window:previousWindow})}
})

test("refresh keeps dirty set and note bases until each editor explicitly resolves the conflict", async () => {
  const entry = {
    id: "synthetic-entry", item_key: "synthetic", occurrence_id: "exercise-a",
    revision: 1, session_revision: 1, before_value: null, actor_sub: "synthetic",
    source: "browser" as const, reason: "Fixture", recorded_at: "synthetic",
  };
  const set = { ...entry, kind: "strength_set", set_ordinal: 1,
    value: { reps: 6, load: null, rpe: null, source: "user_reported" as const } };
  const note = { ...entry, id: "synthetic-note", kind: "exercise_note", set_ordinal: 0,
    value: { notes: "Original exercise note" } };
  const original: SessionResults = { ...data, entries: [set, note], notes: "Original workout note", notesRevision: 1 };
  const refreshed: SessionResults = { ...original, sessionRevision: 4, notes: "New server workout note", notesRevision: 2,
    entries: [
      { ...set, revision: 2, value: { ...set.value, reps: 8, load: { value: 15, unit: "kg", basis: "per_hand" }, rpe: 7.5 } },
      { ...note, revision: 2, value: { notes: "New server exercise note" } },
    ] };
  let tree!: ReactTestRenderer;
  const writes: {item:unknown; revision:number}[] = [];
  const save = async (item: unknown, revision: number) => { writes.push({item,revision}); };
  const view = (current: SessionResults) => <PlayerView workout={workout} data={current} busy={false} save={save} changed={()=>{}} />;
  await act(async () => { tree = create(view(original)); });
  const fields = () => tree.root.findAllByType("fieldset");
  const button = (field:number,label:string) => fields()[field].findAllByType("button").find(node=>node.props.children===label)!;
  await act(async () => { button(0,"Edit").props.onClick(); });
  await act(async () => {
    fields()[0].findAllByType("input")[0].props.onChange({target:{value:"7"}});
    fields()[2].findByType("textarea").props.onChange({target:{value:"Exercise draft"}});
    fields()[4].findByType("textarea").props.onChange({target:{value:"Workout draft"}});
  });
  // A read after another editor's save returns newer versions of all dirty items.
  await act(async () => { tree.update(view(refreshed)); });
  assert.equal(fields()[0].findAllByType("input")[0].props.value,"7");
  assert.equal(fields()[2].findByType("textarea").props.value,"Exercise draft");
  assert.equal(fields()[4].findByType("textarea").props.value,"Workout draft");
  assert.match(text(tree),/15 kg \(per hand\)/);
  assert.match(text(tree),/New server exercise note/);
  assert.match(text(tree),/New server workout note/);
  for (const [field,label] of [[0,"Save"],[2,"Save Notes"],[4,"Save Notes"]] as const) {
    assert.equal(button(field,label).props.disabled,true);
    await act(async () => { button(field,label).props.onClick(); });
  }
  assert.equal(writes.length,0);
  await act(async () => { button(2,"Use server value").props.onClick(); });
  assert.equal(fields()[2].findByType("textarea").props.value,"New server exercise note");
  await act(async () => { button(0,"Keep my draft").props.onClick(); });
  assert.equal(button(4,"Save Notes").props.disabled,true);
  await act(async () => { button(0,"Save").props.onClick(); });
  assert.deepEqual(writes[0],{revision:2,item:{kind:"strength_set",occurrenceId:"exercise-a",setOrdinal:1,
    actual:{reps:7,load:null,rpe:null,source:"user_reported"}}});
  await act(async () => { button(4,"Keep my draft").props.onClick(); });
  await act(async () => { button(4,"Save Notes").props.onClick(); });
  assert.deepEqual(writes[1],{revision:2,item:{kind:"workout_note",notes:"Workout draft"}});
  await act(async () => tree.unmount());
});

test("legacy overall note changes also conflict, while an already-sent command can replay unchanged", async () => {
  const original = { ...data, notes: "Original legacy note" };
  const refreshed = { ...original, notes: "New legacy note", sessionRevision: 2 };
  let tree!: ReactTestRenderer;
  const attempts: unknown[] = [];
  const save = async (item: unknown, revision: number, pending: {current:unknown}) => {
    pending.current ??= {item,revision,idempotencyKey:"synthetic-retry-key"};
    attempts.push(pending.current);
    if(attempts.length===1) throw new PlayerError("failed");
  };
  const view = (current: SessionResults) => <PlayerView workout={workout} data={current} busy={false} save={save} changed={()=>{}} />;
  await act(async () => {tree=create(view(original));});
  const note = () => tree.root.findAllByType("fieldset").at(-1)!;
  const button = (label:string) => note().findAllByType("button").find(node=>node.props.children===label)!;
  await act(async () => note().findByType("textarea").props.onChange({target:{value:"First draft"}}));
  await act(async () => {button("Save Notes").props.onClick();});
  await act(async () => {tree.update(view(refreshed));});
  assert.match(text(tree),/Conflict/);
  assert.equal(note().findByType("textarea").props.value,"First draft");
  await act(async () => {button("Retry previous save").props.onClick();});
  assert.strictEqual(attempts[0],attempts[1]);
  await act(async () => tree.unmount());
});

test("one tap submits verified prescription, retries identical bytes, and checks only after actual readback", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {}, confirm() { return true; } } });
  const planned = structuredClone(workout);
  planned.snapshot!.exercises[0].target = { value: 20, unit: "lb" };
  planned.snapshot!.exercises[0].loadBasis = "per_hand";
  let tree!: ReactTestRenderer;
  const payloads: string[] = [];
  let server = data;
  let exposeActual = false;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") {
      payloads.push(String(init.body));
      const command = JSON.parse(String(init.body));
      server = {
        ...data, sessionRevision: 2, entries: [{
          id: "entry", item_key: "set", occurrence_id: "exercise-a", kind: "strength_set",
          set_ordinal: 1, revision: 1, session_revision: 2, before_value: null,
          actor_sub: "synthetic", source: "browser", reason: "Fixture",
          recorded_at: "synthetic", value: command.item.actual,
        }],
      };
      return Response.json({ actualSessionId: workout.id, sessionRevision: 2 });
    }
    return Response.json(exposeActual ? server : { ...server, entries: [] });
  };
  try {
    await act(async () => { tree = create(<WorkoutPlayer workout={planned} onBack={() => {}} />); });
    const bubble = () => tree.root.findAllByType("button").find(
      (node) => /^(Retry )?Log Set 1$/.test(node.props["aria-label"] ?? ""),
    )!;
    await act(async () => bubble().props.onClick());
    assert.match(text(tree), /Failed/);
    assert.doesNotMatch(text(tree), /✓/);
    exposeActual = true;
    await act(async () => bubble().props.onClick());
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0], payloads[1]);
    assert.deepEqual(JSON.parse(payloads[0]).item.actual, {
      reps: 10, load: { value: 20, unit: "lb", basis: "per_hand" }, rpe: null, source: "user_reported",
    });
    assert.match(text(tree), /✓/);
  } finally {
    if (tree) await act(async () => tree.unmount());
    globalThis.fetch = previousFetch;
    Object.assign(globalThis, { window: previousWindow });
  }
});

test("steady rows retain pinned output and unknown interval durations invalidate later planned clock ranges", async () => {
  const planned = structuredClone(workout);
  const run = planned.snapshot!.exercises[1];
  run.warmups = [{
    phase: "warmup", modality: "run", label: "Warm-up", durationSeconds: 600,
    targets: [{ metric: "pace", unit: "sec/mi", range: { min: 500, max: 600 } }],
    rpe: null,
  }];
  run.intervalBlocks![0].segments[1].durationSeconds = null;
  run.intervalBlocks![0].segments[0].targets = [
    { metric: "speed", unit: "mph", range: { min: 7, max: 8 } },
    { metric: "rowing_split", unit: "sec/500m", range: { min: 95, max: 100 } },
  ];
  const render = (session: WorkoutSession) =>
    <PlayerView workout={session} data={data} busy={false} save={async () => assert.fail("read-only cardio")} changed={() => {}} />;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(render(planned)); });
  const rows = () => tree.root.findAll((node) => node.type === "div" && node.props.className === "cardioRow");
  const time = () => rows().map((row) => {
    const cell = row.children[2];
    return typeof cell === "string" ? cell : cell.props.children;
  });
  assert.deepEqual(time(), ["Running clock", "0:00–10:00", "10:00–11:00", "Unknown", "Unknown", "Unknown"]);
  assert.match(text(tree), /500–600 sec\/mi/);
  assert.match(text(tree), /7–8 mph/);
  assert.doesNotMatch(text(tree), /sec\/500m/);
  assert.equal(rows().flatMap((row) => row.findAllByType("button")).length, 0);
  const steady = structuredClone(planned);
  steady.snapshot!.kind = "bike";
  steady.snapshot!.occurrences = [{ id: "exercise-b", exercise: 0, key: "synthetic-run", type: "exercise" }];
  steady.snapshot!.exercises = [{ ...steady.snapshot!.exercises[1], intervalBlocks: undefined,
    warmups: undefined, durationSeconds: 360, targets: [
      { metric: "power", unit: "W", range: { min: 140, max: 150 } },
      { metric: "cycling_cadence", unit: "rpm", range: { min: 85, max: 90 } },
    ],
  }];
  await act(async () => tree.update(render(steady)));
  assert.deepEqual(time(), ["Time", "6:00"]);
  assert.match(text(tree), /140–150 W/);
  assert.match(text(tree), /85–90 rpm/);
  assert.equal(rows()[0].findAllByType("span")[3].props.children, "Speed/Output");
  await act(async () => tree.unmount());
});

test("warmup is read-only, empty proposals require Edit, and Cancel preserves other drafts", async () => {
  const planned = structuredClone(workout);
  const exercise = planned.snapshot!.exercises[0];
  exercise.reps = null;
  exercise.repsRange = undefined;
  exercise.target = { value: 10, unit: "kg" };
  exercise.loadBasis = "unverified";
  exercise.warmups = [{
    phase: "warmup", modality: "strength", label: "Easy practice",
    durationSeconds: null, targets: [], rpe: null,
    strength: { sets: 1, reps: 3, durationSeconds: null, target: null, loadBasis: "unverified" },
  }];
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<PlayerView workout={planned} data={data} busy={false} save={async () => assert.fail("no meaningful value")} changed={() => {}} />);
  });
  const buttons = () => tree.root.findAllByType("button");
  const rows = tree.root.findAll((node) => node.type === "div" && node.props.className === "strengthRow");
  assert.equal(rows[1].findAllByType("button").length, 0);
  assert.match(text(tree), /10 kg \(unverified\)/);
  await act(async () => buttons().find((node) => node.props["aria-label"] === "Log Set 1")!.props.onClick());
  assert.match(text(tree), /Use Edit to enter a value/);
  assert.equal(tree.root.findAllByType("input")[1].props.value, "");
  await act(async () => tree.root.findAllByType("input")[0].props.onChange({ target: { value: "4" } }));
  await act(async () => tree.root.findAllByType("textarea")[0].props.onChange({ target: { value: "Keep this note draft" } }));
  await act(async () => buttons().filter((node) => node.props.children === "Edit")[1].props.onClick());
  await act(async () => tree.root.findAllByType("input")[0].props.onChange({ target: { value: "5" } }));
  await act(async () => buttons().find((node) => node.props.children === "Cancel")!.props.onClick());
  assert.equal(tree.root.findAllByType("input").length, 0);
  await act(async () => buttons().filter((node) => node.props.children === "Edit")[0].props.onClick());
  assert.equal(tree.root.findAllByType("input")[0].props.value, "4");
  assert.equal(tree.root.findAllByType("textarea")[0].props.value, "Keep this note draft");
  await act(async () => tree.unmount());
});
