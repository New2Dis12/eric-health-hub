import type { SessionResults } from './logging-models'
import { sourceLinkReceipt, type SourceLinkInput } from './source-evidence-models'

export function parseSourceReceipt(value: unknown) {
  const parsed=sourceLinkReceipt.safeParse(value)
  if(!parsed.success) throw new Error('Invalid source receipt')
  return parsed.data
}
export function sourceReceiptMatches(command:SourceLinkInput,receipt:ReturnType<typeof parseSourceReceipt>,current:SessionResults|null) {
  if(receipt.actualSessionId!==command.sessionId || receipt.evidenceRevision!==command.expectedEvidenceRevision+1 || !current || current.sessionId!==command.sessionId ||
    current.status!=='completed' || !Number.isInteger(current.sessionRevision) || current.sessionRevision<command.expectedSessionRevision ||
    current.sourceResult?.status!=='matched') return false
  return current.sourceResult.evidence.some(saved=>sourceLinkReceipt.shape.evidenceId.safeParse(saved.id).success && saved.evidence.version===1 && saved.evidence.format==='FIT' && saved.evidence.provider==='garmin' &&
    saved.evidence.sourceId===String(command.activityId) && saved.evidence.match.confirmedActivityId===String(command.activityId) &&
    Number.isInteger(saved.revision) && saved.revision>=receipt.evidenceRevision &&
    // A later refresh can supersede this receipt, but equal revisions must have the exact immutable ID.
    (saved.revision>receipt.evidenceRevision || saved.id===receipt.evidenceId))
}
