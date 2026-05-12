---
name: plans
description: |
  Manage the Yames feature roadmap and implementation plans (plans/ folder). Use when discussing
  future features, past plans, what to build next, prioritization, or when a feature has been
  completed and its plan should be cleaned up. Also use when resuming implementation work
  across sessions — tracks what's done and what's pending.
metadata:
  author: a0d0oe0
sample-prompts:
  - "what's next on the roadmap?"
  - "what features are planned?"
  - "we just shipped accent patterns, clean it up"
  - "let's plan the next feature"
  - "what's the status of playing evaluation?"
  - "remove the mobile plan, we're not doing it"
  - "let's continue implementing playing evaluation"
  - "where did we leave off?"
arguments:
  - "[topic] - optional feature name or action (e.g. 'playing evaluation', 'clean up accent patterns')"
---

# Plans & Roadmap Management

## File Locations

- `plans/FEATURE_ROADMAP.md` — Prioritized feature wish list (source of truth for what's planned)
- `plans/*_PLAN.md` — Detailed implementation plans for specific features
- `plans/*_BACKLOG.md` — Future/deferred ideas related to a feature

## Rules — MANDATORY

### 1. Always read the plans folder first

Before answering any question about planned features, priorities, or what to build next:
- Read `plans/FEATURE_ROADMAP.md` for the current prioritized list
- Read any relevant `*_PLAN.md` files for implementation details
- Check git log for recently shipped features that might need cleanup

### 2. When a feature ships, clean up

When the user says a feature has been completed/shipped/implemented:
1. **Remove it from `plans/FEATURE_ROADMAP.md`** — delete its entry entirely
2. **Delete its implementation plan** (`*_PLAN.md`) — the code is the source of truth now, not the plan
3. **Delete any related backlog files** (`*_BACKLOG.md`) unless the user says to keep them
4. **Renumber remaining items** in the roadmap if needed to keep the priority order clean

Why: Implementation plans become stale fast. Once the feature is in the code, the plan is
misleading — details change during implementation and the plan won't reflect reality.

### 3. When discussing what to build next

- Reference the roadmap order (highest number = highest priority)
- If an implementation plan exists, summarize its approach
- If no plan exists, offer to create one
- Consider dependencies between features (e.g., #7 Speed Trainer depends on #1 Playing Evaluation)

### 4. When creating a new plan

- Create it as `plans/<FEATURE_NAME>_PLAN.md`
- Add a `[PLAN]` tag to the corresponding roadmap entry
- Link the plan file from the roadmap entry
- Include an **Implementation Progress** table at the top (see rule 6)

### 5. When reprioritizing

- Update the numbered order in `plans/FEATURE_ROADMAP.md`
- Explain the reasoning to the user

### 6. Track implementation progress across sessions

Implementation plans with phases MUST have an **Implementation Progress** section at the top of the plan file. This section tracks what's done and what's pending so work can be resumed across sessions.

**Format:**

```markdown
## Implementation Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 — Name | Done | Completed 2026-05-11 |
| Phase 2 — Name | In progress | onset.rs done, tuning pending |
| Phase 3 — Name | Not started | |

**Partial work / known issues:**
- onset.rs: threshold multiplier needs tuning for bass guitar
- timing.rs: stub exists but alignment logic not implemented yet
```

**Rules for updating progress:**
- When you **start** a phase: set status to "In progress" with a brief note
- When you **complete** a phase: set status to "Done" with the date
- When you **leave work partially done** (session ending, switching tasks, blocked): update the "Partial work / known issues" section with exactly what's done, what's not, and any decisions made during implementation that differ from the plan
- When **resuming work**: read the progress table FIRST to know where to pick up. Do NOT re-read the entire plan unless you need architectural context — the progress section tells you what's next
- If implementation **diverges from the plan** (different approach, skipped step, added step): update both the progress table AND the relevant phase description so the plan stays accurate

**Why this matters:** Without progress tracking, a new session has no idea what was built vs what's still planned. The plan file becomes the single source of truth for both design AND status.

### 7. When a session ends with work in progress

If the user is ending a session (says goodbye, switches topics, etc.) and there is implementation work in progress:
1. Update the progress table in the plan file
2. Document any partial work or deviations in the "Partial work / known issues" section
3. Briefly tell the user what's done and what's next so they can resume later
