import assert from 'node:assert/strict'
import {test} from 'node:test'
import {cyclingOnly} from '../lib/training/cycling-only'
import type {SessionSnapshot} from '../lib/training/session'

test('unverified metadata does not override strength doses, load targets or modality',()=>{
  const exercise:SessionSnapshot['exercises'][number]={key:'ride',name:'Ride',sets:null,reps:null,durationSeconds:600,target:null,
    restSeconds:null,notes:null,loadBasis:'unverified'}
  const snapshot:SessionSnapshot={title:'Synthetic ride',kind:'bike',purpose:'Fixture',overview:null,occurrences:[],exercises:[exercise]}
  assert.ok(cyclingOnly(snapshot))
  for(const kind of ['run','row','strength','other']) assert.equal(cyclingOnly({...snapshot,kind}),false)
  const exclusions:Partial<typeof exercise>[]=[{sets:1},{reps:5},{repsRange:{min:3,max:5}},{target:{value:10,unit:'kg'}},
    {target:{value:5,unit:'lb'}},{loadBasis:'per_hand'},{warmups:[{phase:'warmup',label:'Row',modality:'row',durationSeconds:120,targets:[],rpe:null}]}]
  for(const dose of exclusions) assert.equal(cyclingOnly({...snapshot,exercises:[exercise,{...exercise,...dose}]}),false)
})
