---
name: gdpr-compliance
description: "GDPR reference & code-audit checklist with FRANCE/CNIL focus. Use when reviewing or building features that collect/process/store personal data (consent, PII, authentication, forms, cookies, cookies/trackers, data-subject rights, retention, DPIA, cross-border transfers, breach notification). Multi-source verified facts with live-source pointers for evolving areas. Read alongside gdpr-specialist agent."
---

# GDPR Compliance Reference & Code Audit Checklist
## FRANCE / CNIL-Focused Edition

This skill provides foundational GDPR knowledge, actionable CNIL compliance requirements, and a concrete code-audit checklist for auditing data-protection compliance in French companies. Reference this alongside the `gdpr-specialist` agent when reviewing code or building data-processing features.

**Jurisdiction:** France (EU member state); primary authority = **CNIL** (Commission Nationale de l'Informatique et des Libertés). Supplementary French law: Loi n°2018-493 (Code de la Protection des Données Personnelles); French Penal Code (Art. 226-16 to 226-24).

**Legal Disclaimer:** This is informational guidance, not legal advice. For jurisdiction-specific requirements or contested interpretations, consult a DPO, legal counsel, or **CNIL** (Phone: +33 1 53 73 22 22; Web: https://www.cnil.fr/).

---

## 1. Applicability

**GDPR applies to:**
- Any organization (any size, any industry) established in France/EU OR targeting EU residents
- Processing of both computerized AND paper data
- Any personal data (Art. 4(1)): any information relating to an identified or identifiable natural person

**French Supplementary Law:**
- Loi Informatique et Libertés (Art. 82 onwards): cookie/tracker consent rules (stricter than GDPR baseline)
- French Penal Code (Art. 226-16 to 226-24): criminal penalties for unauthorized processing, failure to inform, misuse of personal data

---

## 2. Six Core GDPR Principles (Art. 5) + Accountability (Art. 5(2))

| Principle | Requirement | Code Implication | Citation |
|-----------|-------------|------------------|----------|
| **Lawfulness (Art. 5(1)(a))** | One of 6 legal bases required (Art. 6) | Document which basis applies to each processing; enforce authorization checks in code | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |
| **Fairness (Art. 5(1)(a))** | Processing not deceptive/discriminatory | Audit ML models for bias; transparent data use | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |
| **Transparency (Art. 5(1)(a))** | Inform data subjects of collection, purpose, rights | Implement privacy notices, consent dialogs, data-subject-rights endpoints | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |
| **Purpose Limitation (Art. 5(1)(b))** | Data used only for stated purpose; repurposing needs fresh legal basis | Enforce audit logging; segregate use-case logic; don't share data across purposes without reconsent | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |
| **Data Minimization (Art. 5(1)(c))** | Collect only strictly necessary data | Remove unused fields; set default to minimal; challenge every PII field added | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |
| **Accuracy (Art. 5(1)(d))** | Keep data accurate & up-to-date | Provide rectification endpoint (PATCH /api/subject/data/{field}); flag stale data for user review | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |
| **Storage Limitation (Art. 5(1)(e))** | Define retention periods upfront; delete when objective met | Implement TTL/retention schema in database; automated deletion jobs; cleanup migrations | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |
| **Integrity & Confidentiality (Art. 5(1)(f))** | Proportional technical + organizational security measures | Encryption (TLS, at-rest), access control, logging, incident response, staff training | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |
| **Accountability (Art. 5(2))** | **Demonstrate compliance** with all principles above | Maintain Register of Processing Activities (RoPA); conduct DPIAs; document legal bases; keep audit trails (code-enforceable via logging, retention schema comments, consent records) | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr) |

---

## 3. Six Legal Bases (Art. 6) — Pick One Per Processing

[gdpr-info.eu/art-6-gdpr](https://gdpr-info.eu/art-6-gdpr) — Full legal bases reference.

| Legal Basis | When to Use | Code Example | Consent Needed? | Notes |
|---|---|---|---|---|
| **Consent (Art. 6(1)(a))** | User explicitly opts in for a purpose | Marketing emails, non-essential cookies, secondary data use | YES — must be freely given, informed, unambiguous | Must be explicit affirmative action; inaction/scrolling is NOT consent |
| **Contract (Art. 6(1)(b))** | Processing necessary to perform a contract | User email for order fulfillment, payment processing, account management | NO (if truly necessary for contract performance) | Must be objectively necessary, not just convenient |
| **Legal Obligation (Art. 6(1)(c))** | Law requires processing | Tax records (7 years), payroll (per employment law), anti-money-laundering checks | NO | Document the legal requirement (Art. reference, law name) |
| **Vital Interest (Art. 6(1)(d))** | Protect someone's life or physical safety | Emergency contact during health crisis, lifeguard rescue coordination | NO (but rare in commercial context) | Narrowest basis; only when life/safety at immediate risk |
| **Public Task (Art. 6(1)(e))** | Government/public authority processing | Census, public health records | NO (if you are a public body) | Not applicable to private commercial entities |
| **Legitimate Interest (Art. 6(1)(f))** | Balancing test: your interest vs. subject's rights (only if contract/consent/obligation don't apply) | Fraud detection, direct marketing (with objection right), internal analytics, server security logs | Objection right required; may need consent in some cases (see EDPB 1/2024) | **Most legally contested basis.** Mandatory: document balancing test (LIA) showing (1) legitimate interest, (2) necessity, (3) balancing = your interest does not override data subject's rights/freedoms. [EDPB Guidelines 1/2024](https://edpb.ec.europa.eu/our-work-tools/our-documents_en) |

---

## 4. Sensitive Categories — Enhanced Protection (Art. 9)

[gdpr-info.eu/art-9-gdpr](https://gdpr-info.eu/art-9-gdpr)

**General Rule:** Processing forbidden unless one of the exceptions applies.

| Category | Examples | Exceptions | Code Safeguards |
|---|---|---|---|
| **Racial/ethnic origin** | Nationality, ancestry records | Explicit consent; legal claim; vital interest | ✓ Tag as sensitive; encrypt at rest; log access |
| **Political beliefs** | Party affiliation, voting record, political donation | Explicit consent; member organizations | ✓ Tag as sensitive; no automatic processing |
| **Religious/philosophical beliefs** | Religion, atheism, philosophy conviction | Explicit consent; member organizations | ✓ Tag as sensitive; restricted access |
| **Union membership** | Employee union status, dues | Explicit consent; employment purposes (limited) | ✓ Tag as sensitive; no share without consent |
| **Sexual orientation** | Sexual preference, LGBTQ+ status | Explicit consent; vital interest | ✓ Tag as sensitive; never infer from behavior |
| **Genetic data** | DNA profiles, ancestry test results | Explicit consent; medical/research (special rules) | ✓ Encrypt; access logs; separate storage |
| **Biometric data** (for ID) | Fingerprints, iris scans, face recognition | Explicit consent; law enforcement; medical; art. 9(2)(h) exceptions | ✓ Encrypt; strict access control; purge after use |
| **Health data** | Medical records, prescriptions, diagnoses, vaccines, mental health | Explicit consent; medical provider; occupational health; legal obligation; vital interest | ✓ Encrypt at rest; access logs; separate schema; purge after retention |

**Code implications:**
- Tag sensitive-category columns in schema (comment: `-- SENSITIVE: Art. 9 data, requires explicit consent`)
- Encrypt all Art. 9 data at rest (pgcrypto, field-level, or transparent DB encryption)
- Restrict access via role-based control; log all reads
- Never share with 3rd parties without fresh explicit consent
- Document consent record (when consented, what for, can be revoked)
- Implement immediate deletion on withdrawal or consent expiry

---

## 5. Consent — The Gold Standard (Art. 7, Recital 32) + CNIL Cookie Rules

[gdpr-info.eu/art-7-gdpr](https://gdpr-info.eu/art-7-gdpr) — GDPR consent rules.

### Consent Requirements (MUST meet ALL)

| Requirement | Details | Code Checklist |
|---|---|---|
| **Free** | No coercion; withdrawal as easy as granting; no conditional access to non-essential processing | ✓ Unchecked-by-default checkbox; one-click unsubscribe link; no paywall for withdrawing consent |
| **Informed** | User knows: controller identity, purposes, data types, rights, transfer risks, withdrawal mechanism, how long kept | ✓ Privacy notice at collection; clear checkbox label; link to policy visible before consent |
| **Specific** | Per purpose (e.g., separate consent for marketing vs. analytics vs. cookies) | ✓ Separate checkboxes per purpose; document in consent DB |
| **Unambiguous** | Deliberate action (not silence/inaction); clear affirmative act | ✓ Checked checkbox + button click; NOT pre-checked; NOT implied by scroll or continued browsing |

### Consent Prohibitions (MUST AVOID)

- **❌ Pre-checked boxes** → Invalid consent; potential fine up to €7,500 (business)
- **❌ Silence/inaction** → Scrolling past ≠ consent; continued browsing ≠ consent
- **❌ Bundled consent** → "Accept all to continue" without granular choice → Invalid
- **❌ Forced consent** → Conditioning service access on non-essential consent → Invalid
- **❌ Unequal ease of refusal** → If refusing requires more clicks than accepting → Invalid (CNIL rule)

### CNIL Cookies & Trackers (Art. 82 Loi Informatique et Libertés; CNIL Recommendation 2026-01)

**Live source:** [CNIL Consolidated Recommendation on Cookies (2026-01)](https://www.cnil.fr/sites/default/files/2026-01/recommandation_cookies_consolidee.pdf) | [CNIL Cookies FAQ](https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/FAQ)

**Core Rules:**

1. **Consent BEFORE any tracker read/write** [CJEU Planet49 C-673/17; CNIL recommendation]
   - Consent = clear affirmative act (pre-ticked boxes prohibited; checkboxes UNCHECKED and sliders OFF by default)
   - Inaction, scrolling, or continued browsing = REFUSAL (not consent)
   - Controller must be able to PROVE valid consent at any time (consent proof obligation)

2. **Refusal must be as EASY as acceptance** [CNIL safe-harbor recommendation]
   - Both buttons on SAME screen; same visual prominence; same format
   - Recommended modality: "Tout accepter" button paired with "Tout refuser" button (equal visual weight)
   - Rejecting all trackers CANNOT require more clicks than accepting all
   - **Violation:** Accept-all = 1 click, Reject-all = 5 clicks → NON-COMPLIANT

3. **Retaining user choice for ~6 MONTHS** [CNIL good practice; case-by-case adaptable]
   - Store both consent AND refusal decisions for ~6 months before re-prompting
   - Document the retention rationale (avoid consent fatigue while maintaining fresh consent)
   - **⚠️ Verify current CNIL guidance:** https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/FAQ (may evolve)

4. **Exempt trackers (no consent required)** [CNIL clarification]
   - Session/authentication cookies (necessary for the service to function)
   - Load-balancing cookies
   - Audience-measurement under CNIL-compliant conditions (anonymized, aggregated, no ID linking)
   - Document exemption reason in consent banner

5. **Live enforcement** (2025 trend)
   - Shein: €150M fine (cookie consent violations)
   - Google: €325M fine (cookie/tracker violations)
   - CNIL actively polices; fines increasing

### Consent Withdrawal (Art. 7(3))

- User can withdraw "as easily as giving" consent (same method, typically one click)
- Withdrawal takes effect immediately (new processing stops; prior processing stays valid)
- Implement unsubscribe link, account preference toggle, cookie retraction UI

### Code Example

```javascript
// BAD: Pre-checked, bundled consent (GDPR + CNIL violation)
<input type="checkbox" name="marketing" checked /> Subscribe to marketing
<input type="checkbox" name="analytics" checked /> Allow analytics
<button>Agree & Continue</button>

// GOOD: Unchecked, granular, transparent, equal-ease rejection (GDPR + CNIL compliant)
<div class="consent-banner">
  <h2>Privacy & Consent</h2>
  <p>
    We use your email to send order confirmations and service updates
    (necessary for our contract). You can opt in to additional processing:
  </p>
  
  <div class="consent-options">
    <label>
      <input type="checkbox" name="marketing" /> 
      Yes, send me marketing emails
    </label>
    <label>
      <input type="checkbox" name="analytics" /> 
      Yes, analyze my behavior to improve service
    </label>
  </div>
  
  <p style="font-size: 0.9em;">
    <a href="/privacy-policy">View our privacy policy</a> | 
    <a href="/data-subject-rights">Manage your preferences anytime</a>
  </p>
  
  <!-- EQUAL EASE: both buttons same visual weight -->
  <div style="display: flex; gap: 1em;">
    <button name="reject-all" type="button">Reject All</button>
    <button name="accept-all" type="button" style="font-weight: bold;">Accept Selected</button>
  </div>
</div>

<!-- PROOF: Store consent choice in DB with timestamp for audit -->
const consentRecord = {
  userId: user.id,
  choices: { marketing: false, analytics: true },
  timestamp: new Date(),
  ipAddress: req.ip,
  userAgent: req.get('User-Agent')
};
// Auditable: CNIL can ask "prove this user consented on [date]"
```

---

## 6. Data-Subject Rights (Art. 15-22) — Implement Endpoints

[gdpr-info.eu/art-12-gdpr](https://gdpr-info.eu/art-12-gdpr) — Timeline & modalities.

**Timeline:** Respond within **1 MONTH** of receipt; extendable by **2 further MONTHS** for complexity or volume, BUT must inform the data subject of the extension + reasons within the initial 1 month. [Art. 12(3)]

| Right | What They Get | Code Implementation | Timeline |
|---|---|---|---|
| **Access (Art. 15)** | Copy of their data; structured, machine-readable format (CSV/JSON/XML); logic/consequences of automated decisions | `GET /api/v1/subject/data` → JSON export; includes profile, activity logs, inferred categories/scores; no derived data (profiling) unless necessary | 1 month (extendable +2) |
| **Rectification (Art. 16)** | Correct inaccurate/incomplete data | `PATCH /api/v1/subject/data/{field}` → update name, email, address; audit log the change; notify 3rd parties if shared | 1 month |
| **Erasure/"Right to be Forgotten" (Art. 17)** | Delete when: no longer needed, consent withdrawn, unlawful processing, legal obligation, child's data | `DELETE /api/v1/subject/data` → soft-delete + archive for retention period; anonymize logs; hard-delete after retention expires | 1 month |
| **Portability (Art. 20)** | Data in **structured, commonly-used, machine-readable format** (CSV/JSON/XML); **automated processing only** (not derived/inferred); **direct controller-to-controller transfer where technically feasible** | `GET /api/v1/subject/export` → include all user-declared data + activity-generated data; exclude derived profiling; support direct transfer API if recipient available | 1 month |
| **Objection (Art. 21)** | Opt-out of legitimate-interest processing (solicitation, profiling, direct marketing); can withdraw consent to entire processing | `POST /api/v1/subject/object` → unchecked opt-in checkbox on profile; flag in DB; stop processing; notify 3rd parties | 1 month |
| **Restrict Processing (Art. 18)** | Mark data "restricted" — no processing except storage/legal claims while accuracy/lawfulness disputed | `POST /api/v1/subject/restrict` → flag in DB; stop automated processing; resume on resolution | 1 month |
| **Complain to Authority** | Right to lodge complaint with CNIL (France) | Post CNIL contact info prominently in privacy policy: https://www.cnil.fr/ | N/A |

**Code Checklist:**
- [ ] `/api/subject/access` endpoint authenticated, rate-limited; returns CSV/JSON export of all their data (profile + logs + inferences)
- [ ] `/api/subject/rectify/{field}` allows updating profile fields; logs change with timestamp + user ID
- [ ] `/api/subject/delete` removes PII; anonymizes activity logs; soft-delete records; purges after retention period
- [ ] `/api/subject/export` exports in portable format (JSON/CSV); structured, machine-readable; no paywalls
- [ ] `/api/subject/object` opts out of legitimate-interest processing; flags in consent DB; stops processing
- [ ] All endpoints authenticated (no info disclosure) & rate-limited (prevent abuse)
- [ ] Requests logged (who asked, when, result, whether granted/denied)
- [ ] Responses within 1 month; deny manifestly abusive requests (same user repeatedly); document reasons for delay

---

## 7. Transparency & Privacy Notice (Art. 14)

[gdpr-info.eu/art-14-gdpr](https://gdpr-info.eu/art-14-gdpr)

**Required at Direct Collection:**
- Controller identity (company name, address, phone, email)
- DPO contact (if applicable)
- Purpose of processing (what you'll do with the data)
- Legal basis (Art. 6 choice: consent, contract, legal obligation, etc.)
- Compulsory vs. optional fields + consequences
- Recipients (internal teams, processors, 3rd parties)
- Retention period (how long you keep it)
- Data-subject rights (access, delete, portability, object)
- Right to lodge complaint with CNIL
- Existence of non-EU transfers (and safeguards)

**Requirements:**
- Concise, transparent, understandable language (no jargon, no legalese)
- Clearly titled ("Privacy Policy" or "Data Collection Notice")
- Easily accessible (prominent link on website)

---

## 8. Register of Processing Activities (ROPA) (Art. 30)

[gdpr-info.eu/art-30-gdpr](https://gdpr-info.eu/art-30-gdpr)

**Who Must Keep:**
- Companies <250 employees: only if processing is non-occasional (payroll, customer management) OR risky (geolocation, video surveillance) OR involves sensitive/criminal data
- Companies ≥250 employees: always mandatory
- All processors must keep one too

**Keep a `ROPA.md` or `ropa.json` in your repo documenting each processing activity:**

```json
{
  "processing_activities": [
    {
      "name": "Customer CRM",
      "legal_basis": "Contract (Art. 6(1)(b))",
      "data_categories": ["name", "email", "phone", "company"],
      "data_subject_categories": ["customers", "prospects"],
      "purposes": ["order fulfillment", "customer service"],
      "retention": "3 years after last order",
      "security_measures": "TLS in-transit; AES-256 at-rest; access logs; MFA on admin console",
      "recipients": ["internal sales team", "payment processor (Stripe — DPA signed 2025-01-15)"],
      "non_eu_transfers": "Stripe (US) — SCCs in place (v2021-03); supplementary measures: encryption; legal analysis: https://stripe.com/docs/security/legal"
    }
  ]
}
```

---

## 9. Data Protection Officer (DPO) Appointment (Art. 37)

[gdpr-info.eu/art-37-gdpr](https://gdpr-info.eu/art-37-gdpr)

**Mandatory when:**
1. Regular & systematic **large-scale** monitoring (geolocation, video surveillance, behavioral profiling)
2. Large-scale processing of **sensitive/criminal data** (health, biometric, genetic, criminal records)

**Options:**
- Internal DPO (full-time or part-time employee)
- External DPO (consultant, law firm, DPO service)
- CNIL certification available (voluntary; adds credibility)

**Notify CNIL:** If you appoint a DPO, submit notification via https://www.cnil.fr/

---

## 10. Data Security & Technical Measures (Art. 32 + CNIL Guidance)

[gdpr-info.eu/art-32-gdpr](https://gdpr-info.eu/art-32-gdpr) — GDPR security framework.

**CNIL Security Guide (2024):** [Guide de la Sécurité des Données Personnelles](https://www.cnil.fr/sites/cnil/files/2024-03/cnil_guide_securite_personnelle_2024.pdf)

### Password Entropy Tiers (CNIL 2024 Recommendation)

[Source: CNIL 2024 Security Guide](https://www.cnil.fr/sites/cnil/files/2024-03/cnil_guide_securite_personnelle_2024.pdf)

| Tier | Entropy Requirement | Examples | Additional Measures | Use Case |
|------|---|---|---|---|
| **HIGH** | ≥80 bits | 12 chars (upper/lower/digit/special) OR 14 chars (upper/lower/digit) | No additional required | Standard authentication (passwords) |
| **MEDIUM** | ≥50 bits | 8 chars (3+ character types) OR 16 digits | Access temporisation; CAPTCHA; account block after 10 failed attempts | Admin accounts; sensitive functions |
| **LOW** | ≥13 bits | 4-digit PIN | Lockout after 3 failed attempts; hardware-bound (SIM, certificate) | User-held hardware only (phone PIN, card PIN) |

**Code Example:**
```javascript
// Validate password entropy at registration
const validatePassword = (password) => {
  // HIGH: 12+ chars with complexity
  if (password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[!@#$%^&*]/.test(password)) {
    return { valid: true, tier: 'HIGH' };
  }
  // MEDIUM: 8+ chars with 3 types
  if (password.length >= 8 && [/[A-Z]/.test(password), /[a-z]/.test(password), /\d/.test(password)].filter(Boolean).length >= 3) {
    return { valid: true, tier: 'MEDIUM', requires_temporisation: true };
  }
  return { valid: false };
};

// Hash with bcrypt (PBKDF2, Argon2 also acceptable)
const hashed = await bcrypt.hash(password, 12); // cost factor 12
```

### Core Technical Measures

| Control | Requirement | Code Checklist |
|---|---|---|
| **Authentication** | Unique per-user ID; no shared accounts; strong passwords per entropy tier | ✓ bcrypt/Argon2 hashing; JWT expiry; MFA optional (TOTP/SMS) |
| **Authorization** | Role-based access; least-privilege principle | ✓ Role checks on every endpoint; user cannot access other users' data |
| **Access Control** | IMMEDIATE removal on role change/exit; annual reviews | ✓ Audit log all access; disable account on termination; script to enforce |
| **Session Management** | Auto-lock timeout; secure cookies (HttpOnly, Secure, SameSite) | ✓ 15-min idle timeout; HttpOnly + Secure flags set |
| **Logging** | User activity, interventions, anomalies, security events; IMMEDIATE incident notification | ✓ Log all writes; log failed auth attempts (NO passwords); anomaly alert (10+ failed logins) |
| **Encryption in Transit** | TLS 1.2+ enforced; no unencrypted HTTP | ✓ HTTPS enforced; HSTS header set; no mixed content |
| **Encryption at Rest** | Sensitive data (PII, health, payment) encrypted | ✓ pgcrypto for PostgreSQL; field-level encryption for medical data; encrypted backups |

### CNIL Logging/Journalisation (Recommendation)

[CNIL Logging Recommendation](https://www.cnil.fr/sites/cnil/files/atoms/files/recommandation_-_journalisation.pdf)

**Mandatory Logging:**
- Access to personal-data processing (read, create, modify, delete)
- Log entries include: user identifier, timestamp, equipment ID, action (CREATE/UPDATE/DELETE)

**Retention:**
- Standard operational logs: 6 MONTHS to 1 YEAR (CNIL typical)
- Internal-control audit logs: up to ~3 YEARS (case-by-case)
- **⚠️ Verify retention with CNIL** (https://www.cnil.fr/fr/la-cnil-publie-une-recommandation-relative-aux-mesures-de-journalisation) — retention periods may vary by use case

**Risk Mitigation:**
- Long-term log retention itself creates a risk (illegitimate access to logs)
- Implement access control on logs (role-based; audit log access to logs)
- Provide anomaly-detection analysis for short-term exploitation/incident detection

---

## 11. Processor / Subcontractor Contracts (Art. 28)

[gdpr-info.eu/art-28-gdpr](https://gdpr-info.eu/art-28-gdpr)

**Who is a Processor?**
- Cloud provider (AWS, Azure, GCP)
- Payment processor (Stripe, PayPal)
- Analytics vendor (Google Analytics, Mixpanel)
- Email service (SendGrid, Mailchimp)
- CRM (Salesforce, HubSpot)

**Contract Requirements:**
- Written Data Processing Agreement (DPA)
- Define: purpose, nature, duration, data categories, subject categories
- Processor obligated to: act only on instructions, ensure adequate security, advise if law violated, assist with data-subject rights

**Code Checklist:**
- [ ] DPA signed with every vendor handling PII
- [ ] DPA includes: data categories, purposes, retention, security, sub-processor rules
- [ ] Processor audit rights in DPA (right to inspect security measures)
- [ ] Processor breach notification requirement (immediate notification if incident)
- [ ] Maintain a list of all processors/vendors → show in privacy policy

---

## 12. DPIA (Data Protection Impact Assessment) (Art. 35 + CNIL Lists)

[gdpr-info.eu/art-35-gdpr](https://gdpr-info.eu/art-35-gdpr)

**CNIL DPIA Requirements:**

CNIL has published **two lists**:
1. **Mandatory DPIA list** — 14 processing types where DPIA is ALWAYS required
2. **Exempt list** — 12 processing types where DPIA is NOT required

**⚠️ Consult primary sources:**
- [CNIL: List of mandatory DPIA processing types](https://www.cnil.fr/fr/liste-traitements-aipd-requise)
- [CNIL: List of exempt DPIA processing types](https://www.cnil.fr/fr/liste-traitements-aipd-non-requise)

**CNIL also provides a free DPIA tool:**
- [CNIL PIA Software](https://www.cnil.fr/fr/RGPD-analyse-impact-protection-des-donnees-aipd) — for conducting DPIAs

**When Mandatory (if not in CNIL exempt list):**
- Automated scoring/profiling
- Automated decisions with legal/financial effect
- Systematic surveillance
- Processing sensitive data (Art. 9) at large scale
- Innovative technology or new data processing method

**DPIA Contents:**
1. Describe operations & purposes
2. Assess necessity & proportionality
3. Identify risks (confidentiality, integrity, availability, discrimination)
4. Describe mitigation measures
5. Consult CNIL if residual risk is HIGH

---

## 13. International Transfers (Non-EU/EEA) (Art. 44-49 + EDPB Guidance)

[gdpr-info.eu/art-44-gdpr](https://gdpr-info.eu/art-44-gdpr) — Transfers framework.

⚠️ **AREA NOT FULLY VERIFIED — VERIFY LIVE BEFORE RELYING:**

**Current Status (as of July 2023):**
- **EU-US Data Privacy Framework (DPF):** Adequacy decision adopted July 2023 (replaces invalidated Privacy Shield after Schrems II, July 2020)
- **Status can change:** CJEU may invalidate DPF as it did Privacy Shield. Verify current validity before relying: https://ec.europa.eu/info/law/law-topic/data-protection/international-dimension-data-protection/eu-us-data-flows_en

**Options for Non-Adequate Countries:**

1. **Adequacy Decision** (no extra safeguards) — EU deemed country adequate
2. **Standard Contractual Clauses (SCCs)** (2021-03 version) — EU-approved template [Art. 46(2)(c)]
   - Required: Transfer Impact Assessment (TIA) + supplementary measures if recipient country law overrides SCC protections
3. **Binding Corporate Rules (BCRs)** — for multinational groups only
4. **Derogations** (limited, case-by-case) — explicit consent + risk warning; contract necessity; vital interests

**Code Checklist:**
- [ ] Map all data flows: which data? to which country?
- [ ] For EU-adequate countries (UK, Japan, S. Korea, Argentina): no action needed
- [ ] For other countries: SCC in place + Transfer Impact Assessment documented
- [ ] For US cloud (AWS, Azure, GCP): DPF OR SCC in place; supplementary measures (encryption) recommended
- [ ] For China, Russia, high-risk: only allowed with explicit consent + risk warning
- [ ] Include transfer info in privacy notice & ROPA

---

## 14. Data Breach Notification (Art. 33-34 + EDPB Guidelines 09/2022)

[gdpr-info.eu/art-33-gdpr](https://gdpr-info.eu/art-33-gdpr) | [EDPB Guidelines 09/2022 v2.0 on Personal Data Breach Notification](https://edpb.ec.europa.eu/our-work-tools/our-documents_en)

**Definition:** Breach = unauthorized disclosure, irregular access, loss, or modification affecting confidentiality/integrity/availability. [Art. 33(1)]

### Notification Timeline

**AUTHORITY NOTIFICATION (Art. 33(1)):**
- Notify **CNIL** (France's supervisory authority) **without undue delay and, where feasible, not later than 72 HOURS** after the controller becomes aware
- **Exception:** If breach is unlikely to result in a risk to rights/freedoms, notification NOT required
- **If notifying AFTER 72h:** Must state reasons for the delay
- **"Aware"** = reasonable degree of certainty a security incident occurred leading to personal data compromise. Short investigation before certainty is allowed, but wilful blindness/no detection measures cannot defer awareness. [EDPB Guidelines 09/2022]

**DATA SUBJECT NOTIFICATION (Art. 34(1)):**
- Communicate to affected **data subjects** without undue delay **ONLY IF breach likely = HIGH RISK** (higher threshold than authority notification)
- **HIGH RISK** examples: financial loss, identity theft, discrimination, loss of control, reputational harm, physical harm
- **Exemptions (Art. 34(3)):** 
  - Data encrypted/unintelligible (cannot be read by unauthorized party)
  - Mitigating measures taken that reduce risk
  - Disproportionate effort (then CNIL may compel public communication instead, Art. 34(4))

### Notification Content (Art. 33(3))

Minimum required in CNIL notification:
- (a) **Nature of breach** incl. categories of data subjects + approximate number of subjects/records affected
- (b) **DPO/contact point** name + contact info
- (c) **Likely consequences**
- (d) **Measures taken/proposed** to mitigate

### Runbook / Checklist

```markdown
## Breach Incident Response

**Phase 1: Detect & Contain** (hours 0-4)
- [ ] Intrusion Detection System (IDS) / monitoring alerts
- [ ] Immediate containment (isolate affected system; block unauthorized access)
- [ ] Preserve evidence (logs, forensics)

**Phase 2: Investigate** (hours 4-48)
- [ ] Determine what happened (data exfiltration? unauthorized access? loss?)
- [ ] Determine which data categories affected
- [ ] Estimate number of data subjects affected
- [ ] Root cause analysis
- [ ] Risk assessment (is there HIGH risk to subjects?)

**Phase 3: Notify CNIL** (within 72 hours of awareness)
- [ ] If HIGH RISK → prepare CNIL notification
- [ ] Include: (a) nature + categories, (b) DPO contact, (c) consequences, (d) mitigation measures
- [ ] Submit via https://www.cnil.fr/ (online form for incident reporting)
- [ ] If breaching 72h deadline → document reasons for delay

**Phase 4: Notify Data Subjects** (within 72h if HIGH RISK)
- [ ] If risk is HIGH → send email/SMS to all affected subjects
- [ ] Include: what happened, which data affected, mitigation measures, subjects' rights
- [ ] Keep proof of notification (timestamp, recipient list)

**Phase 5: Post-Incident** (days 3-30)
- [ ] Root cause remediation
- [ ] Security patch deployment
- [ ] Breach registry entry (for audit trail & future CNIL requests)
- [ ] Communication to stakeholders (legal, exec, insurance)
```

---

## 15. Data Retention Durations (CNIL Guidance + French Law)

[CNIL: Les Durées de Conservation des Données](https://www.cnil.fr/fr/les-durees-de-conservation-des-donnees)

| Data Category | Retention Duration | Source / Notes |
|---|---|---|
| **Payroll / Bulletins de Paie** | 5 years | French Code du Travail, Art. L3243-4 |
| **Accounting / Invoices** | 10 years | French Code de Commerce (NOT 6 years — common error) |
| **Tax Records** | 3 years (standard); up to 6 years (complex cases) | French tax authority guidance |
| **Unsuccessful Candidate CVs** | 2 years max in active base; delete on request | CNIL employment referentiel; GDPR Art. 17 |
| **Prospect Data (prospection)** | 3 years from last contact | CNIL commercial referentiel; ⚠️ verify against: [CNIL Commercial Activities Referentiel](https://www.cnil.fr/sites/cnil/files/atoms/files/referentiel_traitements-donnees-caractere-personnel_gestion-activites-commerciales.pdf) |
| **Customer Data (order history)** | 3 years after last order | CNIL commerce guidance (varies by contract terms) |
| **Employee Data (HR)** | 3 years after employment end | CNIL HR referentiel; ⚠️ verify: [CNIL HR Retention Referentiel](https://www.cnil.fr/sites/default/files/2026-04/referentiel_durees_de_conservation_gestion_des_ressources_humaines.pdf) |
| **Access Logs (security)** | 6 months to 1 year (operational); 3 years (audit) | CNIL logging recommendation |
| **Marketing Opt-in Records** | 3 years from consent | CNIL recommendation; delete on withdrawal |
| **Health Data** | Variable by use case (medical: min 10 years; research: 50 years) | ⚠️ Consult primary: [CNIL Health Data Guidance](https://www.cnil.fr/) |

**Three-Phase Lifecycle Model:**
1. **Active Base:** Full access; processing ongoing (2-3 years typical)
2. **Intermediate Archiving:** Restricted access (role-based); slow-path queries; 1-3 years
3. **Final/Indefinite Archiving:** Historical only; no processing; delete or fully anonymize after retention period

**Code Implementation:**
```sql
-- In schema: retention policy comments
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255),
  last_order_date DATE,
  
  -- Comment: Retention = 3 years from last_order_date (CNIL commerce guidance)
  -- Soft-delete: mark inactive on 3-year anniversary; hard-delete after 30-day grace
  deleted_at TIMESTAMP,
  retention_expires_at DATE -- 3 years from last_order_date
);

-- Automated cleanup
DELETE FROM customers 
WHERE retention_expires_at < CURRENT_DATE - INTERVAL '30 days'
AND deleted_at IS NOT NULL;
```

---

## 16. Code Audit Checklist

### Frontend Layer
- [ ] **Consent Banners:** Are checkboxes unchecked by default? Separate per purpose? Not bundled? Both accept/reject visible?
- [ ] **Cookies:** Only essential cookies set before consent; non-essential behind toggle
- [ ] **Forms:** Optional fields marked; privacy notice linked; unsubscribe link prominent
- [ ] **Client Storage:** No PII in localStorage/sessionStorage/IndexedDB
- [ ] **Logging:** No API keys, passwords, emails, tokens, PII in console/analytics
- [ ] **Third-party Scripts:** Analytics/ads/trackers loaded only after consent

### Backend Layer
- [ ] **Authentication:** Unique user IDs; bcrypt/Argon2 hashed passwords; no shared accounts; MFA optional
- [ ] **Authorization:** Role-based checks on every protected endpoint; users cannot access others' data
- [ ] **Input Validation:** SQL injection prevention (parameterized queries); XSS prevention (escape output)
- [ ] **Logging:** PII NOT logged; only log user ID, action, timestamp; immediate incident alert on anomaly
- [ ] **Data-Subject Rights Endpoints:** `/api/subject/access`, `/api/subject/delete`, `/api/subject/export`, `/api/subject/object` implemented
- [ ] **Legal Basis Documentation:** Why each processing happens (consent, contract, legal obligation, etc.)
- [ ] **Rate Limiting:** Public endpoints rate-limited (prevent brute force, scraping)
- [ ] **Error Handling:** No stack traces or internal paths exposed to clients

### Database Layer
- [ ] **PII Identification:** Columns marked as sensitive (email, phone, SSN, address, birthdate, health)
- [ ] **Sensitive Categories (Art. 9):** Consent/legal basis verified for racial/ethnic, political, religious, union, sexual orientation, genetic, biometric, health data
- [ ] **Encryption at Rest:** Sensitive columns encrypted (pgcrypto, field-level, or transparent DB encryption)
- [ ] **Retention Policy:** TTL/deletion dates defined in schema comments; automated cleanup jobs running
- [ ] **Access Control:** Row-level security (RLS) for PII; role-based column access
- [ ] **Audit Logging:** Who accessed/modified PII? When? Logged with user ID, timestamp, action

### Infrastructure & Stack
- [ ] **Data Residency:** Document where data is stored geographically (EU? US? China?)
- [ ] **Cross-Border Transfers:** If non-EU: SCC/DPF documented; supplementary measures defined
- [ ] **Processor/Vendor DPAs:** Cloud provider, payment processor, analytics → DPA signed
- [ ] **Backups:** Encrypted; ≥1 offsite; ≥1 isolated/offline; retention policy enforced
- [ ] **TLS/HTTPS:** Enforced everywhere; no downgrade; HSTS header set
- [ ] **Incident Response:** Plan documented; breach registry; CNIL notification procedure
- [ ] **ROPA:** Processing activities register maintained & up-to-date
- [ ] **DPO Status:** If >250 employees or sensitive data: DPO appointed & CNIL notified

### Documentation
- [ ] **Privacy Policy:** Transparent, understandable; clear links to data-subject-rights endpoints; CNIL contact
- [ ] **Consent Records:** Trackable & auditable (when user consented, what they consented to, proof)
- [ ] **DPIA:** High-risk processing assessed; mitigation measures documented (or exemption justified via CNIL lists)
- [ ] **Legal Basis:** Each processing purpose linked to Art. 6 basis with documentation
- [ ] **Breach Incident Plan:** Response steps documented; CNIL notification procedure; evidence preservation
- [ ] **Retention Justification:** Each data category linked to CNIL referentiel or legal requirement

---

## References & Resources

### Core GDPR
- [GDPR Full Text (Regulation EU 2016/679)](https://gdpr-info.eu/)
- [EDPB Guidelines](https://edpb.ec.europa.eu/our-work-tools/our-documents_en)

### French Authority & Law
- **CNIL (Commission Nationale de l'Informatique et des Libertés)**
  - Website: https://www.cnil.fr/
  - Phone: +33 1 53 73 22 22
  - Contact form: https://www.cnil.fr/fr/contact
  - General F24270 guidance: https://entreprendre.service-public.fr/vosdroits/F24270
  
- **French Data Protection Act:** Loi n°2018-493 (Code de la Protection des Données Personnelles)
- **French Penal Code:** Art. 226-16 to 226-24 (criminal penalties)

### CNIL Recommendations & Referentiels (Live Sources)
- [CNIL Consolidated Cookies Recommendation (2026-01)](https://www.cnil.fr/sites/default/files/2026-01/recommandation_cookies_consolidee.pdf)
- [CNIL Cookies FAQ](https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/FAQ)
- [CNIL Logging Recommendation](https://www.cnil.fr/sites/cnil/files/atoms/files/recommandation_-_journalisation.pdf)
- [CNIL Security Guide (2024)](https://www.cnil.fr/sites/cnil/files/2024-03/cnil_guide_securite_personnelle_2024.pdf)
- [CNIL Data Retention Durations](https://www.cnil.fr/fr/les-durees-de-conservation-des-donnees)
- [CNIL Mandatory DPIA List](https://www.cnil.fr/fr/liste-traitements-aipd-requise)
- [CNIL Exempt DPIA List](https://www.cnil.fr/fr/liste-traitements-aipd-non-requise)
- [CNIL Commercial Activities Referentiel](https://www.cnil.fr/sites/cnil/files/atoms/files/referentiel_traitements-donnees-caractere-personnel_gestion-activites-commerciales.pdf)
- [CNIL HR Retention Referentiel](https://www.cnil.fr/sites/default/files/2026-04/referentiel_durees_de_conservation_gestion_des_ressources_humaines.pdf)
- [CNIL PIA Software Tool](https://www.cnil.fr/fr/RGPD-analyse-impact-protection-des-donnees-aipd)

### SCCs & International Transfers
- [EU Standard Contractual Clauses](https://ec.europa.eu/info/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_en)
- [EU-US Data Privacy Framework](https://ec.europa.eu/info/law/law-topic/data-protection/international-dimension-data-protection/eu-us-data-flows_en)
- [EDPB Guidelines 01/2020 on Data Transfers](https://edpb.ec.europa.eu/our-work-tools/our-documents_en)

---

## Legal Disclaimer

This skill provides informational guidance based on GDPR articles, EDPB guidelines, and CNIL interpretations. It is **NOT legal advice**. Data protection law is jurisdiction-specific, complex, and rapidly evolving. For your specific situation:

1. **Consult a DPO** (Data Protection Officer) or qualified privacy counsel
2. **Contact CNIL directly** (France): https://www.cnil.fr/ | +33 1 53 73 22 22
3. **Document your legal analysis** (risk assessment, legal basis choice, safeguards)
4. **Review & update regularly** (compliance is ongoing, not one-time)

Misinterpretation of this guidance does not limit your regulatory obligations or liability.
