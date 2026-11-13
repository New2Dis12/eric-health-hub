'use client'
import { useRef, useState } from 'react'
import type { CandidateResult, SourceLinkInput, SourceResult } from '@/lib/training/source-evidence-models'

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
const metricLabel=(field:string)=>labels[field]??field

export function WorkoutSourceResults({sessionId,sessionRevision,result,refresh}: {
  sessionId:string;sessionRevision:number;result?:SourceResult;refresh:()=>Promise<boolean>
}) {
  const [page,setPage]=useState<CandidateResult|null>(null)
  const [selected,setSelected]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const pending=useRef<SourceLinkInput|null>(null)
  const active=useRef(false)
  async function candidates() {
    if(active.current) return
    active.current=true;setBusy(true);setMessage('')
    try {
      const response=await fetch('/api/training/sources?session='+sessionId,{cache:'no-store'})
      if(!response.ok) throw new Error()
      setPage(await response.json());setSelected('')
    } catch {setMessage('Garmin candidates unavailable. Saved results are unchanged.')}
    finally {active.current=false;setBusy(false)}
  }
  async function link() {
    if(active.current || (!pending.current && !selected)) return
    active.current=true;setBusy(true);setMessage('')
    pending.current??={sessionId,activityId:Number(selected),expectedSessionRevision:page?.sessionRevision??sessionRevision,
      expectedEvidenceRevision:page?.evidenceRevision??0,confirmed:true,idempotencyKey:crypto.randomUUID(),reason:'Owner confirmed Garmin activity in workout results'}
    try {
      const response=await fetch('/api/training/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.current)})
      if(!response.ok) {
        if(response.status>=400 && response.status<500) {pending.current=null;setPage(null);setSelected('')}
        throw new Error()
      }
      if (!await refresh()) throw new Error()
      pending.current=null;setPage(null);setSelected('');setMessage('Garmin source evidence saved and re-read.')
    } catch {setMessage(pending.current?'Save could not be verified. Retry the same confirmation to check it.':'Link rejected. Re-read candidates and saved results before confirming again.')}
    finally {active.current=false;setBusy(false)}
  }
  return <section aria-label="Device source results">
    <h4>Device source results</h4>
    {result?.status==='matched'?result.evidence.map(saved=><div key={saved.id}>
      <strong>Garmin FIT — sourced measurements</strong>
      <p>Activity {saved.evidence.sourceId} · evidence revision {saved.revision} · retrieved {saved.evidence.retrievedAt}</p>
      <p>Confirmed by owner. Missing metrics remain unknown.</p>
      <dl>{saved.evidence.summary.map(m=><div key={m.field}><dt>{metricLabel(m.field)}</dt><dd>{m.value===null?'Unknown':`${m.value} ${m.unit}`}</dd></div>)}</dl>
      <p>{saved.evidence.coverage.records} FIT records; {saved.evidence.laps.length} of {saved.evidence.coverage.nativeLaps} native laps; {saved.evidence.sensors.samples.length} selected sensor samples.</p>
      {saved.evidence.coverage.warnings.map(w=><p key={w}>{w}</p>)}
      <details><summary>Native laps and sensor measurements</summary>
        {saved.evidence.laps.map(l=><div key={l.index}><strong>Native lap {l.index+1}</strong><p>{l.startUtc??'Unknown start'} — {l.endUtc??'Unknown end'}</p>
          <dl>{l.metrics.map(m=><div key={m.field}><dt>{metricLabel(m.field)}</dt><dd>{m.value===null?'Unknown':`${m.value} ${m.unit}`}</dd></div>)}</dl></div>)}
        <p>Samples every {saved.evidence.coverage.sampleIntervalSeconds}s at most; {saved.evidence.coverage.samplesTruncated?'partial sample coverage':'available sample page complete'}; {saved.evidence.coverage.lapsTruncated?'partial lap coverage':'native lap page complete'}.</p>
        <div style={{overflowX:'auto',maxWidth:'100%'}} tabIndex={0} role="region" aria-label="Selected FIT sensor measurements">
          <table><caption>Selected sensor measurements — missing values are unknown</caption>
            <thead><tr>{saved.evidence.sensors.columns.map((c,i)=><th key={c} scope="col">{metricLabel(c)} ({saved.evidence.sensors.units[i]})</th>)}</tr></thead>
            <tbody>{saved.evidence.sensors.samples.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>{value===null?'Unknown':value}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>):<p>Device results not yet attached. Device evidence unavailable — no activity linked. User-entered results are separate.</p>}
    <button type="button" disabled={busy || !!pending.current} onClick={()=>void candidates()}>Find Garmin activity</button>
    {page && <div>
      <p role="status">{page.status.replaceAll('_',' ')} — {page.reason}</p>
      <label>Garmin activity <select style={{maxWidth:'100%'}} value={selected} disabled={busy || !!pending.current} onChange={e=>setSelected(e.target.value)}>
        <option value="">Select an activity</option>
        {page.candidates.map(c=><option key={c.activityId} value={c.activityId}>{c.activityId} · {c.name} · {c.modality??'Unknown modality'} · {c.startUtc??'Unknown UTC start'} · {c.durationSeconds??'Unknown'}s · {c.distanceMeters??'Unknown'}m{c.compatible?'':' · modality requires confirmation'}{c.linked?' · already linked':''}</option>)}
      </select></label>
      <p>Confirm this exact activity belongs to this completed workout. Date, time and modality are hints. A different existing activity link cannot be replaced.</p>
    </div>}
    {(page || pending.current) && <button type="button" disabled={busy || (!selected && !pending.current)} onClick={()=>void link()}>{pending.current?'Retry confirmation / verify':'Confirm Garmin activity'}</button>}
    {message && <p role="status">{message}</p>}
  </section>
}
