import React from 'react'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { WorkoutSourceResults } from '../app/app/workout-source-results'
import type { CandidateResult, SourceResult } from '../lib/training/source-evidence-models'
const page:CandidateResult={status:'needs_confirmation',reason:'Select explicitly',sessionRevision:2,evidenceRevision:0,candidates:[
  {activityId:101,name:'Synthetic run A',modality:'run',startUtc:'2026-10-27T18:52:01Z',durationSeconds:1800,distanceMeters:0,compatible:true,linked:false},
  {activityId:102,name:'Synthetic run B',modality:'run',startUtc:'2026-10-27T18:53:01Z',durationSeconds:null,distanceMeters:null,compatible:true,linked:false},
]}
const label=(n:{children:unknown[]})=>n.children.filter(c=>typeof c==='string').join('')
const button=(tree:ReactTestRenderer,s:string)=>tree.root.findAllByType('button').find(n=>label(n).includes(s))!
const text=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON())
test('candidate read never links automatically; selecting the exact ID and confirming saves once',async()=>{
  const original=globalThis.fetch
  const requests:{url:string;init?:RequestInit}[]=[]
  let reads=0,tree!:ReactTestRenderer
  globalThis.fetch=async(url,init)=>{
    requests.push({url:String(url),init})
    return Response.json(init?.method==='POST'?{evidenceId:'synthetic-evidence',evidenceRevision:1}:page)
  }
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId="synthetic" sessionRevision={2} refresh={async()=>{reads++;return true}} />)})
    assert.equal(requests.length,0)
    await act(async()=>{button(tree,'Find Garmin').props.onClick();await new Promise(r=>setTimeout(r,0))})
    assert.equal(requests.length,1);assert.equal(button(tree,'Confirm Garmin').props.disabled,true)
    await act(async()=>{tree.root.findByType('select').props.onChange({target:{value:'102'}})})
    assert.equal(requests.length,1)
    await act(async()=>{button(tree,'Confirm Garmin').props.onClick();await new Promise(r=>setTimeout(r,0))})
    assert.equal(requests.length,2);assert.equal(reads,1)
    const payload=JSON.parse(requests[1].init!.body as string)
    assert.equal(payload.activityId,102);assert.equal(payload.confirmed,true)
    assert.equal(payload.expectedSessionRevision,2);assert.equal(payload.expectedEvidenceRevision,0)
    assert.match(text(tree),/saved and re-read/)
  } finally {globalThis.fetch=original;await act(async()=>tree?.unmount())}
})
test('uncertain response preserves confirmation and idempotency key through retry; failure never claims verified save',async()=>{
  const original=globalThis.fetch
  const writes:string[]=[]
  let ready=false,tree!:ReactTestRenderer
  globalThis.fetch=async(_url,init)=>{
    if(init?.method==='POST') {writes.push(init.body as string);return Response.json({evidenceId:'synthetic'})}
    return Response.json(page)
  }
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId="synthetic" sessionRevision={2} refresh={async()=>ready} />)})
    await act(async()=>{button(tree,'Find Garmin').props.onClick();await new Promise(r=>setTimeout(r,0))})
    await act(async()=>{tree.root.findByType('select').props.onChange({target:{value:'101'}})})
    await act(async()=>{button(tree,'Confirm Garmin').props.onClick();await new Promise(r=>setTimeout(r,0))})
    assert.match(text(tree),/could not be verified/);assert.doesNotMatch(text(tree),/saved and re-read/)
    assert.equal(tree.root.findByType('select').props.disabled,true)
    ready=true
    await act(async()=>{button(tree,'Retry confirmation').props.onClick();await new Promise(r=>setTimeout(r,0))})
    assert.equal(writes.length,2);assert.equal(writes[0],writes[1]);assert.match(text(tree),/saved and re-read/)
  } finally {globalThis.fetch=original;await act(async()=>tree?.unmount())}
})
test('saved source measurements label missing and zero distinctly from user-entered values',async()=>{
  let tree!:ReactTestRenderer
  const result:SourceResult={status:'matched',evidence:[{id:'synthetic',revision:1,recordedAt:'2026-10-28T00:00:00Z',evidence:{
    version:1,provider:'garmin',sourceId:'101',format:'FIT',retrievedAt:'2026-10-28T00:00:00Z',contentSha256:'0'.repeat(64),modality:'run',startUtc:null,endUtc:null,
    summary:[{field:'distanceMeters',value:0,unit:'m',nativeField:'totalDistance',nativeUnit:'m'},{field:'avgPowerWatts',value:null,unit:'W',nativeField:'avgPower',nativeUnit:'W'}],
    laps:[],sensors:{columns:[],units:[],samples:[]},coverage:{records:0,nativeLaps:0,samplesTruncated:false,lapsTruncated:false,sampleIntervalSeconds:30,warnings:[]},match:{method:'confirmed',actor:'synthetic',confirmedActivityId:'101'},
  }}]}
  try {
    await act(async()=>{tree=create(<WorkoutSourceResults sessionId="synthetic" sessionRevision={2} result={result} refresh={async()=>true}/> )})
    assert.match(text(tree),/sourced measurements/);assert.match(text(tree),/0 m/);assert.match(text(tree),/Unknown/)
  } finally {await act(async()=>tree?.unmount())}
})
