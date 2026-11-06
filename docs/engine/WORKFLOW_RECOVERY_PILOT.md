# Synthetic workflow recovery pilot

This documentation-only pilot implements [issue #13](https://github.com/New2Dis12/eric-health-hub/issues/13) for [workflow #8](https://github.com/New2Dis12/eric-health-hub/issues/8). The implementation PR is linked in issue #13's single `work-status:v2` comment and in the repository's pull-request list for `work/issue-13`; that live status records the final publication SHA and PR URL without requiring a self-referential commit.

## Observed recovery and delivery

- The coordinator prepared seed commit `b25bec45add2129c28048830bebb4ed1da6ae1d7` from main `8281722a70607f626dd62737f08b4df9a986a224`. It contained only an expired synthetic lease and `vercel.json` exclusion `git.deploymentEnabled["work/issue-13"]=false` before branch creation. This document was absent.
- The worker rehydrated a fresh checkout, fetched the current issue and all its comments, and verified owner receipt `6675538940` against SHA256 of the entire UTF-8 issue body: `e90ec1404141e21fa80446813ff4076edbc1e90a5282d502972017ec8bbb79a6`. No approval was minted or changed by the worker.
- Epoch 1 belonged to `synthetic-abandoned-pilot-13`, with heartbeat `2026-11-06T02:05:59.693Z` and expiry `2026-11-06T02:45:59.693Z`. The coordinator explicitly identified it as a synthetic abandoned claim with no live worker. Live branch/history, issue status, PR discovery and available task-run state were inspected before recovery.
- The worker recovered the same branch at epoch 2 in commit `39b06a40de4bf89300f169a23cc1850f53f2887a`. The update used `expected_sha=b25bec45add2129c28048830bebb4ed1da6ae1d7` and `force=false`, then read back owner and epoch. The new heartbeat was `2026-11-06T03:04:43.685Z`, with a 30-minute expiry. Claim publication alone was not treated as delivery.
- The following implementation checkpoint adds this actual document and changes the canonical lease to `review`, retaining recovery history. Only this document, the lease and the existing branch deployment exclusion are in scope. The issue status identifies the exact final commit and unmerged PR after remote readback.

## Validation and boundaries

The worker validates both JSON files, checks the deployment exclusion, restricts the diff to the three approved paths, and runs `git diff --check` before publication. Actual command results are recorded in the canonical issue status. No application scripts, app tests, typecheck, build or hosted health checks are needed or claimed for this documentation-only change. No credentials or personal health/training records are used.

Opening the unmerged PR supplies a real event to the existing read-only technical reviewer. Review completion, duplicate-event suppression and any correction cycle are pending until separately observed in GitHub; this document does not claim those stages passed. The coding worker must not review its own implementation as a substitute for event delivery.

## Remaining limitations and owner decisions

This run can demonstrate scheduled pickup, synthetic stale recovery and real documentation publication. It does not prove exactly-once execution, simultaneous competing-worker safety, server-enforced permission isolation, or automatic correction delivery. Initial branch creation was performed by the interactive coordinator; unattended create-only collision rejection remains unproven. Native Git write authentication was unavailable during preparation; connector publication is used instead. Read-only searches are cross-checked because issue search can return issue results even for PR qualifiers.

All other coding remains paused by the pilot restriction. Issue #9 is unapproved and untouched; PR #12 is not modified. App code, integrations, Production settings and training databases remain outside this pilot. No merge, deployment (including Preview), Sprint 3 implementation, real-record import or Stunna activation is authorized. After review, the owner decides whether the workflow is ready for broader use; a technical GO is not release approval.
