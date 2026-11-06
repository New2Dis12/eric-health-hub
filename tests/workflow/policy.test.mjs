import { test } from 'node:test'
import assert from 'node:assert/strict'
import { disposition as state, mayPublish, reviewKey, specHash } from '../../scripts/workflow/policy.mjs'
const now = Date.parse('2026-11-05T20:00:00Z')
const lease = { state:'in-progress', owner:'old', epoch:1, spec:specHash('synthetic'), heartbeat:'2026-11-05T19:00:00Z', expires:'2026-11-05T20:00:00Z' }
const s = (changes = {}) => state({approved:true,lease,now,...changes})
test('unapproved work is never recovered',()=>assert.equal(s({approved:false}),'unapproved'))
test('expired lease is stale, not indefinitely active',()=>assert.equal(s(),'stale'))
test('fresh heartbeat is active',()=>assert.equal(s({now:now-1}),'active'))
test('open PR suppresses duplicate execution',()=>assert.equal(s({openPR:true}),'review'))
test('legacy claim requires inspection',()=>assert.equal(s({lease:null}),'inspect-legacy'))
test('invalid and future leases fail closed',()=>{ for (const changes of [{expires:'bad'},{heartbeat:'2027-01-01T00:00:00Z'},{epoch:0},{expires:'2027-01-01T00:00:00Z'}]) assert.equal(s({lease:{...lease,...changes}}),'invalid') })
test('blocked work waits for explicit bounded retry',()=>{assert.equal(s({lease:{state:'blocked'}}),'blocked'); assert.equal(s({lease:{state:'blocked',retryAfter:'2026-11-05T19:00:00Z',attempts:1}}),'retry');assert.equal(s({lease:{state:'blocked',retryAfter:'2026-11-05T19:00:00Z',attempts:3}}),'blocked')})
test('done and review are terminal for implementation',()=>{for(const status of ['done','review']) assert.equal(s({lease:{state:status}}),status)})
test('old owner is fenced after takeover',()=>{const next={...lease,owner:'new',epoch:2,heartbeat:'2026-11-05T20:00:00Z',expires:'2026-11-05T21:00:00Z'};assert.equal(mayPublish({lease:next,owner:'old',epoch:1,spec:lease.spec,now}),false);assert.equal(mayPublish({lease:next,owner:'new',epoch:2,spec:lease.spec,now}),true)})
test('expiry and changed specification prohibit publication',()=>{assert.equal(mayPublish({lease,owner:'old',epoch:1,spec:lease.spec,now}),false);assert.equal(mayPublish({lease,owner:'old',epoch:1,spec:'changed',now:now-1}),false)})
test('duplicate delivery key is stable; changed head or conclusions invalidate',()=>{const x={repository:'New2Dis12/eric-health-hub',pr:11,head:'abc',conclusions:['no-blockers']};assert.equal(reviewKey(x),reviewKey({...x,repository:x.repository.toLowerCase()}));assert.notEqual(reviewKey(x),reviewKey({...x,head:'def'}));assert.notEqual(reviewKey(x),reviewKey({...x,conclusions:['failed-check']}))})
test('specification edits invalidate receipt hash',()=>assert.notEqual(specHash('approved'),specHash('approved\n')))

test('invalid trusted clocks fail closed for an in-progress claim', () => {
  for (const bad of [undefined, NaN, Infinity, -Infinity, '2026-11-05T20:00:00Z', null]) {
    assert.equal(s({ now: bad }), 'invalid')
  }
})
test('invalid trusted clocks cannot authorize blocked retries', () => {
  const blocked = { state: 'blocked', retryAfter: '2026-11-05T19:00:00Z', attempts: 1 }
  for (const bad of [undefined, NaN, Infinity, -Infinity, '2026-11-05T20:00:00Z', null]) {
    assert.equal(s({ lease: blocked, now: bad }), 'invalid')
  }
})
test('invalid trusted clocks prohibit publication', () => {
  const activeLease = { ...lease, expires: '2026-11-05T20:30:00Z' }
  for (const bad of [undefined, NaN, Infinity, -Infinity, '2026-11-05T20:00:00Z', null]) {
    assert.equal(mayPublish({ lease: activeLease, owner: 'old', epoch: 1, spec: lease.spec, now: bad }), false)
  }
})
test('finite clock boundary preserves active, stale, and blocked retry behavior', () => {
  const activeLease = { ...lease, heartbeat: '2026-11-05T20:00:00Z', expires: '2026-11-05T21:00:00Z' }
  assert.equal(s({ lease: activeLease, now }), 'active')
  assert.equal(s({ lease: activeLease, now: Date.parse('2026-11-05T21:00:00Z') }), 'stale')
  assert.equal(s({ lease: { state: 'blocked', retryAfter: '2026-11-05T20:00:00Z', attempts: 1 }, now }), 'retry')
})
