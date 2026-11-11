import { z } from 'zod'

const date = z.iso.date()
const uuid = z.uuid()
export const historicalCategory = z.enum([
  'workout','measurement','bia_estimate','recovery','plan','benchmark',
  'profile','event','coaching','wearable_rule','nutrition','unknown',
])
export const modality = z.enum(['strength','run','bike','swim','row','ski','mobility','other'])
const load = z.strictObject({
  value: z.number().min(0).max(2000).nullable(),
  unit: z.enum(['kg','lb']).nullable(),
  basis: z.enum(['total','per_hand','added','bodyweight']).nullable(),
}).refine(v => (v.value === null) === (v.unit === null) && (v.unit === null) === (v.basis === null))
const strengthSummary = z.strictObject({
  exercise: z.string().min(1).max(150),
  sets: z.number().int().min(0).max(100).nullable(),
  reps: z.number().int().min(0).max(500).nullable(),
  load: load.nullable(),
  rpe: z.number().min(0).max(10).nullable(),
  verification: z.enum(['confirmed_set','partial_summary','unverified']),
})
const metric = z.strictObject({
  name: z.enum(['duration','distance','pace','speed','power','heart_rate','cadence','split','stroke_rate','other']),
  value: z.number().finite().nullable(),
  unit: z.string().min(1).max(30).nullable(),
  provenance: z.enum(['measured','reported','estimated']),
}).refine(m => m.value === null || m.unit !== null, 'Measured metric requires original unit')
const workout = z.strictObject({
  sourceRecordId: z.string().min(1).max(150),
  category: z.literal('workout'),
  occurredOn: date,
  modality,
  completion: z.enum(['confirmed','unknown']),
  precision: z.enum(['date','exact']),
  startedAt: z.iso.datetime({offset:true}).nullable(),
  rpe: z.number().min(0).max(10).nullable(),
  notes: z.string().max(4000).nullable(),
  strength: z.array(strengthSummary).max(100),
  metrics: z.array(metric).max(100),
  provenance: z.enum(['measured','reported','estimated','unknown']),
}).refine(r => (r.precision === 'date') === (r.startedAt === null),
  'Exact timestamps must be sourced, never fabricated')
const other = z.strictObject({
  sourceRecordId: z.string().min(1).max(150),
  category: historicalCategory.exclude(['workout']),
  occurredOn: date.nullable(),
  provenance: z.enum(['measured','reported','estimated','prescribed','unknown']),
  representation: z.enum(['represented','optional_unknowns','deferred']),
  // Structured private mapping only. No raw Markdown stored as a catch-all.
  attributes: z.record(z.string().min(1).max(80), z.union([
    z.string().max(2000), z.number().finite(), z.boolean(), z.null(),
  ])).refine(v => Buffer.byteLength(JSON.stringify(v)) <= 12000),
}).superRefine((r,ctx) => {
  if (r.category === 'measurement' && (
    !['weight','waist'].includes(String(r.attributes.kind)) ||
    typeof r.attributes.value !== 'number' ||
    !(['kg','lb','cm','in'].includes(String(r.attributes.unit))) ||
    (r.attributes.kind==='weight' && !['kg','lb'].includes(String(r.attributes.unit))) ||
    (r.attributes.kind==='waist' && !['cm','in'].includes(String(r.attributes.unit)))
  )) ctx.addIssue({code:'custom',message:'Measurement needs kind, original unit and value'})
  if (r.category === 'bia_estimate' && r.provenance !== 'estimated')
    ctx.addIssue({code:'custom',message:'BIA must be labeled estimated'})
  if (r.category === 'plan' && r.provenance !== 'prescribed')
    ctx.addIssue({code:'custom',message:'Prescriptions are not actuals'})
  if (r.category === 'recovery' && r.representation === 'represented' && r.attributes.completed === true)
    ctx.addIssue({code:'custom',message:'Recovery is not a completed workout'})
})
export const historicalRecord = z.union([workout,other])
export type HistoricalRecord = z.infer<typeof historicalRecord>
export const historicalBatch = z.strictObject({
  sourceKey: z.string().regex(/^[a-zA-Z0-9_.-]{1,120}$/),
  fileVersion: z.number().int().min(1).max(2147483646),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  authority: z.number().int().min(1).max(100),
  records: z.array(historicalRecord).max(500),
}).superRefine((b,ctx) => {
  const ids = b.records.map(r => r.sourceRecordId)
  if (new Set(ids).size !== ids.length) ctx.addIssue({code:'custom',message:'Duplicate source record IDs'})
})
export type HistoricalBatch = z.infer<typeof historicalBatch>
export const historicalPage = z.strictObject({
  sessionId: uuid.optional(),
  date: date.optional(),
  revisions: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(25),
  offset: z.number().int().min(0).max(10000).default(0),
})
export type HistoricalPage = z.infer<typeof historicalPage>
export type HistoricalPageInput = z.input<typeof historicalPage>

// Coordinator maps private files to these categories; unrecognized material remains explicit.
// This parser exposes structural headings only and never guesses dates, sets, or measurements.
export const sourceClasses = [
  'profile','block_prescriptions','baselines','training_log','body_composition',
  'wearable_rules','events_benchmarks','coaching_handoff','sync_manifest',
] as const
export type SourceClass = typeof sourceClasses[number]
export const classMapping: Record<SourceClass, readonly string[]> = {
  profile:['profile'],block_prescriptions:['plan'],baselines:['benchmark'],
  training_log:['workout','recovery'],body_composition:['measurement','bia_estimate','nutrition'],
  wearable_rules:['wearable_rule'],events_benchmarks:['event','benchmark'],
  coaching_handoff:['coaching','profile'],sync_manifest:['unknown'],
}
export function inspectMarkdownStructure(fileClass: SourceClass, markdown: string) {
  if (Buffer.byteLength(markdown,'utf8') > 2_000_000) throw new Error('Source too large')
  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)]
    .map(m => ({ level:m[1].length, heading:m[2].slice(0,200) }))
  return { fileClass, supportedCategories:classMapping[fileClass], headingCount:headings.length,
    // Never return raw source excerpts in a public coverage report.
    requiresPrivateMapping: true, deferredWhenUnmapped: ['unknown'] }
}
