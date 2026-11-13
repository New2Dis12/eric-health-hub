import React from 'react'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { WorkoutSourceResults } from '../app/app/workout-source-results'
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
async function select(tree:ReactTestRenderer,id:string) {await act(async()=>{tree.root.findByType('select').props.onChange({target:{value:id}})})}

test('candidate read never links automatically; exact ID confirmation verifies receipt against fresh source readback',async()=>{
  const original=globalThis.fetch,requests:{url:string;init?:RequestInit}[]=[]
  let reads=0,tree!:ReactTestRenderer
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return Response.json(init?.method==='POST'?receipt:page)}
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId={sessionId} sessionRevision={2} refresh={async()=>{reads++;return readback(102)}} />)})
    assert.equal(requests.length,0)
    await click(tree,'Find Garmin');assert.equal(requests.length,1);assert.equal(button(tree,'Confirm Garmin').props.disabled,true)
    await select(tree,'102');assert.equal(requests.length,1)
    await click(tree,'Confirm Garmin');assert.equal(requests.length,2);assert.equal(reads,1)
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
      return Response.json(failure==='older evidence'?{...page,evidenceRevision:1}:page)
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
      await click(tree,'Find Garmin');await select(tree,'101');await click(tree,'Confirm Garmin')
      assert.match(text(tree),/could not be verified/);assert.doesNotMatch(text(tree),/saved and re-read/)
      assert.equal(tree.root.findByType('select').props.disabled,true)
      ready=true;await click(tree,'Retry confirmation')
      assert.equal(writes.length,2);assert.equal(writes[0],writes[1]);assert.match(text(tree),/saved and re-read/)
    } finally {globalThis.fetch=original;await act(async()=>tree?.unmount())}
  })
}
test('saved source measurements label missing and zero distinctly from user-entered values',async()=>{
  let tree!:ReactTestRenderer
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId={sessionId} sessionRevision={2} result={readback().sourceResult} refresh={async()=>readback()}/> )})
    assert.match(text(tree),/sourced measurements/);assert.match(text(tree),/0 m/);assert.match(text(tree),/Unknown/)
  } finally {await act(async()=>tree?.unmount())}
})
