Useful commands and workflows for this project/workspace:

System/Darwin basics:
- `ls`
- `pwd`
- `git status`
- `git diff`
- `npm install`
- `npm test`
- `npx tsc --noEmit`

Project files / package info:
- `npm install` to install/update dependencies from `package.json`.
- No npm scripts are defined in root `package.json`, so many workflows are driven by OpenCode command templates rather than package scripts.

OpenCode workflow commands defined in `commands/`:
- `/git <task>`: delegate git workflow to `git-specialist`.
- `/push-changes <context>`: commit relevant changes and push safely.
- `/plan <task>`: create detailed implementation plan.
- `/tdd <task>`: enforce tests-first workflow.
- `/code-review <scope>`: review current diff/files.
- `/security <scope>`: run security-focused review.
- `/verify <scope>`: run verification loop expectations.
- `/update-docs <scope>`, `/update-codemaps <scope>`, `/refactor-clean <scope>`, `/build-fix <scope>` also exist.

Verification expectations from `commands/verify.md`:
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run test:integration`
- `npm run build`

Caveat:
- root `package.json` currently defines dependencies only, not scripts, so some verify commands are conventions/templates and may only work in target repos or after additional setup.
