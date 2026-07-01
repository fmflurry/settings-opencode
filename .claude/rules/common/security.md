# Security Guidelines

## Mandatory Security Checks

Before ANY commit:
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitized HTML)
- [ ] CSRF protection enabled
- [ ] Authentication/authorization verified
- [ ] Rate limiting on all endpoints
- [ ] Error messages don't leak sensitive data

## Secret Management

- NEVER hardcode secrets in source code
- ALWAYS use environment variables or a secret manager
- Validate that required secrets are present at startup
- Rotate any secrets that may have been exposed

## Dependency Security

- Keep all dependencies up to date: `npm audit`, `npm update`
- Commit lock files: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` — never add `node_modules` to `.gitignore` or `.gitattributes`
- Use lock files in CI/CD: prefer `npm ci` (or `yarn install --frozen-lockfile`, `pnpm install --frozen-lockfile`) over `npm install`
- Validate no vulnerabilities before commits: `npm audit` must return clean
- Enable automated dependency scanning (Dependabot) on GitHub

## Security Response Protocol

If security issue found:
1. STOP immediately
2. Use **security-reviewer** agent
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review entire codebase for similar issues
