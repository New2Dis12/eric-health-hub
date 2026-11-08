"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkoutSession } from "@/lib/training/session";
import type {
  LogInput,
  LogEntry,
  SessionResults,
} from "@/lib/training/logging-models";
import type { MetricTarget, Segment } from "@/lib/training/context-models";
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
type ActualLoad = NonNullable<Extract<Item, { kind: "strength_set" }>["actual"]["load"]>;
const loadBases: readonly ActualLoad["basis"][] = ["total", "per_hand", "added", "bodyweight"];
const showLoad = (load: { value: number; unit: string }) =>
  load.unit === "lb" ? String(load.value) : `${load.value} ${load.unit}`;

function SetRow({
  occurrence,
  ordinal,
  reps,
  target,
  basis,
  expanded,
  onExpand,
  onCollapse,
  saved,
  disabled,
  busy,
  resultsUnavailable,
  save,
  changed,
}: {
  occurrence: string;
  ordinal: number;
  reps: number | null;
  target: { value: number; unit: string } | null;
  basis?: string;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  saved?: LogEntry;
  disabled: boolean;
  busy: boolean;
  resultsUnavailable: boolean;
  save: Save;
  changed: (key: string, dirty: boolean) => void;
}) {
  const actual =
    saved?.kind === "strength_set" && "reps" in saved.value
      ? saved.value
      : undefined;
  const plannedLoad = target && (target.unit === "kg" || target.unit === "lb") ? target : null;
  const validBasis = loadBases.find((option) => option === basis);
  const proposedLoad = plannedLoad?.unit === "lb" && validBasis ? { ...plannedLoad, basis: validBasis } : null;
  const defaultLoad = saved ? actual?.load : proposedLoad;
  const exceptionalBasis = actual?.load && actual.load.basis !== (validBasis ?? "total")
    ? actual.load.basis.replaceAll("_", " ") : null;
  const fromSaved = (): { reps: string; load: string; unit: ActualLoad["unit"]; basis: ActualLoad["basis"]; rpe: string } => ({
    reps:
      actual?.reps == null
        ? saved
          ? ""
          : String(reps ?? "")
        : String(actual.reps),
    load: defaultLoad ? String(defaultLoad.value) : "",
    unit: actual?.load?.unit ?? "lb",
    basis: actual?.load?.basis ?? validBasis ?? "total",
    rpe: actual?.rpe == null ? "" : String(actual.rpe),
  });
  const [draft, setDraft] = useState(fromSaved);
  const [dirty, setDirty] = useState(false);
  const [writeConflict, setWriteConflict] = useState(false);
  const revision = saved?.revision ?? 0;
  const [draftRevision, setDraftRevision] = useState(revision);
  const conflict = writeConflict || (dirty && draftRevision !== revision);
  const [status, setStatus] = useState(
    saved ? "Saved · Logged" : "",
  );
  const pending = useRef<unknown>(null);
  const key = `${occurrence}:${ordinal}`;
  useEffect(() => {
    if (!dirty) {
      setDraft(fromSaved());
      setStatus(
        saved ? "Saved · Logged" : "",
      );
    }
  }, [saved, dirty]);
  function update(field: "reps" | "load" | "rpe", value: string) {
    if (!dirty) setDraftRevision(revision);
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
    changed(key, true);
    pending.current = null;
    setStatus("Unsaved");
  }
  function discard() {
    pending.current = null;
    setWriteConflict(false);
    setDirty(false);
    setDraft(fromSaved());
    setStatus(saved ? "Saved · Logged" : "");
    changed(key, false);
    onCollapse();
  }
  async function submit() {
    if (disabled || busy || resultsUnavailable) return;
    // An already-sent command may be replayed byte-for-byte. A new command
    // cannot use a revision the user has not accepted for this draft.
    if (conflict && !pending.current) return;
    if (!pending.current && draft.reps === "" && draft.load === "" && draft.rpe === "") {
      setStatus("Use Edit to enter a value before logging.");
      onExpand();
      return;
    }
    const baseRevision = dirty ? draftRevision : revision;
    setDraftRevision(baseRevision);
    setDirty(true);
    changed(key, true);
    setStatus("Saving…");
    try {
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
                    unit: draft.unit,
                    basis: draft.basis,
                  },
            rpe: optionalNumber(draft.rpe),
            source: "user_reported",
          },
        },
        baseRevision,
        pending,
      );
      setDirty(false);
      changed(key, false);
      pending.current = null;
      setWriteConflict(false);
      setStatus("Saved · Logged");
      onCollapse();
    } catch (e) {
      if (e instanceof PlayerError && e.kind === "conflict") {
        setWriteConflict(true);
        onExpand();
      }
      setStatus(
        e instanceof PlayerError && e.kind === "conflict"
          ? "Conflict — draft retained. Review the current server values before retrying."
          : e instanceof PlayerError && e.kind === "access"
            ? "Access unavailable. Sign in and reopen this workout."
            : "Failed — retry safely",
      );
      setDirty(true);
      changed(key, true);
    }
  }
  return (
    <fieldset className={styles.set} disabled={disabled || busy} aria-label={`Set ${ordinal}`}>
      <div className={styles.strengthRow}>
        {saved ? (
          <span className={styles.checked} role="img" aria-label="Logged">✓</span>
        ) : disabled ? (
          <span aria-label="Read only">—</span>
        ) : (
          <button
            className={styles.logBubble}
            type="button"
            aria-label={`${pending.current ? "Retry Log Set" : "Log Set"} ${ordinal}`}
            disabled={conflict && !pending.current}
            onClick={submit}
          >○</button>
        )}
        <span>{ordinal}<small>{saved ? "Actual" : dirty ? "Draft" : "Proposed"}</small></span>
        <span>{saved ? (actual?.load ? `${showLoad(actual.load)}${exceptionalBasis ? ` (${exceptionalBasis})` : ""}` : "—") :
          dirty ? (draft.load === "" ? "—" : showLoad({ value: Number(draft.load), unit: draft.unit })) :
          (plannedLoad ? `${showLoad(plannedLoad)}${proposedLoad ? "" : " target only"}` : "—")}</span>
        <span>{(saved ? actual?.reps : dirty ? optionalNumber(draft.reps) : reps) ?? "—"}</span>
        {disabled ? <span>—</span> : (
          <button type="button" className={styles.editSet} aria-expanded={expanded} onClick={onExpand}>Edit</button>
        )}
      </div>
      {saved && actual?.rpe != null && <small>Actual RPE {actual.rpe}</small>}
      {expanded && !disabled && (
        <div className={styles.editor}>
          <div className={styles.fields}>
            <label>
              Reps
              <input
                inputMode="numeric"
                type="number"
                min="0"
                max="500"
                step="1"
                value={draft.reps}
                onChange={(e) => update("reps", e.target.value)}
              />
            </label>
            <label>
              {`Load (${draft.unit})`}
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
          {conflict && !resultsUnavailable && (
            <DraftConflict
              keep={() => {
                pending.current = null;
                setWriteConflict(false);
                setDraftRevision(revision);
                setStatus("Unsaved · ready to save against the current value");
              }}
              discard={discard}
            />
          )}
          <button type="button" disabled={resultsUnavailable || (conflict && !pending.current)} onClick={submit}>
            {pending.current ? "Retry previous save" : "Save"}
          </button>{" "}
          <button type="button" onClick={discard}>Cancel</button>
        </div>
      )}
      <small role="status" className={styles.setStatus}>
        {conflict && resultsUnavailable
          ? "Conflict — draft retained. Retry read to load current server values."
          : conflict && !expanded ? "Conflict · open Edit to resolve" : status}
      </small>
    </fieldset>
  );
}
function DraftConflict({ keep, discard }: { keep: () => void; discard: () => void }) {
  return (
    <div>
      <p role="status">Conflict — the saved value changed. Review it before saving your draft.</p>
      <button type="button" onClick={keep}>Keep my draft</button>
      <button type="button" onClick={discard}>Use server value</button>
    </div>
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
  // The legacy observation command can change overall notes without a
  // workout-note entry revision. Compare the authoritative text as well.
  const [base, setBase] = useState({ revision, text: initial });
  const conflict = dirty && (base.revision !== revision || base.text !== initial);
  useEffect(() => {
    if (!dirty) setDraft(initial);
  }, [initial, dirty]);
  async function submit() {
    if (conflict && !pending.current) return;
    const draftBase = dirty ? base : { revision, text: initial };
    setBase(draftBase);
    setDirty(true);
    changed(identity, true);
    setStatus("Saving…");
    try {
      await save({ ...item, notes: draft }, draftBase.revision, pending);
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
            if (!dirty) setBase({ revision, text: initial });
            setDraft(e.target.value);
            setDirty(true);
            changed(identity, true);
            pending.current = null;
            setStatus("Unsaved");
          }}
        />
      </label>
      {dirty && (conflict || initial !== draft) && (
        <p>Current server notes: {initial || "Empty"}</p>
      )}
      {conflict && (
        <DraftConflict
          keep={() => {
            pending.current = null;
            setBase({ revision, text: initial });
            setStatus("Unsaved · ready to save against the current value");
          }}
          discard={() => {
            pending.current = null;
            setDirty(false);
            changed(identity, false);
            setStatus("Saved");
          }}
        />
      )}
      <button type="button" disabled={conflict && !pending.current} onClick={() => void submit()}>
        {conflict && pending.current ? "Retry previous save" : "Save Notes"}
      </button>
      <p role="status">{status}</p>
    </fieldset>
  );
}
function elapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const showRange = ({ min, max }: { min: number; max: number }) =>
  min === max ? String(min) : `${min}–${max}`;

function outputTargets(targets: MetricTarget[], modality: string) {
  return targets.filter(({ metric }) => {
    if (modality === "other" || modality === "strength") return true;
    switch (metric) {
      case "rowing_split":
      case "stroke_rate": return modality === "row";
      case "cycling_cadence": return modality === "bike";
      case "pace": return modality === "run" || modality === "ski";
      default: return true;
    }
  }).flatMap(({ range, unit }) =>
    range ? [`${showRange(range)} ${unit}`] : [],
  );
}

type CardioRow = { label: string; duration: number | null; output: string[]; occurrenceId?: string };

function ExecutionCheck({ row, entry, disabled, busy, unavailable, save, changed }: {
  row: CardioRow & { occurrenceId: string }; entry?: LogEntry;
  disabled: boolean; busy: boolean; unavailable: boolean; save: Save;
  changed: (key: string, dirty: boolean) => void;
}) {
  const checked = !!(entry && "checked" in entry.value && entry.value.checked);
  const [desired, setDesired] = useState<boolean | null>(null);
  const [status, setStatus] = useState("");
  const pending = useRef<unknown>(null);
  const key = `execution:${row.occurrenceId}`;
  async function toggle() {
    if (disabled || busy || unavailable) return;
    const next = desired ?? !checked;
    setDesired(next);
    changed(key, true);
    setStatus("Saving…");
    try {
      await save({ kind: "execution_check", occurrenceId: row.occurrenceId, checked: next }, entry?.revision ?? 0, pending);
      pending.current = null;
      setDesired(null);
      changed(key, false);
      setStatus("Saved");
    } catch (error) {
      setStatus(error instanceof PlayerError && error.kind === "conflict"
        ? "Conflict. Review current progress before retrying."
        : "Save unconfirmed.");
    }
  }
  if (disabled) return <span aria-label={checked ? "Marked, read only" : "Unmarked, read only"}>{checked ? "✓" : "—"}</span>;
  const action = desired === null ? (checked ? "Uncheck" : "Check") : (desired ? "Retry check" : "Retry uncheck");
  return (
    <div className={styles.checkCell}>
      <button type="button" className={styles.logBubble} aria-label={`${action} ${row.label}`}
        aria-pressed={checked} disabled={busy || unavailable} onClick={toggle}>
        {checked ? "✓" : "○"}{desired !== null && <small>Retry</small>}
      </button>
      <span className={styles.checkStatus} role="status">{status}</span>
    </div>
  );
}
function CardioRows({ rows, clockStart, intervals, data, disabled, busy, unavailable, save, changed }: {
  rows: CardioRow[]; clockStart: number | null; intervals: boolean;
  data: SessionResults; disabled: boolean; busy: boolean; unavailable: boolean; save: Save;
  changed: (key: string, dirty: boolean) => void;
}) {
  let clock = clockStart;
  const grid = intervals ? styles.intervalRow : styles.cardioRow;
  return (
    <div aria-label={intervals ? "Interval execution checklist" : "Prescribed steady cardio"}>
      <div className={grid}>
        {intervals && <span className={styles.completionHeading}>Completion</span>}<span>Workout</span>
        <span>{intervals ? "Running clock" : "Time"}</span><span>Speed/Output</span>
      </div>
      {rows.map((row, index) => {
        const { label, duration, output, occurrenceId } = row;
        const end: number | null = clock === null || duration === null ? null : clock + duration;
        const time = intervals
          ? (clock === null || end === null ? "Unknown" : `${elapsed(clock)}–${elapsed(end)}`)
          : (duration === null ? "Unknown" : elapsed(duration));
        clock = end;
        return (
          <div className={grid} key={occurrenceId ?? index}>
            {intervals && (occurrenceId ? <ExecutionCheck row={{ ...row, occurrenceId }}
              entry={data.entries.find((entry) => entry.kind === "execution_check" && entry.occurrence_id === occurrenceId)}
              disabled={disabled} busy={busy} unavailable={unavailable} save={save} changed={changed} />
              : <span aria-label="Pinned progress identity unavailable">—</span>)}
            <span>{label}</span><span className={styles.clock}>{time}</span>
            <span>{output.length ? output.map((value, i) => <small key={i}>{value}</small>) : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}
function segmentRow(segment: Segment, label = segment.label, occurrenceId?: string): CardioRow {
  return { label, occurrenceId, duration: segment.durationSeconds, output: outputTargets(segment.targets, segment.modality) };
}
function strengthExercise(kind: string, exercise: NonNullable<WorkoutSession["snapshot"]>["exercises"][number]) {
  return exercise.sets !== null &&
    (exercise.reps !== null || !!exercise.repsRange ||
      (kind === "strength" && !exercise.intervalBlocks?.length));
}
export function PlayerView({
  workout,
  data,
  busy,
  resultsUnavailable = false,
  save,
  changed,
}: {
  workout: WorkoutSession;
  data: SessionResults;
  busy: boolean;
  resultsUnavailable?: boolean;
  save: Save;
  changed: (key: string, dirty: boolean) => void;
}) {
  const [expandedSet, setExpandedSet] = useState<string | null>(null);
  const snapshot = workout.snapshot;
  if (!snapshot)
    return <p>Legacy session — prescription not pinned. Read only.</p>;
  const disabled = data.status === "completed";
  let clockStart: number | null = 0;
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
        {snapshot.exercises.some((exercise) => strengthExercise(snapshot.kind, exercise)) &&
          <p>Weight in lb; use total weight unless the prescribed exercise specifies per-hand, added, or bodyweight.</p>}
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
        const strength = strengthExercise(snapshot.kind, exercise);
        const warmups = exercise.warmups ?? [];
        const blocks = exercise.intervalBlocks ?? [];
        const modality = snapshot.kind;
        const steadyOutput = outputTargets(exercise.targets ?? [], modality);
        if (!steadyOutput.length && exercise.target && ["mph", "km/h"].includes(exercise.target.unit))
          steadyOutput.push(`${exercise.target.value} ${exercise.target.unit}`);
        const segmentIds = new Map(snapshot.occurrences.filter((item) => item.exercise === index && item.type !== "exercise")
          .map((item) => [`${item.type}:${item.block ?? ""}:${item.repeat ?? ""}:${item.segment}`, item.id]));
        const phaseCount: Record<string, number> = {};
        const intervalRow = (segment: Segment, identity: string) => {
          const phase = { warmup: "Warm-up", work: "Work", recovery: "Recovery", cooldown: "Cool-down", transition: "Transition" }[segment.phase] ?? segment.phase;
          const number = phaseCount[phase] = (phaseCount[phase] ?? 0) + 1;
          return segmentRow(segment, `${phase} ${number}`, segmentIds.get(identity));
        };
        const cardioRows = strength && !blocks.length ? [] : [
          ...warmups.map((segment, i) => blocks.length ? intervalRow(segment, `warmup:::${i}`) : segmentRow(segment)),
          ...(blocks.length ? blocks.flatMap((block, blockIndex) =>
            Array.from({ length: block.repeat }, (_, cycle) =>
              block.segments.map((segment, i) => intervalRow(segment, `interval:${blockIndex}:${cycle}:${i}`)),
            ).flat(),
          ) : [{ label: exercise.name, duration: exercise.durationSeconds, output: steadyOutput }]),
        ];
        const start = clockStart;
        for (const row of cardioRows) {
          clockStart = clockStart === null || row.duration === null ? null : clockStart + row.duration;
        }
        return (
          <section className={styles.exercise} key={occurrence.id}>
            <h4>
              {index + 1}. {exercise.name}
              {exercise.optional ? " · Optional" : ""}
            </h4>
            <div className={styles.plan}>
              {strength && <p>
                {exercise.sets ?? "Unspecified"} sets ·{" "}
                {exercise.repsRange
                  ? `${exercise.repsRange.min}–${exercise.repsRange.max}`
                  : (exercise.reps ?? "Unspecified")}{" "}
                reps
              </p>}
              {exercise.restSeconds !== null && <p>Rest {exercise.restSeconds}s</p>}
              {exercise.rpe && <p>Prescribed RPE {exercise.rpe.min}–{exercise.rpe.max}</p>}
              {exercise.notes && <p>{exercise.notes}</p>}
              {strength && exercise.loadBasis && loadBases.some((basis) => basis !== "total" && basis === exercise.loadBasis) &&
                <p>Load convention: {exercise.loadBasis.replaceAll("_", " ")}</p>}
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
            </div>
            {cardioRows.length > 0 && <CardioRows rows={cardioRows} clockStart={start} intervals={blocks.length > 0}
              data={data} disabled={disabled} busy={busy} unavailable={resultsUnavailable} save={save} changed={changed} />}
            {strength && (
              <div aria-label="Strength sets">
                <div className={styles.strengthRow}>
                  <span className={styles.completionHeading}>Completion</span><span>Set</span><span>Load (lb)</span><span>Reps</span><span>Edit</span>
                </div>
                {!blocks.length && warmups.map((segment, i) => (
                  <div className={styles.strengthRow} key={i}>
                    <span aria-label="Warm-up, prescription only">—</span>
                    <span>Warm-up · {segment.label}
                      {segment.durationSeconds !== null && <small>{elapsed(segment.durationSeconds)}</small>}
                      {segment.strength?.sets != null && <small>{segment.strength.sets} sets</small>}
                    </span>
                    <span>{segment.strength?.target ? showLoad(segment.strength.target) : "—"}</span>
                    <span>{segment.strength?.reps ?? "—"}</span><span>—</span>
                  </div>
                ))}
                {Array.from({ length: exercise.sets! }, (_, i) => (
                  <SetRow
                    key={i}
                    occurrence={occurrence.id}
                    ordinal={i + 1}
                    reps={proposedReps(exercise)}
                    target={exercise.target}
                    basis={exercise.loadBasis}
                    expanded={expandedSet === `${occurrence.id}:${i + 1}`}
                    onExpand={() => setExpandedSet(`${occurrence.id}:${i + 1}`)}
                    onCollapse={() => setExpandedSet((current) => current === `${occurrence.id}:${i + 1}` ? null : current)}
                    saved={data.entries.find(
                      (e) =>
                        e.kind === "strength_set" &&
                        e.occurrence_id === occurrence.id &&
                        e.set_ordinal === i + 1,
                    )}
                    disabled={disabled}
                    busy={busy}
                    resultsUnavailable={resultsUnavailable}
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
  async function retryRead() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
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
    if (inFlight.current || !data || error) throw new PlayerError("failed");
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
      const current = await savePlayerItem(fetch, workout.id, pending.current);
      if (item.kind === "strength_set" && !current.entries.some((entry) =>
        entry.kind === item.kind && entry.occurrence_id === item.occurrenceId &&
        entry.set_ordinal === item.setOrdinal && entry.revision > revision
      )) throw new PlayerError("failed");
      if (item.kind === "execution_check") {
        const entry = current.entries.find((entry) => entry.kind === item.kind && entry.occurrence_id === item.occurrenceId);
        if (!entry || entry.revision <= (pending.current as { expectedItemRevision: number }).expectedItemRevision || !("checked" in entry.value)) throw new PlayerError("failed");
        if (entry.value.checked !== item.checked) {
          setData(current);
          throw new PlayerError("conflict");
        }
      }
      setData(current);
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
          <button type="button" disabled={busy} onClick={retryRead}>Retry read</button>
        </div>
      )}
      {!workout.snapshot ? (
        <p>Legacy session — read only. No prescription available.</p>
      ) : data ? (
        <PlayerView
          workout={workout}
          data={data}
          busy={busy || !!error}
          resultsUnavailable={!!error}
          save={save}
          changed={changed}
        />
      ) : (
        <p role="status">Loading saved actuals and notes…</p>
      )}
    </section>
  );
}
