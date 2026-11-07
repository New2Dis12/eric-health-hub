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
  const snapshot = {exerciseCount: tree.root.findAllByType('section').length, setCount: tree.root.findAllByType('legend').length, noteCount: tree.root.findAllByType('textarea').length, rpeOptionCount:22, proposedReps:tree.root.findAllByType('input')[0].props.value, initialLoad:tree.root.findAllByType('input')[1].props.value};
    assert.deepEqual(snapshot,JSON.parse(readFileSync(new URL('./fixtures/player-mobile.snapshot.json',import.meta.url),'utf8')));
    assert.match(readFileSync(new URL('../app/app/player.module.css',import.meta.url),'utf8'),/min-height: 44px/);
    assert.equal(writes, 0);
  assert.match(text(tree), /Proposed/);
  assert.match(text(tree), /interval entry coming next/);
  const inputs = tree.root.findAllByType("input");
  assert.equal(inputs[0].props.value, "10");
  assert.equal(inputs[1].props.value, "");
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
  const edit = tree.root
    .findAllByType("button")
    .find((n) => n.props.children === "Edit reps")!;
  await act(async () => edit.props.onClick());
  assert.equal(tree.root.findAllByType("input")[0].props.readOnly, false);
  await act(async () =>
    tree.root
      .findAllByType("input")[0]
      .props.onChange({ target: { value: "7" } }),
  );
  await act(async () =>
    tree.root
      .findAllByType("button")
      .find((n) => n.props.children === "Log Set")!
      .props.onClick(),
  );
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
  assert.equal(tree.root.findAllByType("input")[0].props.value, "3");
  assert.equal(tree.root.findAllByType("fieldset")[0].props.disabled, true);
  assert.match(text(tree), /per_hand/);
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
  await act(async () => {
    button(0,"Edit reps").props.onClick();
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
  for (const [field,label] of [[0,"Update Set"],[2,"Save Notes"],[4,"Save Notes"]] as const) {
    assert.equal(button(field,label).props.disabled,true);
    await act(async () => { button(field,label).props.onClick(); });
  }
  assert.equal(writes.length,0);
  await act(async () => { button(2,"Use server value").props.onClick(); });
  assert.equal(fields()[2].findByType("textarea").props.value,"New server exercise note");
  await act(async () => { button(0,"Keep my draft").props.onClick(); });
  assert.equal(button(4,"Save Notes").props.disabled,true);
  await act(async () => { button(0,"Update Set").props.onClick(); });
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
