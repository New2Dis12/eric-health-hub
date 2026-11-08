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

type CardioRow = { label: string; duration: number | null; targets: MetricTarget[] };
const cardioKinds = ["run", "bike", "row", "ski", "swim"];
const cardioColumns = {
  run: ["Speed", "Incline"],
  bike: ["Output", "RPM", "Resistance"],
  row: ["Distance", "Split /500m", "SPM"],
  other: ["Target"],
} as const;

function cardioLayout(kind: string, rows: CardioRow[], segments: Segment[]) {
  const sports = new Set(segments.map(({ modality }) => modality).filter(modality => cardioKinds.includes(modality)));
  if (sports.size > 1) return "other";
  const [sport] = sports;
  if (sport) return sport === "run" || sport === "bike" || sport === "row" ? sport : "other";
  if (kind === "run" || kind === "bike" || kind === "row") return kind;
  if (kind !== "other") return "other";
  const metrics = rows.flatMap(({ targets }) => targets.map(({ metric }) => metric));
  if (metrics.includes("rowing_split") || metrics.includes("stroke_rate")) return "row";
  if (metrics.includes("cycling_cadence") || metrics.includes("resistance")) return "bike";
  if (metrics.includes("incline")) return "run";
  return "other";
}

function formattedTarget({ range, unit }: MetricTarget, omitUnit = false) {
  if (!range) return "";
  if (unit === "sec/500m" && Number.isInteger(range.min) && Number.isInteger(range.max)) {
    const start = elapsed(range.min);
    const split = range.min === range.max ? start : `${start}–${elapsed(range.max)}`;
    return omitUnit ? split : `${split} /500m`;
  }
  return omitUnit ? showRange(range) : `${showRange(range)}${unit === "%" ? "%" : ` ${unit}`}`;
}

function cardioTargets(targets: MetricTarget[], layout: keyof typeof cardioColumns) {
  const get = (metric: MetricTarget["metric"], omitUnit = false) => {
    const target = targets.find(item => item.metric === metric && item.range !== null);
    return target ? formattedTarget(target, omitUnit) : "";
  };
  switch (layout) {
    case "run": return [get("speed") || get("pace"), get("incline")];
    case "bike": return [get("power"), get("cycling_cadence", true), get("resistance")];
    case "row": return [get("distance"), get("rowing_split", true), get("stroke_rate", true)];
    default: return [targets.map(target => formattedTarget(target)).filter(Boolean).join(" · ")];
  }
}

function CardioRows({ rows, clockStart, intervals, layout }: {
  rows: CardioRow[]; clockStart: number | null; intervals: boolean; layout: keyof typeof cardioColumns;
}) {
  let clock = clockStart;
  return (
    <div role="table" aria-label="Prescribed cardio" data-cardio={layout} className={styles.cardioTable}>
      <div className={styles.cardioRow} role="row">
        <span role="columnheader">Time</span>
        <span role="columnheader">Segment</span>
        {cardioColumns[layout].map(column => <span role="columnheader" key={column}>{column}</span>)}
      </div>
      {rows.map(({ label, duration, targets }, index) => {
        const start: number | null = clock;
        const end: number | null = start === null || duration === null ? null : start + duration;
        const range = intervals && start !== null && end !== null;
        const time = duration === null ? "" : range ? `${elapsed(start)}–${elapsed(end)}` : elapsed(duration);
        clock = end;
        return (
          <div className={styles.cardioRow} role="row" key={index}>
            <span role="cell" className={styles.clock} aria-label={time ? `${range ? "Planned elapsed range" : "Prescribed segment duration"} ${time}` : undefined}>{time}</span>
            <span role="cell">{label}</span>
            {cardioTargets(targets, layout).map((target, i) => <span role="cell" key={i}>{target}</span>)}
          </div>
        );
      })}
    </div>
  );
}

function segmentRow(segment: Segment, label = segment.label): CardioRow {
  return { label, duration: segment.durationSeconds, targets: segment.targets };
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
  const hasStrength = snapshot.exercises.some(exercise => strengthExercise(snapshot.kind, exercise) ||
    [...(exercise.warmups ?? []), ...(exercise.intervalBlocks ?? []).flatMap(block => block.segments)]
      .some(segment => segment.modality === "strength"));
  const cardioOnly = !hasStrength && (cardioKinds.includes(snapshot.kind) ||
    (snapshot.kind === "other" && snapshot.exercises.every(exercise => {
      const segments = [...(exercise.warmups ?? []), ...(exercise.intervalBlocks ?? []).flatMap(block => block.segments)];
      return segments.some(segment => cardioKinds.includes(segment.modality)) ||
        !!exercise.targets?.length || exercise.target?.unit === "mph" || exercise.target?.unit === "km/h";
    })));
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
        const steadyTargets = [...(exercise.targets ?? [])];
        if (exercise.target && (exercise.target.unit === "mph" || exercise.target.unit === "km/h") &&
            !steadyTargets.some(target => (target.metric === "speed" || target.metric === "pace") && target.range)) {
          steadyTargets.push({ metric: "speed", unit: exercise.target.unit,
            range: { min: exercise.target.value, max: exercise.target.value } });
        }
        const phaseCount: Record<string, number> = {};
        const intervalRow = (segment: Segment) => {
          const phase = { warmup: "Warm-up", work: "Work", recovery: "Recovery", cooldown: "Cool-down", transition: "Transition" }[segment.phase];
          const number = phaseCount[phase] = (phaseCount[phase] ?? 0) + 1;
          return segmentRow(segment, segment.phase === "work" || segment.phase === "recovery" || number > 1
            ? `${phase} ${number}` : phase);
        };
        const cardioRows = strength && !blocks.length ? [] : [
          ...warmups.map(segment => blocks.length ? intervalRow(segment) : segmentRow(segment)),
          ...(blocks.length ? blocks.flatMap(block =>
            Array.from({ length: block.repeat }, () => block.segments.map(intervalRow)).flat(),
          ) : [{ label: exercise.name, duration: exercise.durationSeconds, targets: steadyTargets }]),
        ];
        const layout = cardioLayout(snapshot.kind, cardioRows, [...warmups, ...blocks.flatMap(block => block.segments)]);
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
              layout={layout} />}
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
            {!cardioOnly && <Note
              title="Exercise Notes"
              identity={occurrence.id}
              initial={note && "notes" in note.value ? note.value.notes : ""}
              revision={note?.revision ?? 0}
              item={{ kind: "exercise_note", occurrenceId: occurrence.id }}
              disabled={disabled}
              busy={busy}
              save={save}
              changed={changed}
            />}
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
