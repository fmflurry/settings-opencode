---
description: Create implementation plan with risk assessment
---

# Plan Command

> CC: delegate this to the `planner` subagent via the Agent tool (subagent_type: `planner`). The subagent inspects the repo and runs the steps below.

Create a detailed implementation plan for: $ARGUMENTS

## Your Task

1. **Restate Requirements** - Clarify what needs to be built
2. **Identify Risks** - Surface potential issues, blockers, and dependencies
3. **Create Step Plan** - Break down implementation into phases
4. **Wait for Confirmation** - MUST receive user approval before proceeding

## Output Format

### Requirements Restatement

[Clear, concise restatement of what will be built]

### Implementation Phases

[Phase 1: Description]

- Step 1.1
- Step 1.2
  ...

[Phase 2: Description]

- Step 2.1
- Step 2.2
  ...

### Dependencies

[List external dependencies, APIs, services needed]

### Risks

- HIGH: [Critical risks that could block implementation]
- MEDIUM: [Moderate risks to address]
- LOW: [Minor concerns]

### Estimated Complexity

[HIGH/MEDIUM/LOW with time estimates]

**WAITING FOR CONFIRMATION**: Proceed with this plan? (yes/no/modify)

---

**CRITICAL**: Do NOT write any code until the user explicitly confirms with "yes", "proceed", or similar affirmative response.
