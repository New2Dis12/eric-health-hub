import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { parseSourceReceipt, sourceReceiptMatches } from '../lib/training/source-evidence-client'
import { normalizeGarminFit } from '../lib/training/garmin-evidence'
import { decodeGarminFitArchive } from '../lib/fit-activity'
import { workoutFit } from './fixtures'
import type { SessionResults } from '../lib/training/logging-models'

test('receipt reconciliation accepts exact or newer same-source revisions and rejects contradictory receipt identity',()=>{
  const sessionId=randomUUID(),evidenceId=randomUUID()
  const command={sessionId,activityId:101,expectedSessionRevision:2,expectedEvidenceRevision:0,confirmed:true as const,idempotencyKey:randomUUID(),reason:'Synthetic'}
  const receipt=parseSourceReceipt({actualSessionId:sessionId,evidenceId,evidenceRevision:1})
  const evidence=normalizeGarminFit({activityId:101,...decodeGarminFitArchive(workoutFit(),30,120)},101,'synthetic',new Date())
  const current:SessionResults={sessionId,sessionRevision:2,status:'completed',entries:[],nextOffset:null,notes:'',notesRevision:0,sourceResult:{status:'matched',evidence:[{id:evidenceId,revision:1,evidence,recordedAt:new Date().toISOString()}]}}
  assert.equal(sourceReceiptMatches(command,receipt,current),true)
  current.sourceResult!.evidence[0].id=randomUUID()
  assert.equal(sourceReceiptMatches(command,receipt,current),false)
  current.sourceResult!.evidence[0].revision=2
  assert.equal(sourceReceiptMatches(command,receipt,current),true)
  assert.equal(sourceReceiptMatches(command,{...receipt,actualSessionId:randomUUID()},current),false)
  assert.equal(sourceReceiptMatches(command,{...receipt,evidenceRevision:2},current),false)
  assert.throws(()=>parseSourceReceipt({actualSessionId:sessionId,evidenceRevision:1,evidenceId:'invalid'}))
  assert.throws(()=>parseSourceReceipt({evidenceId,evidenceRevision:1}))
})
