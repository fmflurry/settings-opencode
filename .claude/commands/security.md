---
description: Run comprehensive security review
agent: security-reviewer
---

# Security Review Command

Conduct a comprehensive security review: $ARGUMENTS

## Your Task

Analyze the specified code for security vulnerabilities following OWASP guidelines and security best practices.

## Security Checklist

### OWASP Top 10

1. **Injection** (SQL, NoSQL, OS command, LDAP)
   - Check for parameterized queries
   - Verify input sanitization
   - Review dynamic query construction

2. **Broken Authentication**
   - Password storage (bcrypt, argon2)
   - Session management
   - Multi-factor authentication
   - Password reset flows

3. **Sensitive Data Exposure**
   - Encryption at rest and in transit
   - Proper key management
   - PII handling

4. **XML External Entities (XXE)**
   - Disable DTD processing
   - Input validation for XML

5. **Broken Access Control**
   - Authorization checks on every endpoint
   - Role-based access control
   - Resource ownership validation

6. **Security Misconfiguration**
   - Default credentials removed
   - Error handling doesn't leak info
   - Security headers configured

7. **Cross-Site Scripting (XSS)**
   - Output encoding
   - Content Security Policy
   - Input sanitization

8. **Insecure Deserialization**
   - Validate serialized data
   - Implement integrity checks

9. **Using Components with Known Vulnerabilities**
   - Run `npm audit`
   - Check for outdated dependencies

10. **Insufficient Logging & Monitoring**
    - Security events logged
    - No sensitive data in logs
    - Alerting configured

### Additional Checks

- [ ] Secrets in code (API keys, passwords)
- [ ] Environment variable handling
- [ ] CORS configuration
- [ ] Rate limiting
- [ ] CSRF protection
- [ ] Secure cookie flags

## Report Format

Finding tags are defined in the code-reviewer agent.

### Important
[Issues that block release]

### Recommendations
[Nits: security improvements that do not block]

---

An Important security finding blocks. Do not proceed until it is resolved.
