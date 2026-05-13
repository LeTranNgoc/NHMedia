# Phase Completion Gate (cook + multi-phase skills)

For multi-phase skills (`cook` today, future `fix` if it grows multi-phase), "skill completion" is **not** "current phase done" — it is "**ALL phases done**". This rule defines the contract that prevents the chain prompt (`/test`, `/simplify`, `/git`) from firing mid-plan.

## Why

`workflow-chaining.md` mandates that completing a chain-key skill MUST fire `AskUserQuestion` with next-step options. Without an explicit definition of "completing", the LLM running `cook` is free to interpret "I finished phase 3 out of 6" as "skill complete" → fires `Proceed to /test|/simplify|/git` while the plan is still mid-flight.

That is a spec violation. Concrete user impact: half-implemented plan gets shipped to simplify/review/git; remaining phases either get dropped or executed without the chain context.

This rule closes the gap with an auditable state file (`<plan-dir>/.cook-state.json`) and a hard contract on what cook MUST do before any chain-options prompt.

## Contract (cook)

Cook MUST do the following, in order, when invoked with a **plan directory** (not a single phase file, not free-form, not `--fast`):

1. **Init state** — after counting phase files in the plan-dir, BEFORE executing phase 1:
   ```bash
   node .claude/hooks/cook-state.cjs init <plan-dir> <total-phases>
   ```
   Creates `<plan-dir>/.cook-state.json` with `status: "in-progress"`, `completedPhases: 0`, `totalPhases: N`.

2. **Update state after each phase done** — right after a phase's compile gate + smoke check pass:
   ```bash
   node .claude/hooks/cook-state.cjs update <plan-dir> <phase-name>
   ```
   Increments `completedPhases`, appends the phase to `completedPhaseNames`.

3. **Check before any chain-options prompt** — before invoking `AskUserQuestion` whose options include any of:
   - `Proceed to /test`
   - `Proceed to /simplify`
   - `Proceed to /review`
   - `Proceed to /git`
   - `Skip to /test` / `Skip to /simplify` / `Skip to /review` / `Skip to /git`

   Run:
   ```bash
   node .claude/hooks/cook-state.cjs check <plan-dir>
   ```
   Parse the JSON output.
   - `isComplete: false` → **DO NOT prompt.** Print one line: `Phase X/Y done — loading next phase`. Continue executing the next phase. No exceptions.
   - `isComplete: true` → present chain options normally.

4. **Finalize after final phase** — when all phases are marked done:
   ```bash
   node .claude/hooks/cook-state.cjs finalize <plan-dir>
   ```
   Sets `status: "complete"`. The next `check` will return `isComplete: true`.

## In-phase TDD (does NOT trigger chain)

A phase file with frontmatter `test-strategy: tdd` OR containing a `## Test Spec` section enters TDD flow **inside the phase loop**:

1. Spawn `tester` agent → write tests from `## Test Spec` (or extract from Requirements + Success Criteria).
2. Spawn `developer` agent → implement against the tests.
3. Run tests until green.
4. Mark phase done → update state → next phase.

This is internal to one phase iteration. It does **NOT**:
- Trigger the `/test` skill.
- Call `AskUserQuestion` with workflow-chain options (`Proceed to /test|/simplify|/git`).
- Count as "skill complete" for chain purposes.

The `/test` skill (separate from in-phase TDD) is for whole-feature coverage AFTER cook completes all phases.

## Edge cases

| Case | Behavior |
|---|---|
| `/cook --fast` (no plan-dir) | DO NOT init state. Normal flow. Chain fires after the single execution unit. |
| `/cook <single-phase.md>` (single phase from a plan) | DO NOT init state. Treat as one-shot. Chain fires after that phase (user explicitly picked one). |
| `/cook plans/foo/` with plan-dir | Init state. Full gate active until finalize. |
| Cook crashes mid-plan | State stays `in-progress` with partial `completedPhaseNames`. Next `/cook plans/foo/` invocation: read state, `AskUserQuestion` → "Resume from phase X+1 / Restart from phase 1 / Cancel". |
| User deletes plan-dir manually | State file gone. `check` returns `no-state` (fail-open). No chain prompt suppression for that dir. |
| State file corrupt JSON | `check` returns `no-state` (fail-open). Cook should treat as "no plan context", re-init if a plan-dir is still being processed. |
| Plan with exactly 1 phase | Init → execute → update → finalize → check returns `isComplete: true` → chain fires normally. |
| Parallel cook on same plan-dir | Out of scope. Document as single-plan-at-a-time. Two writers will race on the state file. |

## Enforcement

This rule is MANDATORY for cook. Any AskUserQuestion containing chain-option strings (listed in step 3) without a preceding `cook-state.cjs check` returning `isComplete: true` is a spec violation.

Future multi-phase skills (e.g. a multi-phase `/fix` workflow) MUST adopt the same gate. Adding a new producer skill that runs multi-phase plans → wire it to this contract, do not invent a parallel mechanism.

## Interaction with workflow-chaining.md

`workflow-chaining.md` says: "After completing any skill that is a key in `workflow.chains`, you MUST present next-step options."

For cook running a plan-dir, **"completing"** = `cook-state.cjs check` returns `isComplete: true`. Until that point, cook is mid-execution and MUST continue the phase loop instead of prompting.

`workflow-chaining.md` references this file in its Enforcement section. The two rules together form the complete chain-prompt contract.

## Why no hook-level enforcement (for now)

We considered a `PreToolUse` hook on `AskUserQuestion` that would scan for the most recent plan-dir and block bad calls. Rejected because: (a) plan-dir detection is heuristic (multiple plan-dirs may exist), (b) false positives when user genuinely wants to stop mid-plan, (c) brittle. Spec-level enforcement via this rule + the auditable state file is preferred. If LLM compliance proves insufficient in practice, escalate to a hook then.
