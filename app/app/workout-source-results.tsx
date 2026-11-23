'use client'
import { useEffect, useRef, useState } from 'react'
import './workout-source-results.css'
import type { SessionResults } from '@/lib/training/logging-models'
import { parseSourceReceipt, sourceReceiptMatches } from '@/lib/training/source-evidence-client'
import type { CandidateResult, SourceLinkInput, SourceResult, RecordingOrigin } from '@/lib/training/source-evidence-models'

const labels:Record<string,string>={
  elapsedSeconds:'Elapsed time',timerSeconds:'Timer time',distanceMeters:'Distance',
  avgHeartRateBpm:'Average heart rate',maxHeartRateBpm:'Maximum heart rate',
  avgSpeedMetersPerSecond:'Average device speed',maxSpeedMetersPerSecond:'Maximum device speed',
  avgCadenceCyclesPerMinute:'Average cadence',maxCadenceCyclesPerMinute:'Maximum cadence',
  avgPowerWatts:'Average power',maxPowerWatts:'Maximum power',avgGroundContactTimeMs:'Average ground contact time',
  avgVerticalOscillationCm:'Average vertical oscillation',avgGroundContactTimeBalancePercent:'Average ground contact balance',
  avgVerticalRatioPercent:'Average vertical ratio',avgStepLengthCm:'Average step length',avgGroundContactTimePercent:'Average ground contact percentage',
  timestampUtc:'Timestamp',heartRateBpm:'Heart rate',speedMetersPerSecond:'Device speed',cadenceCyclesPerMinute:'Cadence',
  powerWatts:'Power',groundContactTimeMs:'Ground contact time',verticalOscillationCm:'Vertical oscillation',
  groundContactTimeBalancePercent:'Ground contact balance',verticalRatioPercent:'Vertical ratio',stepLengthCm:'Step length',groundContactTimePercent:'Ground contact percentage',
}
labels.avgSplitSecondsPer500m='Average split'
labels.avgStrokeRate='Average stroke rate'
const metricLabel=(field:string)=>labels[field]??field

const originLabel = (origin?:RecordingOrigin) => origin === 'peloton_import' ? 'Peloton' : origin === 'garmin_device' ? 'Garmin' : 'Garmin Connect · origin unverified'
const localTime = (utc:string|null) => utc ? new Date(utc).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}) : 'Time unavailable'
const overviewFields = ['elapsedSeconds','distanceMeters','avgHeartRateBpm','avgPowerWatts','avgSpeedMetersPerSecond','avgCadenceCyclesPerMinute','avgSplitSecondsPer500m','avgStrokeRate']
const display = (value:number, unit:string) => value.toLocaleString(undefined,{maximumFractionDigits:2})+' '+unit
type Confirmation = { commands: SourceLinkInput[]; index:number }

// Keep only the last unresolved command in this tab. After a reload, discovery
// first reflects committed evidence. An explicit retry of the same remaining
// identity and revisions can safely replay a lost response.
function rememberCommand(command: SourceLinkInput) {
  const identity=[command.activityId,command.expectedSessionRevision,command.expectedEvidenceRevision,command.pairedWithEvidenceId??null,command.reason]
  try {
    const key='stunna.source-confirmation.'+command.sessionId
    const prior=JSON.parse(sessionStorage.getItem(key)??'null')
    if(prior?.identity===JSON.stringify(identity) && typeof prior.key==='string') command.idempotencyKey=prior.key
    else sessionStorage.setItem(key,JSON.stringify({identity:JSON.stringify(identity),key:command.idempotencyKey}))
  } catch { /* In-memory retries also work when browser storage is unavailable. */ }
}
function forgetCommand(sessionId:string) {
  try { sessionStorage.removeItem('stunna.source-confirmation.'+sessionId) } catch { /* Storage is optional. */ }
}
export function WorkoutSourceResults({sessionId,sessionRevision,result,refresh}: {
  sessionId:string;sessionRevision:number;result?:SourceResult;refresh:()=>Promise<SessionResults|null>
}) {
  const [page,setPage]=useState<CandidateResult|null>(null)
  const [selected,setSelected]=useState<number[]>([])
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [reload,setReload]=useState(0)
  const pending=useRef<Confirmation|null>(null)
  const active=useRef(false)
  const sources=result?.evidence.filter(s=>s.evidence.provider==='garmin')??[]
  const paired=sources.length>=2
  useEffect(()=>{
    if (paired || pending.current) return
    const controller=new AbortController()
    setPage(null);setSelected([]);setLoading(true)
    async function discover() {
      try {
        const response=await fetch('/api/training/sources?discover=1&session='+sessionId,{cache:'no-store',signal:controller.signal})
        if(!response.ok) throw new Error()
        const current:CandidateResult=await response.json()
        if(!Array.isArray(current?.candidates)) throw new Error()
        if(controller.signal.aborted) return
        setPage(current)
        setSelected((current.suggestedPair??[]).filter(id=>current.candidates.some(c=>c.activityId===id && !c.linked)))
      } catch { if(!controller.signal.aborted) setMessage('Recordings unavailable. Retry discovery.') }
      finally {if(!controller.signal.aborted) setLoading(false)}
    }
    void discover()
    return ()=>controller.abort()
  },[sessionId,sessionRevision,reload,paired])

  function toggle(id:number) {
    setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])
    setMessage('')
  }
  const anchor=page?.pairAnchor
  const identities=[...(anchor?[Number(anchor.sourceId)]:[]),...selected]
  const validSelection=selected.length>0 && (identities.length===1
    ? page?.candidates.find(c=>c.activityId===selected[0])?.origin!=='peloton_import'
    : page?.verifiedPairs?.some(pair=>pair.length===identities.length && pair.every(id=>identities.includes(id))))
  async function confirm() {
    if(active.current || (!pending.current && (!page || !validSelection))) return
    if(!pending.current && page) {
      const ordered=[...selected].sort((a,b)=>Number(page.candidates.find(c=>c.activityId===a)?.origin==='peloton_import')-
        Number(page.candidates.find(c=>c.activityId===b)?.origin==='peloton_import'))
      pending.current={index:0,commands:ordered.map(activityId=>({sessionId,activityId,expectedSessionRevision:page.sessionRevision,
        expectedEvidenceRevision:page.candidates.find(c=>c.activityId===activityId)?.evidenceRevision??0,
        ...(anchor && {pairedWithEvidenceId:anchor.evidenceId}),confirmed:true,idempotencyKey:crypto.randomUUID(),reason:'Owner confirmed selected workout recordings'}))}
    }
    const batch=pending.current!
    active.current=true;setSaving(true)
    try {
      while(batch.index<batch.commands.length) {
        const command=batch.commands[batch.index]
        setMessage('Saving recording '+(batch.index+1)+' of '+batch.commands.length+'…')
        rememberCommand(command)
        const response=await fetch('/api/training/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)})
        if(!response.ok) {
          if([400,401,403,404,409,422].includes(response.status)) {
            forgetCommand(sessionId);pending.current=null
            setPage(null);setSelected([])
            await refresh()
            setReload(n=>n+1)
            setMessage((batch.index?'First recording saved. ':'')+'Confirmation rejected. Check the current recordings and confirm again.')
            return
          }
          throw new Error()
        }
        const receipt=parseSourceReceipt(await response.json())
        const current=await refresh()
        if(!sourceReceiptMatches(command,receipt,current)) throw new Error()
        forgetCommand(sessionId)
        const next=batch.commands[batch.index+1]
        if(next) {
          const evidence=current!.sourceResult!.evidence.filter(s=>s.evidence.provider==='garmin')
          if(evidence.length!==1 || evidence[0].id!==receipt.evidenceId || current!.sessionRevision!==command.expectedSessionRevision) {
            pending.current=null;setPage(null);setSelected([]);setReload(n=>n+1)
            setMessage('Saved evidence changed. Check current recordings before confirming again.')
            return
          }
          next.pairedWithEvidenceId=receipt.evidenceId
        }
        batch.index++
      }
      pending.current=null;setSelected([]);setPage(null);setReload(n=>n+1)
      setMessage('Selected recordings saved and re-read.')
    } catch {
      setMessage((batch.index?'First recording saved. ':'')+(pending.current?'Save could not be verified. Retry confirmation.':'Refresh results before confirming again.'))
    } finally {active.current=false;setSaving(false)}
  }

  const single=sources[0]?.evidence
  const metrics=result?.reconciled?.summary??(single?.summary??[]).map(m=>({...m,sourceId:single!.sourceId}))
  const measured=metrics.filter(m=>m.value!==null)
  const mainMetrics=measured.filter(m=>overviewFields.includes(m.field))
  const summary=mainMetrics.length?mainMetrics:measured.slice(0,4)
  return <section className="device-results" aria-label="Device source results">
    <h4>Device results</h4>
    {sources.length>0 && <>
      <h5>Workout summary</h5>
      {!summary.length && <p>No measured totals available.</p>}
      <dl className="device-metrics">{summary.map(m=>
        <div key={m.field}><dt>{metricLabel(m.field)}</dt><dd><strong>{display(m.value!,m.unit)}</strong>
          <small>{originLabel(sources.find(s=>s.evidence.sourceId===m.sourceId)?.evidence.recording?.origin)}</small></dd></div>)}</dl>
      <details><summary>Source details · {sources.length} saved</summary>
        {result?.reconciled && <><h5>Metric comparison</h5><dl>{result.reconciled.summary.map(m=><div key={m.field}><dt>{metricLabel(m.field)}</dt>
          <dd>{display(m.value!,m.unit)} · activity {m.sourceId}{m.conflict?' · sources differ':''} {m.formula}</dd></div>)}</dl></>}
        {sources.map(({id,evidence:e,revision})=><details key={id}><summary>{originLabel(e.recording?.origin)} · activity {e.sourceId}</summary>
          <p>Evidence revision {revision} · {localTime(e.retrievedAt)}</p>
          <dl>{e.summary.filter(m=>m.value!==null).map(m=><div key={m.field}><dt>{metricLabel(m.field)}</dt><dd>{display(m.value!,m.unit)}</dd></div>)}</dl>
          <details><summary>Native laps and sensor measurements</summary>
            <p>{e.laps.length} of {e.coverage.nativeLaps} native laps · {e.sensors.samples.length} selected samples · {e.coverage.sampleIntervalSeconds}s sample interval</p>
            {e.coverage.samplesTruncated && <p>Partial sample coverage</p>}
            {e.coverage.warnings.map(w=><p key={w}>{w}</p>)}
            {e.laps.map(l=><div key={l.index}><strong>Lap {l.index+1} · {localTime(l.startUtc)}</strong>
              <dl>{l.metrics.filter(m=>m.value!==null).map(m=><div key={m.field}><dt>{metricLabel(m.field)}</dt><dd>{display(m.value!,m.unit)}</dd></div>)}</dl></div>)}
            <div className="device-table" tabIndex={0} role="region" aria-label="Selected FIT sensor measurements"><table>
              <caption>Selected sensor measurements</caption><thead><tr>{e.sensors.columns.map((c,i)=><th key={c}>{metricLabel(c)} ({e.sensors.units[i]})</th>)}</tr></thead>
              <tbody>{e.sensors.samples.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v??'Unknown'}</td>)}</tr>)}</tbody></table></div>
          </details></details>)}
      </details></>}
    {!paired && <>
      <h5>Recordings</h5>
      {!sources.length && <p>Device results not yet attached.</p>}
      {sources.map(s=><p key={s.id}>Saved · {originLabel(s.evidence.recording?.origin)} · activity {s.evidence.sourceId}</p>)}
      {loading && <p role="status">Finding recordings…</p>}
      {page && <fieldset disabled={saving || !!pending.current}><legend>Select recordings for this workout</legend>
        {page.candidates.filter(c=>!c.linked).map(c=><label className="device-row" key={c.activityId}>
          <input type="checkbox" value={c.activityId} checked={selected.includes(c.activityId)}
            disabled={!selected.includes(c.activityId) && identities.length>=2} onChange={()=>toggle(c.activityId)}/>
          <span><strong>{originLabel(c.origin)} · {c.name}</strong><small>{localTime(c.startUtc)} · {c.durationSeconds===null?'Duration unavailable':display(c.durationSeconds/60,'min')}</small>
          <small>{c.modality??'Modality unavailable'} · activity {c.activityId}</small></span>
        </label>)}
        {!page.candidates.some(c=>!c.linked) && <p>{page.status==='unavailable'?page.reason:'No additional recordings available.'}</p>}
      </fieldset>}
      {selected.length>0 && !validSelection && <p>Select a Garmin recording or a verified pair for this workout.</p>}
      {(page || pending.current) && <button className="device-confirm" type="button" disabled={saving || (!pending.current && !validSelection)} onClick={()=>void confirm()}>
        {saving?'Saving recordings…':pending.current?'Retry confirmation':'Confirm selected recordings'}</button>}
      <button type="button" disabled={loading || saving || !!pending.current} onClick={()=>{setMessage('');setReload(n=>n+1)}}>Refresh recordings</button>
    </>}
    {paired && pending.current && !saving && <button onClick={()=>void confirm()}>Retry confirmation</button>}
    {message && <p role="status">{message}</p>}
  </section>
}
