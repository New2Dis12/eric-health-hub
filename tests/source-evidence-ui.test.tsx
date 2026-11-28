import React from 'react'
import { WorkoutPlayer } from '../app/app/workout-player'
import type { WorkoutSession } from '../lib/training/session'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { reconcilePair } from '../lib/training/paired-evidence'
import { formatDuration, WorkoutSourceResults } from '../app/app/workout-source-results'
import type { CandidateResult } from '../lib/training/source-evidence-models'
import type { SessionResults } from '../lib/training/logging-models'
const sessionId='11111111-1111-4111-8111-111111111111'
const evidenceId='22222222-2222-4222-8222-222222222222'
const receipt={actualSessionId:sessionId,evidenceId,evidenceRevision:1}
const page:CandidateResult={status:'needs_confirmation',reason:'Select explicitly',sessionRevision:2,evidenceRevision:0,candidates:[
  {activityId:101,name:'Synthetic run A',modality:'run',startUtc:'2026-10-27T18:52:01Z',durationSeconds:1800,distanceMeters:0,compatible:true,linked:false},
  {activityId:102,name:'Synthetic run B',modality:'run',startUtc:'2026-10-27T18:53:01Z',durationSeconds:null,distanceMeters:null,compatible:true,linked:false},
]}
function readback(activityId=101):SessionResults {
  return {sessionId,sessionRevision:2,status:'completed',notes:'',notesRevision:0,entries:[],nextOffset:null,sourceResult:{status:'matched',evidence:[{id:evidenceId,revision:1,recordedAt:'2026-10-28T00:00:00Z',evidence:{
    version:1,provider:'garmin',sourceId:String(activityId),format:'FIT',retrievedAt:'2026-10-28T00:00:00Z',contentSha256:'0'.repeat(64),modality:'run',startUtc:null,endUtc:null,
    summary:[{field:'distanceMeters',value:0,unit:'m',nativeField:'totalDistance',nativeUnit:'m'},{field:'avgPowerWatts',value:null,unit:'W',nativeField:'avgPower',nativeUnit:'W'}],
    laps:[],sensors:{columns:[],units:[],samples:[]},coverage:{records:0,nativeLaps:0,samplesTruncated:false,lapsTruncated:false,sampleIntervalSeconds:30,warnings:[]},match:{method:'confirmed',actor:'synthetic',confirmedActivityId:String(activityId)},
  }}]}}
}
const label=(n:{children:unknown[]})=>n.children.filter(c=>typeof c==='string').join('')
const button=(tree:ReactTestRenderer,s:string)=>tree.root.findAllByType('button').find(n=>label(n).includes(s))!
const text=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON())
async function click(tree:ReactTestRenderer,label:string) {await act(async()=>{button(tree,label).props.onClick();await new Promise(r=>setTimeout(r,0))})}
async function select(tree:ReactTestRenderer,id:string) {await act(async()=>{tree.root.findAllByType('input').find(n=>String(n.props.value)===id)!.props.onChange()})}

test('candidate read never links automatically; exact ID confirmation verifies receipt against fresh source readback',async()=>{
  const original=globalThis.fetch,requests:{url:string;init?:RequestInit}[]=[]
  let reads=0,tree!:ReactTestRenderer
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return Response.json(init?.method==='POST'?receipt:page)}
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId={sessionId} sessionRevision={2} refresh={async()=>{reads++;return readback(102)}} />)})
    assert.equal(requests.length,1)
    assert.equal(requests.length,1);assert.equal(button(tree,'Confirm selected').props.disabled,true)
    await select(tree,'102');assert.equal(requests.length,1)
    await click(tree,'Confirm selected');assert.equal(requests.filter(r=>r.init?.method==='POST').length,1);assert.equal(reads,1)
    const payload=JSON.parse(requests[1].init!.body as string)
    assert.equal(payload.activityId,102);assert.equal(payload.confirmed,true)
    assert.equal(payload.expectedSessionRevision,2);assert.equal(payload.expectedEvidenceRevision,0)
    assert.match(text(tree),/saved and re-read/)
  } finally {globalThis.fetch=original;await act(async()=>tree?.unmount())}
})
for(const failure of ['read unavailable','missing evidence','different activity','wrong evidence ID','older evidence','wrong session','malformed receipt']) {
  test(`${failure} retains confirmation and the same retry key until authoritative reconciliation`,async()=>{
    const original=globalThis.fetch,writes:string[]=[]
    let ready=false,tree!:ReactTestRenderer
    globalThis.fetch=async(_url,init)=>{
      if(init?.method==='POST') {writes.push(init.body as string);return Response.json(failure==='malformed receipt'&&!ready?{evidenceId}:failure==='older evidence'?{...receipt,evidenceRevision:2}:receipt)}
      return Response.json(failure==='older evidence'?{...page,candidates:page.candidates.map(c=>({...c,evidenceRevision:1}))}:page)
    }
    const refresh=async()=>{
      const data=readback()
      if(ready) {if(failure==='older evidence')data.sourceResult!.evidence[0].revision=2;return data}
      if(failure==='read unavailable') return null
      if(failure==='missing evidence') data.sourceResult={status:'unavailable',evidence:[]}
      if(failure==='different activity') return readback(102)
      if(failure==='wrong evidence ID') data.sourceResult!.evidence[0].id='33333333-3333-4333-8333-333333333333'
      if(failure==='wrong session') data.sessionId='44444444-4444-4444-8444-444444444444'
      return data
    }
    try {
      await act(async()=>{tree=create(<WorkoutSourceResults sessionId={sessionId} sessionRevision={2} refresh={refresh} />)})
      await select(tree,'101');await click(tree,'Confirm selected')
      assert.match(text(tree),/could not be verified/);assert.doesNotMatch(text(tree),/saved and re-read/)
      assert.equal(tree.root.findByType('fieldset').props.disabled,true)
      ready=true;await click(tree,'Retry confirmation')
      assert.equal(writes.length,2);assert.equal(writes[0],writes[1]);assert.match(text(tree),/saved and re-read/)
    } finally {globalThis.fetch=original;await act(async()=>tree?.unmount())}
  })
}
test('saved source measurements label missing and zero distinctly from user-entered values',async()=>{
  let tree!:ReactTestRenderer
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId={sessionId} sessionRevision={2} result={readback().sourceResult} refresh={async()=>readback()}/> )})
    assert.match(text(tree),/Workout summary/);assert.match(text(tree),/0 m/);assert.doesNotMatch(text(tree),/Average power/)
  } finally {await act(async()=>tree?.unmount())}
})

test('one confirmation freezes both identities and stops for fresh owner confirmation on a stale partner',async()=>{
  const original=globalThis.fetch,writes:Record<string,unknown>[]=[]
  let stale=true,tree!:ReactTestRenderer
  const pairPage={...page,verifiedPairs:[[101,102]],suggestedPair:[101,102]}
  globalThis.fetch=async(_url,init)=>{
    if(init?.method!=='POST') return Response.json(pairPage)
    const command=JSON.parse(String(init.body));writes.push(command)
    if(command.activityId===102 && stale) return new Response(null,{status:409})
    return Response.json(receipt)
  }
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId={sessionId} sessionRevision={2} refresh={async()=>readback()} />)})
    await click(tree,'Confirm selected')
    assert.deepEqual(writes.map(w=>w.activityId),[101,102])
    assert.equal(writes[1].pairedWithEvidenceId,evidenceId)
    assert.match(text(tree),/First recording saved.*Confirmation rejected/)
    assert.equal(button(tree,'Retry confirmation'),undefined)
  } finally {globalThis.fetch=original;await act(async()=>tree?.unmount())}
})

test('a unique pair uses one confirmation, two immutable receipts and a verified partner',async()=>{
  const original=globalThis.fetch,ids:number[]=[]
  const partnerId='33333333-3333-4333-8333-333333333333'
  let tree!:ReactTestRenderer
  globalThis.fetch=async(_url,init)=>{
    if(init?.method!=='POST') return Response.json({...page,verifiedPairs:[[101,102]],suggestedPair:[101,102]})
    const command=JSON.parse(String(init.body))
    ids.push(command.activityId)
    assert.equal(command.pairedWithEvidenceId,ids.length===1?undefined:evidenceId)
    return Response.json({...receipt,evidenceId:ids.length===1?evidenceId:partnerId})
  }
  const refresh=async()=>{
    const current=readback()
    if(ids.length===2) current.sourceResult!.evidence.push({...readback(102).sourceResult!.evidence[0],id:partnerId})
    return current
  }
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId={sessionId} sessionRevision={2} refresh={refresh}/>)})
    assert.deepEqual(ids,[])
    await click(tree,'Confirm selected')
    assert.deepEqual(ids,[101,102])
    assert.match(text(tree),/saved and re-read/)
  } finally {globalThis.fetch=original;await act(async()=>tree?.unmount())}
})

test('FIT durations round to hundredths before carrying into minutes and hours',()=>{
  for(const [seconds,clock] of [
    [0,'00:00'],[45,'00:45'],[10.075,'00:10.08'],[59.995,'01:00'],[750.5,'12:30.50'],
    [3599,'59:59'],[3599.994,'59:59.99'],[3599.995,'01:00:00'],[3600,'01:00:00'],
    [3600.006,'01:00:00.01'],[4530.25,'01:15:30.25'],[360001,'100:00:01'],
  ] as const) assert.equal(formatDuration(seconds),clock)
})

for(const modality of ['run','bike','row']) {
  test(modality+' results retain Garmin-only distance and use confirmed machine distance and Garmin heart rate when paired',()=>{
    const saved=readback()
    const result=saved.sourceResult!
    const watch=result.evidence[0]
    watch.evidence.modality=modality
    watch.evidence.recording={origin:'garmin_device',fitManufacturer:'garmin',listManufacturer:null}
    watch.evidence.summary[0].value=700
    watch.evidence.summary.push({field:'avgHeartRateBpm',value:135,unit:'bpm',nativeField:'avgHeartRate',nativeUnit:'bpm'})
    const render=()=>renderToStaticMarkup(<WorkoutSourceResults sessionId={sessionId} sessionRevision={2} result={result} refresh={async()=>saved}/>)
    const compact=()=>render().split('<details>')[0]
    assert.match(compact(),/700 m<\/strong><small>Garmin/)
    const machine=structuredClone(watch)
    machine.id='33333333-3333-4333-8333-333333333333'
    machine.evidence.sourceId='102'
    machine.evidence.recording!.origin='peloton_import'
    machine.evidence.summary[0].value=800
    machine.evidence.summary.at(-1)!.value=121
    result.evidence.push(machine)
    result.reconciled=reconcilePair(result.evidence)
    assert.match(compact(),/800 m<\/strong><small>Peloton/)
    assert.match(compact(),/135 bpm<\/strong><small>Garmin/)
    for(const unavailable of [null,-1]) {
      machine.evidence.summary[0].value=unavailable
      result.reconciled=reconcilePair(result.evidence)
      assert.match(compact(),/Peloton distance unavailable/)
      assert.doesNotMatch(compact(),/700 m/)
      assert.match(render().split('<details>').slice(1).join(''),/700 m/)
    }
    machine.evidence.summary[0].value=0
    result.reconciled=reconcilePair(result.evidence)
    assert.match(compact(),/0 m<\/strong><small>Peloton/)
  })
}

for(const changed of [false,true]) test('cycling completion revalidates selected recording, candidate changed='+changed,async()=>{
  const original=globalThis.fetch, handoff={current:null as string|null}
  let finalized=false,writes=0,tree!:ReactTestRenderer
  const candidates=structuredClone(page)
  candidates.candidates.forEach(c=>{c.modality='bike'})
  globalThis.fetch=async(_url,init)=>{
    if(init?.method==='POST'){assert.ok(finalized);writes++;return Response.json(receipt)}
    return Response.json(candidates)
  }
  const props={sessionId,sessionRevision:2,refresh:async()=>readback(102),handoff}
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults {...props} finish={async selection=>{finalized=true;handoff.current=selection}}/>)})
    await select(tree,'102');await click(tree,'Complete workout and attach')
    assert.ok(finalized);assert.equal(writes,0)
    if(changed)candidates.candidates[1].durationSeconds=601
    await act(async()=>{tree.update(<WorkoutSourceResults key="completed" {...props}/>)})
    assert.equal(writes,changed?0:1)
    if(changed)assert.match(text(tree),/Recordings changed/)
  } finally {globalThis.fetch=original;await act(async()=>tree?.unmount())}
})

test('cycling confirms both verified sources only after finalization and fresh discovery',async()=>{
  const original=globalThis.fetch,handoff={current:null as string|null},ids=[101,102]
  const candidates=structuredClone(page)
  candidates.verifiedPairs=[ids];candidates.suggestedPair=ids
  candidates.candidates.forEach((c,i)=>{c.modality='bike';c.origin=i?'peloton_import':'garmin_device'})
  const result=readback()
  result.sourceResult!.evidence=[]
  const events:string[]=[]
  let finalized=false,tree!:ReactTestRenderer
  globalThis.fetch=async(_url,init)=>{
    if(init?.method!=='POST'){events.push(finalized?'read finalized candidates':'read active candidates');return Response.json(candidates)}
    assert.ok(finalized)
    const cmd=JSON.parse(String(init.body)), saved=readback(cmd.activityId).sourceResult!.evidence[0]
    saved.id=cmd.activityId===101?evidenceId:'33333333-3333-4333-8333-333333333333'
    if(cmd.activityId===102)assert.equal(cmd.pairedWithEvidenceId,evidenceId)
    events.push('attach '+cmd.activityId)
    result.sourceResult!.evidence.push(saved)
    return Response.json({...receipt,evidenceId:saved.id})
  }
  const props={sessionId,sessionRevision:2,refresh:async()=>result,handoff}
  try{
    await act(async()=>{tree=create(<WorkoutSourceResults {...props} finish={async selection=>{events.push('complete');handoff.current=selection;finalized=true}}/>)})
    await click(tree,'Complete workout and attach')
    await act(async()=>{tree.update(<WorkoutSourceResults key="final" {...props}/>)})
    assert.deepEqual(events.slice(0,5),['read active candidates','complete','read finalized candidates','attach 101','attach 102'])
    assert.match(text(tree),/saved and re-read/)
  }finally{globalThis.fetch=original;await act(async()=>tree?.unmount())}
})

for (const status of ['in_progress','completed'] as const) {
  for (const metadata of [{}, {loadBasis:'unverified' as const}]) {
    test(`bike player reads pinned ${status} session with ${metadata.loadBasis ?? 'absent'} load basis`, async()=>{
      const session:WorkoutSession={id:sessionId,status,revision:2,prescriptionRevision:1,startedAt:'2026-10-27T18:52:01Z',
        snapshot:{kind:'bike',title:'Synthetic ride',purpose:'Regression',overview:null,
          exercises:[{key:'ride',name:'Ride',sets:null,reps:null,durationSeconds:1800,restSeconds:null,target:null,notes:null,...metadata}],
          occurrences:[{id:'exercise',exercise:0,key:'ride',type:'exercise'}]}}
      const saved=readback()
      saved.status=status
      saved.notes='Retained synthetic note'
      saved.sourceResult!.evidence[0].evidence.modality='bike'
      if(status==='in_progress') delete saved.sourceResult
      if(status==='completed' && metadata.loadBasis) saved.entries.push({
        id:'historical-note',item_key:'exercise',kind:'exercise_note',occurrence_id:'exercise',set_ordinal:0,
        revision:1,session_revision:1,value:{notes:'Retained exercise note'},before_value:null,
        actor_sub:'synthetic',source:'browser',reason:'Fixture',recorded_at:session.startedAt,
      })
      const previousWindow=globalThis.window
      Object.assign(globalThis,{window:new EventTarget()})
      const original=globalThis.fetch, calls:string[]=[]
      let tree!:ReactTestRenderer
      globalThis.fetch=async(url,init)=>{
        calls.push(init?.method??'GET')
        return Response.json(String(url).includes('/sources') ? {...page,candidates:[]} : saved)
      }
      try {
        await act(async()=>{tree=create(<WorkoutPlayer workout={session}/>)})
        assert.equal(tree.root.findAllByType('table').filter(t=>t.props['aria-label']==='Prescribed cycling').length,1)
        assert.deepEqual(tree.root.findAllByType('textarea').map(n=>n.props.value),
          saved.entries.length?['Retained exercise note',saved.notes]:[saved.notes])
        if(status==='completed') assert.ok(tree.root.findAllByType('summary').some(node=>label(node).includes('activity 101')))
        else assert.match(text(tree),/Complete workout without recordings/)
        assert.deepEqual(calls,['GET','GET'])
      } finally {globalThis.fetch=original;await act(async()=>tree?.unmount());Object.assign(globalThis,{window:previousWindow})}
    })
  }
}
