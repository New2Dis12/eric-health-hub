import { createHash } from 'node:crypto'
export const specHash = body => createHash('sha256').update(body, 'utf8').digest('hex')
const instant = value => typeof value === 'string' && /Z$/.test(value) ? Date.parse(value) : NaN
export function disposition({ approved, lease, openPR = false, now }) {
  if (!approved) return 'unapproved'
  if (openPR) return 'review'
  if (!lease) return 'inspect-legacy'
  if (lease.state === 'done' || lease.state === 'review') return lease.state
  if (lease.state === 'blocked') return Number.isFinite(instant(lease.retryAfter)) && instant(lease.retryAfter) <= now && lease.attempts < 3 ? 'retry' : 'blocked'
  const heartbeat = instant(lease.heartbeat), expires = instant(lease.expires)
  if (lease.state !== 'in-progress' || !Number.isInteger(lease.epoch) || lease.epoch < 1 || !lease.owner || !lease.spec || !Number.isFinite(heartbeat) || !Number.isFinite(expires) || expires <= heartbeat || expires - heartbeat > 3600000 || heartbeat > now) return 'invalid'
  return expires > now ? 'active' : 'stale'
}
// Every publication must use the SAME canonical branch ref with expected SHA.
// This predicate does not replace GitHub's compare-and-swap ref update.
export function mayPublish({ lease, owner, epoch, spec, now }) {
  return disposition({ approved: true, lease, now }) === 'active' && lease.owner === owner && lease.epoch === epoch && lease.spec === spec
}
export function reviewKey({ repository, pr, head, conclusions }) {
  return specHash(JSON.stringify([repository.toLowerCase(), pr, head, conclusions]))
}
