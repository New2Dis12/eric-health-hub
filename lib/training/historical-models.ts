import { z } from 'zod'
import { createHash } from 'node:crypto'

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
  // Optional stable identity shared by multiple independent source files.
  logicalRecordId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,150}$/).optional(),
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
// Exclude fenced Markdown examples without shifting marker offsets.
function maskFencedMarkdown(markdown: string): string {
  let fence: {char:string;length:number}|null = null
  return markdown.split(/(\r?\n)/).map(line => {
    if (line === '\n' || line === '\r\n') return line
    if (fence) {
      const close = new RegExp('^ {0,3}' + fence.char + '{' + fence.length + ',}[ \\t]*$')
      if (close.test(line)) fence = null
      return ' '.repeat(line.length)
    }
    const open = /^ {0,3}(\x60{3,}|~{3,})[^\r\n]*$/.exec(line)
    if (open) { fence = {char:open[1][0],length:open[1].length}; return ' '.repeat(line.length) }
    return line
  }).join('')
}
export function inspectMarkdownStructure(fileClass: SourceClass, markdown: string) {
  if (Buffer.byteLength(markdown,'utf8') > 2_000_000) throw new Error('Source too large')
  const visible=maskFencedMarkdown(markdown)
  const headings = [...visible.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)]
    .map(m => ({ level:m[1].length, heading:m[2].slice(0,200) }))
  return { fileClass, supportedCategories:classMapping[fileClass], headingCount:headings.length,
    // Never return raw source excerpts in a public coverage report.
    requiresPrivateMapping: true, deferredWhenUnmapped: ['unknown'] }
}

// Strict, private-only Markdown adapter. A source record must carry an explicit,
// stable marker; unmarked headings and ambiguous values are enumerated, not guessed.
// Example: <!-- stunna-record: session-1 --> followed by '- category: workout'.
export function normalizeHistoricalMarkdown(input: {
  fileClass: SourceClass; sourceKey: string; fileVersion: number;
  authority: number; markdown: string
}) {
  if (Buffer.byteLength(input.markdown,'utf8') > 2_000_000) throw new Error('Source too large')
  const visible=maskFencedMarkdown(input.markdown)
  const marker = /<!--\s*stunna-record:\s*([a-zA-Z0-9_.:-]{1,150})\s*-->/g
  const matches=[...visible.matchAll(marker)]
  const records: HistoricalRecord[]=[]
  const unmappedCategories = new Set<string>()
  const deferredIds:string[]=[]
  const expected=new Set<string>(classMapping[input.fileClass])
  if (!matches.length) unmappedCategories.add('unmarked_markdown')
  // Heading boundaries isolate records: a later unmarked heading cannot
  // donate its fields to the preceding marked record.
  const headingStarts=[...visible.matchAll(/^#{1,6}\s+[^\r\n]+/gm)]
    .map(match=>match.index!)
  const sections=visible.split(/(?=^#{1,6}\s+[^\r\n]+)/gm)
  // Only valid unfenced markers suppress unmapped-section accounting.
  const unmarkedSectionCount=sections.filter(section=>
    section.trim() && !new RegExp(marker.source).test(section)).length
  if (unmarkedSectionCount) unmappedCategories.add('unmarked_sections')
  for (let i=0;i<matches.length;i++) {
    const id=matches[i][1]
    const nextMarker=i+1<matches.length?matches[i+1].index!:visible.length
    const nextHeading=headingStarts.find(start=>start>matches[i].index!)
      ??visible.length
    const text=visible.slice(matches[i].index!+matches[i][0].length,
      Math.min(nextMarker,nextHeading))
    const fields:Record<string,string>={}
    for (const line of text.split(/\r?\n/)) {
      const pair=/^\s*-\s+([a-zA-Z][a-zA-Z0-9_.]*):\s*(.*?)\s*$/.exec(line)
      if (pair) fields[pair[1]]=pair[2]
    }
    const category=fields.category??'unknown'
    if (!expected.has(category)) unmappedCategories.add(category)
    // All ambiguous or malformed records remain explicit deferred evidence.
    const defer=(reason:string)=>{
      deferredIds.push(id)
      records.push({sourceRecordId:id,category:'unknown',occurredOn:null,
        provenance:'unknown',representation:'deferred',
        attributes:{reason,sourceCategory:category}})
    }
    if (!expected.has(category)) {
      defer(fields.category===undefined?'missing_category':'unsupported_category');continue
    }
    if (category==='workout') {
      const on=fields.occurredOn
      const precision=fields.precision
      const completion=fields.completion
      if (!on || !/^\d{4}-\d{2}-\d{2}$/.test(on) ||
          !fields.modality || !precision || !completion) {
        defer('incomplete_workout');continue
      }
      let strength:unknown=[],metrics:unknown=[]
      try {
        if (fields.strength) strength=JSON.parse(fields.strength)
        if (fields.metrics) metrics=JSON.parse(fields.metrics)
        // Native Markdown tables can carry partial sets without JSON or
        // fabricated reps. Unknown/blank numeric cells become truthful nulls.
        const lines=text.split(/\r?\n/).filter(line=>/^\s*\|/.test(line))
        const cells=(line:string)=>line.trim().replace(/^\|/,'').replace(/\|$/,'')
          .split('|').map(cell=>cell.trim())
        const number=(value:string)=>value && value!=='?' && value!=='unknown'
          ? Number(value) : null
        for(let n=0;n<lines.length;n++){
          const header=cells(lines[n])
          if(header.join('|')==='exercise|sets|reps|load|unit|basis|rpe|verification') {
            const rows:unknown[]=[]
            for(let j=n+2;j<lines.length;j++){
              const row=cells(lines[j]); if(row.length!==8) break
              const loadValue=number(row[3])
              rows.push({exercise:row[0],sets:number(row[1]),reps:number(row[2]),
                load:loadValue===null?null:{value:loadValue,unit:row[4],basis:row[5]},
                rpe:number(row[6]),verification:row[7]})
            }
            strength=rows
          }
        }
      } catch {defer('invalid_structured_observation');continue}
      const parsed=historicalRecord.safeParse({
        sourceRecordId:id,logicalRecordId:fields.logicalRecordId||undefined,
        category:'workout',occurredOn:on,modality:fields.modality,
        completion,precision,startedAt:fields.startedAt||null,
        rpe:fields.rpe && fields.rpe!=='unknown'?Number(fields.rpe):null,
        notes:fields.notes||null,strength,metrics,provenance:fields.provenance||'unknown',
      })
      if (!parsed.success) {defer('invalid_workout');continue}
      records.push(parsed.data)
    } else {
      const attrs:Record<string,string|number|boolean|null>={}
      for (const [key,value] of Object.entries(fields)) if (key.startsWith('attr.')) {
        const name=key.slice(5)
        if (value==='null') attrs[name]=null
        else if (value==='true'||value==='false') attrs[name]=value==='true'
        else if (/^-?\d+(?:\.\d+)?$/.test(value)) attrs[name]=Number(value)
        else attrs[name]=value
      }
      const parsed=historicalRecord.safeParse({sourceRecordId:id,category,
        occurredOn:fields.occurredOn||null,provenance:fields.provenance||'unknown',
        representation:fields.representation||'deferred',attributes:attrs})
      if (!parsed.success) {defer('invalid_nonworkout');continue}
      records.push(parsed.data)
    }
  }
  const batch=historicalBatch.parse({
    sourceKey:input.sourceKey,fileVersion:input.fileVersion,authority:input.authority,
    checksum:createHash('sha256').update(input.markdown,'utf8').digest('hex'),records,
  })
  return {batch,unmappedCategories:[...unmappedCategories].sort(),
    deferredIds,unmarkedSectionCount}
}
