"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkoutSession } from "@/lib/training/session";
import type {
  LogInput,
  LogEntry,
  SessionResults,
} from "@/lib/training/logging-models";
import type { Segment } from "@/lib/training/context-models";
import {
  loadPlayerResults,
  savePlayerItem,
  PlayerError,
  proposedReps,
  rpeOptions,
} from "@/lib/training/player-client";
import styles from "./player.module.css";

type Item = LogInput["item"];
type Save = (
  item: Item,
  revision: number,
  command: React.MutableRefObject<unknown>,
) => Promise<void>;
const optionalNumber = (value: string) => (value === "" ? null : Number(value));
function SetRow({
  occurrence,
  ordinal,
  reps,
  saved,
  disabled,
  busy,
  save,
  changed,
}: {
  occurrence: string;
  ordinal: number;
  reps: number | null;
  saved?: LogEntry;
  disabled: boolean;
  busy: boolean;
  save: Save;
  changed: (key: string, dirty: boolean) => void;
}) {
  const actual =
    saved?.kind === "strength_set" && "reps" in saved.value
      ? saved.value
      : undefined;
  const fromSaved = () => ({
    reps:
      actual?.reps == null
        ? saved
          ? ""
          : String(reps ?? "")
        : String(actual.reps),
    load: actual?.load ? String(actual.load.value) : "",
    unit: actual?.load?.unit ?? "",
    basis: actual?.load?.basis ?? "",
    rpe: actual?.rpe == null ? "" : String(actual.rpe),
  });
  const [draft, setDraft] = useState(fromSaved);
  const [dirty, setDirty] = useState(false);
  const [edit, setEdit] = useState(false);
  const [status, setStatus] = useState(
    saved ? "Saved · Logged" : "Not logged · Proposed reps are unsaved",
  );
  const pending = useRef<unknown>(null);
  const key = `${occurrence}:${ordinal}`;
  useEffect(() => {
    if (!dirty) {
      setDraft(fromSaved());
      setStatus(
        saved ? "Saved · Logged" : "Not logged · Proposed reps are unsaved",
      );
    }
  }, [saved, dirty]);
  function update(field: string, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
    changed(key, true);
    pending.current = null;
    setStatus("Unsaved");
  }
  async function submit() {
    setStatus("Saving…");
    try {
      if (draft.load !== "" && (!draft.unit || !draft.basis)) {
        setStatus("Choose a load unit and basis");
        return;
      }
      await save(
        {
          kind: "strength_set",
          occurrenceId: occurrence,
          setOrdinal: ordinal,
          actual: {
            reps: optionalNumber(draft.reps),
            load:
              draft.load === ""
                ? null
                : {
                    value: Number(draft.load),
                    unit: draft.unit as "kg" | "lb",
                    basis: draft.basis as
                      "total" | "per_hand" | "added" | "bodyweight",
                  },
            rpe: optionalNumber(draft.rpe),
            source: "user_reported",
          },
        },
        saved?.revision ?? 0,
        pending,
      );
      setDirty(false);
      changed(key, false);
      pending.current = null;
      setStatus("Saved · Logged");
    } catch (e) {
      setStatus(
        e instanceof PlayerError && e.kind === "conflict"
          ? "Conflict — current server values refreshed. Draft retained. Review and retry."
          : e instanceof PlayerError && e.kind === "access"
            ? "Access unavailable. Sign in and reopen this workout."
            : "Failed — retry safely",
      );
      setDirty(true);
      changed(key, true);
    }
  }
  return (
    <fieldset className={styles.set} disabled={disabled || busy}>
      <legend>
        Set {ordinal} · {saved ? "Logged actual" : "Proposed · unsaved"}
      </legend>
      {saved && (
        <p>
          Server actual reps {actual?.reps ?? "Not entered"} · revision{" "}
          {saved.revision}
        </p>
      )}
      <div className={styles.fields}>
        <label>
          Reps
          <input
            inputMode="numeric"
            type="number"
            min="0"
            max="500"
            step="1"
            readOnly={!edit}
            value={draft.reps}
            onChange={(e) => update("reps", e.target.value)}
          />
        </label>
        <button type="button" onClick={() => setEdit(true)}>
          Edit reps
        </button>
        <label>
          Actual load
          <input
            inputMode="decimal"
            type="number"
            min="0"
            max="2000"
            step="any"
            value={draft.load}
            onChange={(e) => update("load", e.target.value)}
          />
        </label>
        <label>
          Load unit
          <select
            value={draft.unit}
            onChange={(e) => update("unit", e.target.value)}
          >
            <option value="">Not entered</option>
            <option>kg</option>
            <option>lb</option>
          </select>
        </label>
        <label>
          Load basis
          <select
            value={draft.basis}
            onChange={(e) => update("basis", e.target.value)}
          >
            <option value="">Not entered</option>
            <option value="total">Total</option>
            <option value="per_hand">Per hand</option>
            <option value="added">Added</option>
            <option value="bodyweight">Bodyweight</option>
          </select>
        </label>
        <label>
          Actual RPE (optional)
          <select
            value={draft.rpe}
            onChange={(e) => update("rpe", e.target.value)}
          >
            <option value="">Not entered</option>
            {draft.rpe && !rpeOptions.includes(draft.rpe) && <option value={draft.rpe}>Saved {draft.rpe}</option>}
            {rpeOptions.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" onClick={() => void submit()}>
        {saved ? "Update Set" : "Log Set"}
      </button>
      <p role="status">{status}</p>
    </fieldset>
  );
}
function Note({
  title,
  initial,
  revision,
  item,
  disabled,
  busy,
  save,
  changed,
  identity,
}: {
  title: string;
  initial: string;
  revision: number;
  item:
    { kind: "exercise_note"; occurrenceId: string } | { kind: "workout_note" };
  disabled: boolean;
  busy: boolean;
  save: Save;
  changed: (key: string, dirty: boolean) => void;
  identity: string;
}) {
  const [draft, setDraft] = useState(initial),
    [dirty, setDirty] = useState(false),
    [status, setStatus] = useState("Saved");
  const pending = useRef<unknown>(null);
  useEffect(() => {
    if (!dirty) setDraft(initial);
  }, [initial, dirty]);
  async function submit() {
    setStatus("Saving…");
    try {
      await save({ ...item, notes: draft }, revision, pending);
      pending.current = null;
      setDirty(false);
      changed(identity, false);
      setStatus("Saved");
    } catch (e) {
      setDirty(true);
      changed(identity, true);
      setStatus(
        e instanceof PlayerError && e.kind === "conflict"
          ? "Conflict — server notes refreshed. Draft retained. Review and retry."
          : e instanceof PlayerError && e.kind === "access"
            ? "Access unavailable. Sign in and reopen."
            : "Failed — retry safely",
      );
    }
  }
  return (
    <fieldset className={styles.note} disabled={disabled || busy}>
      <label>
        {title}
        <textarea
          maxLength={4000}
          rows={3}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
            changed(identity, true);
            pending.current = null;
            setStatus("Unsaved");
          }}
        />
      </label>
      {dirty && initial !== draft && (
        <p>Current server notes: {initial || "Empty"}</p>
      )}
      <button type="button" onClick={() => void submit()}>
        Save Notes
      </button>
      <p role="status">{status}</p>
    </fieldset>
  );
}
function SegmentView({ segment }: { segment: Segment }) {
  return (
    <li>
      {segment.phase} · {segment.label} · {segment.modality}
      {segment.durationSeconds !== null && ` · ${segment.durationSeconds}s`}
      {segment.targets.map((target, i) => (
        <span key={i}>
          {" "}
          · {target.metric}{" "}
          {target.range
            ? `${target.range.min}–${target.range.max}`
            : "Unspecified"}{" "}
          {target.unit}
        </span>
      ))}
      {segment.strength && <span> · {segment.strength.sets??"Unspecified"} sets · {segment.strength.reps??"Unspecified"} reps · {segment.strength.loadBasis.replaceAll("_"," ")}</span>}
      {segment.rpe && ` · Planned RPE ${segment.rpe.min}–${segment.rpe.max}`}
    </li>
  );
}
export function PlayerView({
  workout,
  data,
  busy,
  save,
  changed,
}: {
  workout: WorkoutSession;
  data: SessionResults;
  busy: boolean;
  save: Save;
  changed: (key: string, dirty: boolean) => void;
}) {
  const snapshot = workout.snapshot;
  if (!snapshot)
    return <p>Legacy session — prescription not pinned. Read only.</p>;
  const disabled = data.status === "completed";
  return (
    <div className={styles.player}>
      <header>
        <h3>{snapshot.title}</h3>
        <p>{snapshot.purpose}</p>
        <p>{snapshot.overview?.rationale}</p>
        <p>
          Pinned revision {workout.prescriptionRevision} ·{" "}
          {disabled ? "Finalized · read only" : "In progress"} · session
          revision {data.sessionRevision}
        </p>
      </header>
      {snapshot.exercises.map((exercise, index) => {
        const occurrence = snapshot.occurrences.find(
          (o) => o.exercise === index && o.type === "exercise",
        );
        if (!occurrence)
          return (
            <p key={index}>
              Pinned exercise identity unavailable. Reopen the workout.
            </p>
          );
        const note = data.entries.find(
          (e) =>
            e.kind === "exercise_note" && e.occurrence_id === occurrence.id,
        );
        const strength =
          exercise.sets !== null &&
          (exercise.reps !== null ||
            !!exercise.repsRange ||
            (snapshot.kind === "strength" && !exercise.intervalBlocks?.length));
        return (
          <section className={styles.exercise} key={occurrence.id}>
            <h4>
              {index + 1}. {exercise.name}
              {exercise.optional ? " · Optional" : ""}
            </h4>
            <div className={styles.plan}>
              <h5>Prescribed</h5>
              <p>
                {exercise.sets ?? "Unspecified"} sets ·{" "}
                {exercise.repsRange
                  ? `${exercise.repsRange.min}–${exercise.repsRange.max}`
                  : (exercise.reps ?? "Unspecified")}{" "}
                reps
              </p>
              <p>
                Target{" "}
                {exercise.target
                  ? `${exercise.target.value} ${exercise.target.unit}`
                  : "Unspecified"}{" "}
                ·{" "}
                {exercise.loadBasis?.replaceAll("_", " ") ??
                  "Load basis unspecified"}
              </p>
              <p>
                Rest{" "}
                {exercise.restSeconds === null
                  ? "Unspecified"
                  : `${exercise.restSeconds}s`}
                {exercise.rpe &&
                  ` · RPE ${exercise.rpe.min}–${exercise.rpe.max}`}
              </p>
              {exercise.durationSeconds !== null && <p>Prescribed duration · {exercise.durationSeconds}s</p>}
              {exercise.targets?.map((target,i)=><p key={i}>{target.metric} {target.range?`${target.range.min}–${target.range.max}`:"Unspecified"} {target.unit}</p>)}
              <p>{exercise.notes}</p>
              <p>
                Previous performance is not attached to this pinned
                prescription.
              </p>
              {exercise.equipment && <p>Equipment · {exercise.equipment}</p>}
              {exercise.comparisonContext && (
                <p>Comparison context · {exercise.comparisonContext}</p>
              )}
              {exercise.adjustments?.map((rule, i) => (
                <p key={i}>
                  {rule.condition} · {rule.action}
                  {rule.substitution &&
                    ` · Alternative ${rule.substitution.name}`}
                </p>
              ))}
              {exercise.warmups?.length ? (
                <div>
                  <h5>Warm-up · read only</h5>
                  <ol>
                    {exercise.warmups.map((segment, i) => (
                      <SegmentView key={i} segment={segment} />
                    ))}
                  </ol>
                </div>
              ) : null}
              {exercise.intervalBlocks?.map((block, i) => (
                <div key={i}>
                  <h5>
                    {block.repeat} ordered rounds · interval entry coming next
                  </h5>
                  <ol>
                    {block.segments.map((segment, j) => (
                      <SegmentView key={j} segment={segment} />
                    ))}
                  </ol>
                </div>
              ))}
            </div>
            {strength && (
              <div>
                <h5>Actual · user reported</h5>
                {Array.from({ length: exercise.sets! }, (_, i) => (
                  <SetRow
                    key={i}
                    occurrence={occurrence.id}
                    ordinal={i + 1}
                    reps={proposedReps(exercise)}
                    saved={data.entries.find(
                      (e) =>
                        e.kind === "strength_set" &&
                        e.occurrence_id === occurrence.id &&
                        e.set_ordinal === i + 1,
                    )}
                    disabled={disabled}
                    busy={busy}
                    save={save}
                    changed={changed}
                  />
                ))}
              </div>
            )}
            <Note
              title="Exercise Notes"
              identity={occurrence.id}
              initial={note && "notes" in note.value ? note.value.notes : ""}
              revision={note?.revision ?? 0}
              item={{ kind: "exercise_note", occurrenceId: occurrence.id }}
              disabled={disabled}
              busy={busy}
              save={save}
              changed={changed}
            />
          </section>
        );
      })}
      <Note
        title="Overall Workout Notes"
        identity="overall"
        initial={data.notes}
        revision={data.notesRevision}
        item={{ kind: "workout_note" }}
        disabled={disabled}
        busy={busy}
        save={save}
        changed={changed}
      />
    </div>
  );
}
export function WorkoutPlayer({
  workout,
  onBack,
}: {
  workout: WorkoutSession;
  onBack: () => void;
}) {
  const [data, setData] = useState<SessionResults | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty = useRef(new Set<string>()),
    inFlight = useRef(false);
  const changed = (key: string, value: boolean) => {
    if (value) dirty.current.add(key);
    else dirty.current.delete(key);
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current.size || inFlight.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function refresh() {
    try {
      setData(await loadPlayerResults(fetch, workout.id));
      setError("");
    } catch {
      setError("Saved results unavailable. Sign in or retry this read.");
    }
  }
  useEffect(() => {
    let active = true;
    loadPlayerResults(fetch, workout.id)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setError("Saved results unavailable. Retry or sign in.");
      });
    return () => {
      active = false;
    };
  }, [workout.id]);
  const save: Save = async (item, revision, pending) => {
    if (inFlight.current || !data) throw new PlayerError("failed");
    inFlight.current = true;
    setBusy(true);
    pending.current ??= {
      operation: "log_workout",
      idempotencyKey: crypto.randomUUID(),
      reason: "Workout player confirmed input",
      sessionId: workout.id,
      expectedSessionRevision: data.sessionRevision,
      expectedItemRevision: revision,
      item,
    };
    try {
      setData(await savePlayerItem(fetch, workout.id, pending.current));
    } catch (e) {
      if (e instanceof PlayerError && e.kind === "conflict") {
        pending.current = null;
        await refresh();
      }
      throw e;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <section aria-label="Workout player">
      <button
        className={styles.back}
        type="button"
        disabled={busy}
        onClick={() => {
          if (
            !dirty.current.size ||
            window.confirm("Leave with unsaved changes?")
          )
            onBack();
        }}
      >
        Back to Overview
      </button>
      {error && (
        <div role="alert">
          {error}
          <button onClick={() => void refresh()}>Retry read</button>
        </div>
      )}
      {!workout.snapshot ? (
        <p>Legacy session — read only. No prescription available.</p>
      ) : data ? (
        <PlayerView
          workout={workout}
          data={data}
          busy={busy}
          save={save}
          changed={changed}
        />
      ) : (
        <p role="status">Loading saved actuals and notes…</p>
      )}
    </section>
  );
}
