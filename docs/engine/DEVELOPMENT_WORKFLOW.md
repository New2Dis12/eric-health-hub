# Approved development workflow

GitHub is the shared backlog and evidence store. One ChatGPT coaching conversation, one Stunna app and shared PostgreSQL training truth are unchanged; this workflow manages software, never athlete records.

## Approval and execution

The product conversation records a bounded issue with acceptance criteria, constraints and `## Workflow state` followed by standalone `approved-for-build`. After explicit owner approval, the interactive coordinator records `<!-- work-approval:v1 -->`, `Decision: approved-for-build`, SHA256 of the entire UTF-8 issue body and the owner authorization reference. Only receipts from New2Dis12 count. The unattended worker never mints receipts. Spec edits invalidate approval; revocation overrides it. Hashes detect edits, not identity forgery: connector actions share the owner's identity, so this is cooperative governance, not an independent security boundary. Proposed work and Sprint 3 are not approved merely by existing as issues/plans.

The enabled Approved GitHub backlog task checks hourly, oldest eligible first, at most one issue per run. It reads current GitHub issues/comments and canonical branch state, not chat history or scratch. Its saved prompt contains the safeguards and works before this PR is merged. The first prepared commit must disable Git deployment for its canonical `work/issue-N` branch in vercel.json before creating that branch. Existing branches must never be reset. No merges or deployments, including previews, occur automatically.

## Recoverable claims and fencing

Issue comments report status; they are NOT locks. Canonical state is `.work/lease.json` on that issue's own `work/issue-N` branch. It contains state, unique owner token, monotonically increasing epoch, approved-spec hash, UTC heartbeat/expiry, checkpoint evidence and optional retryAfter/attempts. Lease duration is at most 60 minutes; renew at least every 15 minutes and before a long operation. If renewal cannot occur, stop publishing when expired. Never equate an in-progress comment with live work.

| State | Scanner action |
|---|---|
| Unapproved, changed spec or revoked | No implementation/recovery. Report a new genuine approval blocker once. |
| Active unexpired lease | Skip; independent runs may not renew another owner's lease. |
| Expired in-progress lease | Inspect PRs, current branch, checkpoints and available task run state. Revalidate approval. If safe, take over at epoch+1 using exact expected branch SHA; resume existing work. |
| Legacy comment without lease | Inspect branch/PR, do not strand indefinitely. Open PR means review; otherwise require approval and establish a lease on the existing branch without resetting work. Ambiguous state becomes blocked with evidence. |
| Blocked | Explain dependency and next action once; retry only a recorded transient dependency after retryAfter, at most 3 attempts. Permanent/auth/product blockers require owner resolution, not repeated execution. |
| Review/open PR | No new implementation or duplicate PR. Technical reviews are handled by the PR task. |
| Done | No execution. Only a verified owner-authorized release outcome can mark done. |

Every lease renewal, takeover and code publication is a commit on the SAME canonical branch, updated with `expected_sha` and non-force GitHub ref update. Include the current lease in code commits. Never use a separate lock branch followed by an unfenced code push. A takeover changes the canonical head; an old worker's stale-head publication must fail. On lease loss, do not rebase/retry with the winner's head. Before every external side effect re-read owner/epoch/spec/expiry, approval and PR existence. PR creation is unique for the head/base and must be reconciled after uncertain network results. Comments are evidence only; avoid duplicate notifications.

Initial branch creation must be create-only: on existing-ref conflict inspect and compete using compare-and-swap, never overwrite. If available tools cannot guarantee create-only semantics, record blocked rather than attempting concurrent initialization. GitHub compare-and-swap fences canonical publications, not wasted local computation or non-atomic comments; exactly-once arbitrary external side effects are NOT promised. Workers remain prohibited from merges, deployments and production writes. Tools may be broadly privileged: prompts and leases are not server-enforced revocation of credentials.

## Event review and deduplication

Stunna PR technical review is a persistent repository-wide GitHub pull_request trigger: opened/ready/closed plus commit updates and human review submissions; conversation comments and bot reviews are disabled. PR body-only edits, edited/deleted reviews and issue events are unsupported. There is no extra polling schedule on this task. The old weekday approval watch is paused to prevent overlap.

Fetch live head, linked approved scope, diff, checks and unresolved review threads. Review correctness, validation, security/RLS/secret handling, compatibility and deployment restrictions. Post/update one `work-review:v1` comment with head SHA and a digest of normalized check/thread conclusions. Same head/conclusions => no write/no notification, regardless of event delivery ID or actor. Changed head/check failures invalidate the cache. Recheck head before posting; do not mark reviewed if posting fails. Reviews do not authorize implementation or release. Comment events disabled prevents the task's own reports looping. Concurrent review delivery remains a cooperative deduplication limitation; one canonical report is updated rather than accumulating comments.

## Evidence, recovery and owner involvement

Maintain one issue status comment with lease/checkpoint references, actual tests/results, blockers and PR link; notify only meaningful blockers or owner decisions. Never fabricate a PASS from absent CI. App changes require tests/typecheck/build; workflow-only changes use focused policy/JSON/whitespace checks. Public GitHub holds no credentials or personal health data. GitHub/Work account authorization must be completed by owner if requested; no new infrastructure/API keys are required by this design.

Owner remains responsible for product/spec approval, material scope changes, resolving ambiguous/permanent blockers, merge/release approval and Stunna activation. Routine approved implementation and stale recovery do not require fresh approval for unchanged scope. Pause tasks in Scheduled to stop new work; active workers must check current authorization before publication. Revoke the issue receipt or change state to blocked to halt that issue. Retain branch/checkpoints for recovery; do not delete/reset them.

## Pilot evidence and limits — 2026-11-05

- Approved issue #10 produced unmerged PR #11 with only synthetic documentation and its deployment exclusion. Its first Run now executed inline; that did not prove unattended implementation.
- The real PR #11 opened event produced one technical report, comment 6666210818. The hourly task subsequently ran unattended, inspected issues #8–10, and correctly performed no duplicate work; recorded result completed at 19:36 UTC. This proves unattended discovery/skip, not unattended code delivery.
- 12 focused policy tests cover active/stale/legacy/blocked/review/done, approval/hash changes, expired/old-owner publication and duplicate review keys. Command: `node --test tests/workflow/*.test.mjs`.
- The isolated `work/lease-pilot` branch contains a synthetic abandoned epoch 1 lease, then epoch 2 recovery with a terminal checkpoint. Git deployment was disabled in its first commit. A stale expected-SHA update failed with a generic connector GraphQL error; the canonical branch head was checked afterward. Even a forward candidate with an outdated expected SHA failed. This demonstrates non-publication in the pilot, but the connector did not expose a specific lease-conflict error; see issue #8 for commits. No product task ran.
- Run now is unavailable for webhook tasks in this account. Duplicate review-key tests pass locally; a harmless COMMENT review on unchanged PR #11 is used as a second live event. Check issue #8 for the observed replay result; do not equate task configuration or local tests with live deduplication proof.
- Unapproved issue #9 remains untouched. No production changes, merges or Sprint 3 implementation are included. Whole-workflow readiness is limited by cooperative tool permissions and absence of a demonstrated unattended implementation+recovery run; do not claim exactly-once execution.

Official task capability reference: https://learn.chatgpt.com/docs/automations . Web tasks may rehydrate from connected GitHub but do not retain local worktrees between runs. Account availability and connection failures can block a run; record actionable evidence rather than assuming a worker stays alive.


## Controlled repair and actual readiness — 2026-11-05

Owner asked to resolve the stalled workflow. Paused the backlog worker, PR reviewer and separate clock escalation while an owner-directed writer finished the correction. No automatic retry counter was reset: three failed/expired attempts remain recorded. The same PR receives a single implementation-changing repair and terminal review checkpoint, rather than another heartbeat-only publication.

The clock contract is finite safe-integer epoch milliseconds within JavaScript Date range (absolute value <= 8640000000000000). It rejects missing, nonnumeric, nonfinite, fractional and out-of-range inputs before time-based expiry/retry classification; mayPublish consequently fails closed. Early unapproved/open-PR/terminal states remain conservative. The targeted workflow suite now includes Date-range and publication regression probes.

Observed failure chain: canonical leases advanced while implementation did not; one local validation attempt failed because Turbopack rejected node_modules pointing outside the checkout, and a subsequent publication preparation failed with GitHub Invalid tree info (422). Review events arrived while coding work remained unfinished in this shared conversation. These are actual failures, not successful correction delivery. A claim/heartbeat alone is never proof of live execution. Service-level isolation between writers and event reviewers was not demonstrated.

Simpler operating rule: one writer completes validation, constructs a tree from a verified nonempty base tree, publishes an implementation checkpoint under expected-head fencing and updates GitHub evidence before requesting review. Avoid intermediate lease-only publications unless a genuinely running long task needs renewal. Keep technical reviews read-only. During controlled repair pause competing workflow tasks, then restore only the reviewer for completed-source events. The backlog execution and redundant clock-escalation task stay paused until an isolated unattended implementation→review→correction run succeeds; do not describe their configured prompts as a working coding pipeline. Product approval, merge, deployments and Stunna activation remain separate owner decisions.

The real PR #11 event-review and sequential deduplication pilot passed (issue #8 comment 6668163964). Automated coding/recovery reliability remains unproven. Restoring it requires demonstrating a synthetic approved task from pickup through a real implementation commit and read-only review, without intermediate events stranding the writer. No new infrastructure, chatbot, production configuration or Sprint 3 work is included.
