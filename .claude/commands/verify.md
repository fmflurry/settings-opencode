---
description: Run verification loop to validate implementation
---

# Verify Command

> CC: no dedicated subagent — the primary agent runs these steps directly.

Run verification loop to validate the implementation: $ARGUMENTS

## Your Task

Execute comprehensive verification:

1. **Type Check**: `npx tsc --noEmit`
2. **Lint**: `npm run lint`
3. **Unit Tests**: `npm test`
4. **Integration Tests**: `npm run test:integration` (if available)
5. **Build**: `npm run build`
6. **Coverage Check**: Verify 80%+ coverage

## Verification Checklist

### Code Quality
- [ ] No TypeScript errors
- [ ] No lint warnings
- [ ] No console.log statements
- [ ] Functions < 50 lines
- [ ] Files < 800 lines

### Tests
- [ ] All tests passing
- [ ] Coverage >= 80%
- [ ] Edge cases covered
- [ ] Error conditions tested

### Security
- [ ] No hardcoded secrets
- [ ] Input validation present
- [ ] No SQL injection risks
- [ ] No XSS vulnerabilities

### Build
- [ ] Build succeeds
- [ ] No warnings
- [ ] Bundle size acceptable

## Verification Report

### Summary
- Status: PASS / FAIL
- Score: X/Y checks passed

### Details
| Check | Status | Notes |
|-------|--------|-------|
| TypeScript | pass/fail | [details] |
| Lint | pass/fail | [details] |
| Tests | pass/fail | [details] |
| Coverage | pass/fail | XX% (target: 80%) |
| Build | pass/fail | [details] |

### Action Items
[If FAIL, list what needs to be fixed]

---

**NOTE**: Verification loop should be run before every commit and PR.
