# Approved development workflow

GitHub is the shared backlog and evidence store. One ChatGPT coaching conversation, one Stunna app and shared PostgreSQL training truth are unchanged; this workflow manages software, never athlete records.

## Approval and execution

The product conversation records a bounded issue with acceptance criteria, constraints and `## Workflow state` followed by standalone `approved-for-build`. After explicit owner approval, the interactive coordinator records `<!-- work-approval:v1 -->`, `Decision: approved-for-build`, SHA256 of the entire UTF-8 issue body and the owner authorization reference. Only receipts from New2Dis12 count. The unattended worker never mints receipts. Spec edits invalidate approval; revocation overrides it. Hashes detect edits, not identity forgery: connector actions share the owner's identity, so this is cooperative governance, not an independent security boundary. Proposed work and Sprint 3 are not approved merely by existing as issues/plans.

The Approved GitHub backlog task is configured hourly, oldest eligible first, at most one issue per run. Current owner authorization restricts it to Issue #8 closeout; broad intake and additional pilot corrections remain stopped pending owner review. The schedule is a pickup mechanism, not permission to execute every approved issue. It reads current GitHub issues/comments and canonical branch state, not chat history or scratch. Its saved prompt contains the safeguards and works before this PR is merged. The first prepared commit must disable Git deployment for its canonical `work/issue-N` branch in vercel.json before creating that branch. Existing branches must never be reset. No merges or deployments, including previews, occur automatically.

## Recoverable claims and fencing

Issue comments report status; they are NOT locks. Canonical state is `.work/lease.json` on that issue's own `work/issue-N` branch. It contains state, unique owner token, monotonically increasing epoch, approved-spec hash, UTC heartbeat/expiry, checkpoint evidence and optional retryAfter/attempts. Lease duration is at most 60 minutes; renew at least every 15 minutes and before a long operation. If renewal cannot occur, stop publishing when expired. Never equate an in-progress comment with live work.

| State | Scanner action |
|---|---|
| Unapproved, changed spec or revoked | No implementation/recovery. Report a new genuine approval blocker once. |
| Active unexpired lease | Skip; independent runs may not renew another owner's lease. |
| Expired in-progress lease | Inspect PRs, current branch, checkpoints and available task run state. Revalidate approval. If safe, take over at epoch+1 using exact expected branch SHA; resume existing work. |
| Legacy comment without lease | Inspect branch/PR, do not strand indefinitely. Open PR means review; otherwise require approval and establish a lease on the existing branch without resetting work. Ambiguous state becomes blocked with evidence. |
| Blocked | Explain dependency and next action once; retry only a recorded transient dependency after retryAfter, at most 3 attempts. Permanent/auth/product blockers require owner resolution, not repeated execution. |
| Review/open PR | No duplicate initial implementation or PR. Only a fresh current-head actionable finding within the unchanged approved scope can enter bounded correction. Terminal expiry alone never permits recovery. Reviewer GO awaits owner decision. |
| Done | No execution. Only a verified owner-authorized release outcome can mark done. |

Every lease renewal, takeover and code publication is a commit on the SAME canonical branch, updated with `expected_sha` and non-force GitHub ref update. Include the current lease in code commits. Never use a separate lock branch followed by an unfenced code push. A takeover changes the canonical head; an old worker's stale-head publication must fail. On lease loss, do not rebase/retry with the winner's head. Before every external side effect re-read owner/epoch/spec/expiry, approval and PR existence. PR creation is unique for the head/base and must be reconciled after uncertain network results. Comments are evidence only; avoid duplicate notifications.

Initial branch creation must be create-only: on existing-ref conflict inspect and compete using compare-and-swap, never overwrite. If available tools cannot guarantee create-only semantics, record blocked rather than attempting concurrent initialization. GitHub compare-and-swap fences canonical publications, not wasted local computation or non-atomic comments; exactly-once arbitrary external side effects are NOT promised. Workers remain prohibited from merges, deployments and production writes. Tools may be broadly privileged: prompts and leases are not server-enforced revocation of credentials.

## Event review and deduplication

Stunna PR technical review is a persistent repository-wide GitHub pull_request trigger: opened/ready/closed plus commit updates and human review submissions; conversation comments and bot reviews are disabled. PR body-only edits, edited/deleted reviews and issue events are unsupported. There is no extra polling schedule on this task. The old weekday approval watch is paused to prevent overlap.

Fetch live head, linked approved scope, diff, checks and unresolved review threads. Review correctness, validation, security/RLS/secret handling, compatibility and deployment restrictions. Post/update one `work-review:v1` comment with head SHA and a digest of normalized check/thread conclusions. Same head/conclusions => no write/no notification, regardless of event delivery ID or actor. Changed head/check failures invalidate the cache. Recheck head before posting; do not mark reviewed if posting fails. Reviews do not authorize implementation or release. Comment events disabled prevents the task's own reports looping. Concurrent review delivery remains a cooperative deduplication limitation; one canonical report is updated rather than accumulating comments.

## Evidence, recovery and owner involvement

Maintain one issue status comment with lease/checkpoint references, actual tests/results, blockers and PR link; notify only meaningful blockers or owner decisions. Never fabricate a PASS from absent CI. App changes require tests/typecheck/build; workflow-only changes use focused policy/JSON/whitespace checks. Public GitHub holds no credentials or personal health data. GitHub/Work account authorization must be completed by owner if requested; no new infrastructure/API keys are required by this design.

Owner remains responsible for product/spec approval, material scope changes, resolving ambiguous/permanent blockers, merge/release approval and Stunna activation. Routine approved implementation and stale recovery do not require fresh approval for unchanged scope. Pause tasks in Scheduled to stop new work; active workers must check current authorization before publication. Revoke the issue receipt or change state to blocked to halt that issue. Retain branch/checkpoints for recovery; do not delete/reset them.

## Historical pilot evidence and limits — 2026-11-05

These are the results available at that checkpoint. The 2026-11-06 closeout below supersedes its pending/unproven status for the specific observed synthetic case; failed-attempt history remains intact.

- Approved issue #10 produced unmerged PR #11 with only synthetic documentation and its deployment exclusion. Its first Run now executed inline; that did not prove unattended implementation.
- The real PR #11 opened event produced one technical report, comment 6666210818. The hourly task subsequently ran unattended, inspected issues #8–10, and correctly performed no duplicate work; recorded result completed at 19:36 UTC. This proves unattended discovery/skip, not unattended code delivery.
- 12 focused policy tests cover active/stale/legacy/blocked/review/done, approval/hash changes, expired/old-owner publication and duplicate review keys. Command: `node --test tests/workflow/*.test.mjs`.
- The isolated `work/lease-pilot` branch contains a synthetic abandoned epoch 1 lease, then epoch 2 recovery with a terminal checkpoint. Git deployment was disabled in its first commit. A stale expected-SHA update failed with a generic connector GraphQL error; the canonical branch head was checked afterward. Even a forward candidate with an outdated expected SHA failed. This demonstrates non-publication in the pilot, but the connector did not expose a specific lease-conflict error; see issue #8 for commits. No product task ran.
- Run now is unavailable for webhook tasks in this account. Duplicate review-key tests pass locally; a harmless COMMENT review on unchanged PR #11 is used as a second live event. Check issue #8 for the observed replay result; do not equate task configuration or local tests with live deduplication proof.
- Unapproved issue #9 remains untouched. No production changes, merges or Sprint 3 implementation are included. Whole-workflow readiness is limited by cooperative tool permissions and absence of a demonstrated unattended implementation+recovery run; do not claim exactly-once execution.

Official task capability reference: https://learn.chatgpt.com/docs/automations . Web tasks may rehydrate from connected GitHub but do not retain local worktrees between runs. Account availability and connection failures can block a run; record actionable evidence rather than assuming a worker stays alive.


## Historical controlled repair and readiness — 2026-11-05

This records the stalled phase and its repair, before the later scheduled pilot. Its pause/readiness statements describe that phase, not the current closeout verdict.

Owner asked to resolve the stalled workflow. Paused the backlog worker, PR reviewer and separate clock escalation while an owner-directed writer finished the correction. No automatic retry counter was reset: three failed/expired attempts remain recorded. The same PR receives a single implementation-changing repair and terminal review checkpoint, rather than another heartbeat-only publication.

The clock contract is finite safe-integer epoch milliseconds within JavaScript Date range (absolute value <= 8640000000000000). It rejects missing, nonnumeric, nonfinite, fractional and out-of-range inputs before time-based expiry/retry classification; mayPublish consequently fails closed. Early unapproved/open-PR/terminal states remain conservative. The targeted workflow suite now includes Date-range and publication regression probes.

Observed failure chain: canonical leases advanced while implementation did not; one local validation attempt failed because Turbopack rejected node_modules pointing outside the checkout, and a subsequent publication preparation failed with GitHub Invalid tree info (422). Review events arrived while coding work remained unfinished in this shared conversation. These are actual failures, not successful correction delivery. A claim/heartbeat alone is never proof of live execution. Service-level isolation between writers and event reviewers was not demonstrated.

Simpler operating rule: one writer completes validation, constructs a tree from a verified nonempty base tree, publishes an implementation checkpoint under expected-head fencing and updates GitHub evidence before requesting review. Avoid intermediate lease-only publications unless a genuinely running long task needs renewal. Keep technical reviews read-only. During controlled repair pause competing workflow tasks, then restore only the reviewer for completed-source events. The backlog execution and redundant clock-escalation task stay paused until an isolated unattended implementation→review→correction run succeeds; do not describe their configured prompts as a working coding pipeline. Product approval, merge, deployments and Stunna activation remain separate owner decisions.

The real PR #11 event-review and sequential deduplication pilot passed (issue #8 comment 6668163964). Automated coding/recovery reliability remains unproven. Restoring it requires demonstrating a synthetic approved task from pickup through a real implementation commit and read-only review, without intermediate events stranding the writer. No new infrastructure, chatbot, production configuration or Sprint 3 work is included.


## Closeout evidence and operating state — 2026-11-06 UTC

The bounded workflow pilot now has an observed implementation → independent review → scoped correction → independent re-review path. This is technical evidence for owner review, not merge, deployment, broad backlog activation or Sprint 3 approval. The live Issue #8 body still matches owner receipt [6668067558](https://github.com/New2Dis12/eric-health-hub/issues/8#issuecomment-6668067558), SHA256 `c9bdb8a1016c35341082e2ecc4e11acb10d77d88ed93645865c84b8dcb59c206`. Closeout is the owner-directed documentation phase in [6678997668](https://github.com/New2Dis12/eric-health-hub/issues/8#issuecomment-6678997668), not a fourth automatic correction. The three exhausted Issue #8 attempts and controlled repair remain in its lease history.

| Evidence | Actual result and boundary |
|---|---|
| Approved pickup, stale recovery and publication | [Issue #13 / PR #14](https://github.com/New2Dis12/eric-health-hub/pull/14) recovered the synthetic expired lease from seed `b25bec45add2129c28048830bebb4ed1da6ae1d7` at epoch 2, then published the real document at `ae7a48001a5a287561a945c5367a27b3a8c26aaa`. The coordinator had prepared the deployment-disabled seed; unattended initial branch creation was not tested. |
| Event review and duplicate suppression | One canonical [PR #14 report](https://github.com/New2Dis12/eric-health-hub/pull/14#issuecomment-6675858045) recorded initial GO and sequential unchanged-head event suppression. This does not prove simultaneous event handling or transport redelivery. PR #11's earlier [dedup receipt](https://github.com/New2Dis12/eric-health-hub/issues/8#issuecomment-6668163964) remains historical evidence. |
| Inline versus scheduled correction | The first P3 document refresh at `b1cebed0a1742d5b533f792cacfceb96a0186515` ran inline and is not unattended-delivery evidence. A later distinct synthetic finding was queued through GitHub; the normal scheduled worker reserved cumulative attempt 2 / epoch 4 at `d54d60030917fb69ef92dff8210247ec346bb00a`, then published `5beb54370bb6629b0b0c94799f2133fe1a9a81d7` on the same branch/PR. |
| Unattended correction-to-review | Run `3ed825c3-c378-8324-93fe-e63ad6619f37`, scheduled 04:59:10Z, started 05:01:00.770429Z and completed 05:09:12.362806Z, matches that publication. Its commit event produced current-head independent GO. [Independent verdict](https://github.com/New2Dis12/eric-health-hub/issues/8#issuecomment-6677515177) verified the run, lineage and review. No Run now/interactive implementation performed that correction. |
| Terminal-state skip | The earlier corrected-head review was skipped without writes or another attempt. Raw run timestamps contain a start-before-scheduled anomaly, preserved in [pilot evidence](https://github.com/New2Dis12/eric-health-hub/blob/5beb54370bb6629b0b0c94799f2133fe1a9a81d7/docs/engine/WORKFLOW_RECOVERY_PILOT.md); no scheduler-accuracy inference is made. |
| Invalid-clock repair | [PR #12 report](https://github.com/New2Dis12/eric-health-hub/pull/12#issuecomment-6668132687) gave technical GO to `0c11d43e82d32c3b096641591313d6ebef91fc22`. This documentation update requires fresh head review; prior GO is not automatically transferred. |

Do not repeat completed synthetic tests or manufacture further findings. PR #14 at `5beb54370bb6629b0b0c94799f2133fe1a9a81d7` remains immutable evidence. Issue #9 is unapproved and untouched. Neither PR is merged.

### Bounded corrections and low-noise handoff

The reviewer only reads and reports. An actionable report contains `correction.issue`, `reviewedHead` and stable findings (`key`, severity, file, summary) in fenced JSON in its canonical `work-review:v1` comment. JSON is a routing hint, not approval. The scheduled coding worker independently revalidates the complete current spec/owner receipt and the finding's scope. It reserves a correction attempt on the same canonical branch with exact expected-head fencing before editing. It uses the same PR, tests the smallest correction and publishes actual implementation plus a terminal review lease. A commit event invokes independent review; the reviewer does not write code or implementation leases.

Keep stable finding IDs and a cumulative correction ledger across changed heads/wording. Maximum three attempts per issue/spec, including expired or failed attempts; no resets. A pending published fix, equivalent attempted head/finding, active lease, resolved finding or unchanged conclusions suppresses duplicate work. Heartbeat-only events during active coding are not new material reviews. Third failure, changed scope, uncertain authorization or material product/security/credential/database/release decision produces one actionable owner-required blocker. Tool retries are bounded separately (at most three, with recorded retryAfter). No tight polling or repeated owner relay for routine unchanged approved scope. Pickup latency can be one hour plus execution time.

The saved scanner prompt governs correction routing until reviewed policy is integrated on main. `scripts/workflow/policy.mjs` is a focused approval/lease/publication/dedup helper, not an autonomous scheduler or a complete correction runner. Its conservative open-PR disposition prevents duplicate initial work; the saved worker's correction protocol separately evaluates a fresh scoped finding. Neither code nor prompts create server-enforced permission isolation.

Observed automation covers this synthetic approved case, not arbitrary app-defect detection, simultaneous writers, initial create-only collision rejection, exactly-once external effects or webhook transport redelivery. Shared connector identity and broad credentials remain cooperative controls. Fail closed on missing/invalid clocks, approval ambiguity, missing/corrupt leases or lost expected-head ownership. Never reset someone else's work. One issue status and one PR technical report hold substantive results; no Slack/email, generic progress spam or self-comment loops. After closeout, coding stops in review; broader pickup requires a separate owner decision. The persistent read-only PR trigger remains available for future events.

### Deployment and PR integration gate — no release authorized

Read-only Vercel access for existing team `stunna4` / project `eric-health-hub` was restored (see [6680291491](https://github.com/New2Dis12/eric-health-hub/issues/8#issuecomment-6680291491)). Live deployment history confirms main `8281722a70607f626dd62737f08b4df9a986a224` produced READY Production deployment `dpl_3enmhskP2hHwA8Jc6zAmbHh95jEB`. Project lookup confirms the existing project; the exposed summary does not establish an effective Git-deployment freeze. Existing feature-branch exclusions do not cover main. There is currently NO verified authorized no-deployment merge path.

[Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration) documents `git.deploymentEnabled`; [Git deployment behavior](https://vercel.com/docs/git) includes production-branch builds. Preventing domain promotion alone is insufficient for a no-deployment condition: a build/deployment may still be created. No setting, exclusion, environment variable, Git connection or deployment was changed during closeout.

| Overlap | Safe reconciliation proposal; not executed |
|---|---|
| `.work/lease.json` | PR #12 contains Issue #8's live/history state; PR #14 contains Issue #13's pilot state. Never overwrite either with the other or merge the pilot lease into main. Preserve original commits and issue/review receipts. Before any merge, obtain an explicit finalization decision to archive/exclude transient lease state from the merge payload while retaining recovery evidence; this run leaves the canonical Issue #8 lease intact. |
| `vercel.json` | PR #12 adds `work/issue-8` and `work/lease-pilot`; PR #14 adds `work/issue-13`. Preserve all existing exclusions plus their union in any authorized integrated payload. A false entry for these branches does not disable main. No configuration reconciliation is performed now. |
| Pilot document | Retain PR #14 and its exact head as evidence. Prefer integrating the workflow through PR #12 with immutable pilot links rather than merging PR #14 as-is. If an owner later wants the pilot document on main, copy only the reviewed document in an authorized reconciled change, never its operational lease. |

Required sequence, subject to separate owner approval:

1. Choose either a no-deployment integration or a separately approved Production release. Recommended no-deployment option: separately authorize adding `git.deploymentEnabled["main"]=false` to the reviewed merge payload, preserving all other exclusions, or an equivalent verified block in the existing project. Unspecified branches default to enabled and any matching true rule can override a false rule, so inspect the exact final configuration before authorizing a merge. This proposed exclusion is not applied by closeout. If available tools cannot verify that gate, remain blocked; do not experiment by merging. Re-enabling deployment is a separate release action.
2. Approve the reconciled merge payload: archive/exclude transient lease state without losing audit history, union deployment exclusions if pilot content is integrated, and preserve PR #14. Keep all Stunna/Production settings and provider credentials unchanged. No automatic branch/PR closure or issue-done transition is implied.
3. Validate that exact final payload and obtain current-head independent technical review. Only then request explicit owner merge approval; technical GO alone is not release approval. Verify no deployment was created if the approved route requires none.

The documentation is ready for owner review; merging PR #12/#14 as-is remains NO-GO. Required decision is the deployment gate and final lease/config integration, not another synthetic pilot or Sprint 3 build approval.

### Closeout validation

This documentation phase runs `node --test tests/workflow/*.test.mjs`, parses lease/Vercel JSON, verifies unchanged deployment exclusions and approved changed paths, and runs `git diff --check`. Actual counts and the final head are recorded in Issue #8's canonical status after publication. No application source, schema, dependency or runtime configuration changes are made here, so app tests/typecheck/build and hosted health checks are not rerun or claimed. The earlier 20 workflow / 58 app tests, typecheck and build PASS belong to the controlled clock-repair checkpoint, not this phase.
