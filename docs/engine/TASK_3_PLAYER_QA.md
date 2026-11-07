# Task 3 strength player

The existing inline Start/Resume now opens the pinned session player. Exercises retain their saved order, cues, targets, rest, equipment and adjustment instructions. Actual controls and prescription text remain distinct. Comparison context is labeled as context, and unavailable pinned previous performance is explicit.

The compact strength grid places the Log Set bubble on the left and Edit on the right. Unlogged rows label their proposed reps and show the prescribed load when available. Log Set explicitly confirms reps and a load only when the prescription supplies a compatible unit and verified basis. Edit opens one set editor at a time, with a native optional RPE select in half steps from 0 to 10. Saving closes the editor after authoritative readback. Cancel discards only that row's draft. Logged rows display server-confirmed values. Warmups and cardio are read-only. Steady cardio shows prescribed duration, and interval cardio shows calculated planned elapsed ranges across repeats. A missing duration makes that range and dependent ranges unknown. Per-exercise notes follow each exercise, and overall notes follow all exercises. Finalized and legacy sessions are read-only.

The client pages all current results and restarts bounded reads if session revisions change between pages. Writes retain the exact pending command/idempotency key after a failed confirmation. Editing creates a new command. Conflicts refresh current server state while preserving dirty drafts, with an explicit review/retry message. Back and browser unload warn for edits or pending writes. Sensitive drafts exist in memory only. Starting/resuming is hidden while the player is open to prevent accidental loss through a duplicate entry action.

One minimal Task2 integration correction removes the prerequisite that a pinned strength set have prescribed reps. The ordinal must still be within prescribed sets. This permits user-confirmed null/entered actual reps when the approved prescription leaves reps unspecified. A local SQL/service regression covers it. No schema, authentication, provider or endpoint changes accompany this correction.

## Local evidence and limits

React component tests use synthetic fixtures and react-test-renderer, which currently emits its upstream deprecation warning. They cover component hierarchy/snapshot, proposed reps/Edit, native RPE options, actual rehydration, finalized fields, separate session views, dirty note conflict/retry, paged reads, post-write read confirmation, same-key retry and normal player note saves/clear. The committed mobile component snapshot records hierarchy/control values, alongside a 44px CSS assertion. It is a structural snapshot, not a browser screenshot or a claim of measured layout on iPhone. Existing restricted-role SQL/HTTP suites cover shared persistence, authorization, CSRF, RLS and idempotency. No hosted resources or personal records were used.

## Practical mobile review after separate Preview approval

1. At 375px Safari, select synthetic strength from the retained calendar/overview. Open Start/Resume. Inspect labels, numeric keyboards, focus outlines, text wrapping and 44px controls without horizontal overflow.
2. Check proposed upper-bound reps, valid prescribed load, blank RPE and far-right Edit. Tap the left bubble to log one synthetic set. Open Edit and log another set with distinct kg/lb and total/per-hand conventions and half-step RPE. Reload and compare saved values, then correct one.
3. Save, clear and reload exercise notes at the bottom of strength and endurance blocks. Save overall notes after the final block. Confirm combined-day sessions remain separate.
4. In two authenticated tabs, edit the same session. Confirm conflict refreshes server truth while retaining the losing draft. Retry a failed confirmation safely. Navigate Back/calendar with unsaved text and verify the warning.
5. Inspect the read-only warmup rows, steady duration and interval planned clock across repeats. Confirm that unknown durations propagate and there are no cardio save controls. Inspect finalized and unpinned fixtures read-only. Test sign-out and authorization rejection through existing protections.

Preview deployment, hosted fixtures, browser/device acceptance, migration/configuration, merge/release and activation require their separate gates. This implementation stops for independent technical review and owner acceptance.
