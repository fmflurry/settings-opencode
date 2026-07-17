import { createHash } from "node:crypto";

export interface PersonalNotice {
  readonly article: "GDPR Article 13";
  readonly controller: string;
  readonly purpose: string;
  readonly retention: string;
  readonly version: string;
}

export interface OrganizationalNotice {
  readonly article: "GDPR Article 13";
  readonly controller: string;
  readonly controllerContact: string;
  readonly dataProvisionInformation: string;
  readonly mandatoryConsequenceInformation: string;
  readonly lawfulBasis: string;
  readonly purpose: string;
  readonly retention: string;
  readonly dpoContact: string;
  readonly recipients: string;
  readonly rightsContact: string;
  readonly transfers: string;
  readonly rights: string;
  readonly cnilComplaint: string;
  readonly processingInformation: string;
  readonly version: string;
}

export interface ApprovalEvidence {
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly decisionReference: string;
}

export interface NoticeDeliveryEvidence {
  readonly audience: string;
  readonly method: string;
  readonly deliveredAt: string;
  readonly reference: string;
}

export interface GovernanceRecord {
  readonly approvalEvidence: ApprovalEvidence;
  readonly breachPath: string;
  readonly controller: string;
  readonly controllerContact: string;
  readonly dataProvisionInformation: string;
  readonly dpiaScreening: string;
  readonly lawfulBasis: string;
  readonly mandatoryConsequenceInformation: string;
  readonly noticeDeliveryEvidence: NoticeDeliveryEvidence;
  readonly recipientsProcessorsTransfers: string;
  readonly retentionJustification: string;
  readonly ropaReference: string;
  readonly rightsContact: string;
  readonly status: "completed";
  readonly version: string;
}

export const personalNotice: PersonalNotice = {
  article: "GDPR Article 13",
  controller: "Local profile owner",
  purpose: "Proposal-only local learning",
  retention: "30-day proposal and audit retention",
  version: "2026-07-17",
};

export const organizationalNotice: OrganizationalNotice = {
  article: "GDPR Article 13",
  controller: "Example controller",
  controllerContact: "privacy@example.invalid",
  dataProvisionInformation: "Providing preference information is optional.",
  mandatoryConsequenceInformation: "No service consequence follows from declining to provide preference information.",
  lawfulBasis: "GDPR Article 6(1)(f)",
  purpose: "Proposal-only local learning",
  retention: "30-day proposal and audit retention",
  dpoContact: "dpo@example.invalid",
  recipients: "Approved local runtime processor",
  rightsContact: "privacy@example.invalid",
  transfers: "No transfers",
  rights: "access, rectification, erasure, restriction, portability, objection, withdraw consent",
  cnilComplaint: "Complain to the CNIL",
  processingInformation: "Automated preference-pattern analysis produces review proposals only; no decision is based solely on automated processing.",
  version: "2026-07-17",
};

export const organizationalGovernanceRecord: GovernanceRecord = {
  approvalEvidence: {
    approvedAt: "2026-07-17T12:00:00.000Z",
    approvedBy: "Example Privacy Committee",
    decisionReference: "EXAMPLE-PRIV-2026-07-17",
  },
  breachPath: "Detect, contain, assess, document, and notify within 72 hours where required.",
  controller: "Example controller",
  controllerContact: "privacy@example.invalid",
  dataProvisionInformation: "Providing preference information is optional.",
  dpiaScreening: "DPIA screening assesses automated preference-pattern analysis and confirms no solely automated decision-making.",
  lawfulBasis: "GDPR Article 6(1)(f)",
  mandatoryConsequenceInformation: "No service consequence follows from declining to provide preference information.",
  noticeDeliveryEvidence: {
    audience: "Affected users",
    method: "Privacy portal acknowledgement",
    deliveredAt: "2026-07-17T12:00:00.000Z",
    reference: "EXAMPLE-NOTICE-DELIVERY-2026-07-17",
  },
  recipientsProcessorsTransfers: "Approved local runtime processor; no transfers.",
  retentionJustification: "Proposal-only purpose with 30-day retention.",
  ropaReference: "ROPA-PL-001",
  rightsContact: "privacy@example.invalid",
  status: "completed",
  version: "2026-07-17",
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digest(value: object): string {
  return `sha256:${sha256(JSON.stringify(value))}`;
}

const ARTICLE_6_BASES = new Set([
  "GDPR Article 6(1)(a)",
  "GDPR Article 6(1)(b)",
  "GDPR Article 6(1)(c)",
  "GDPR Article 6(1)(d)",
  "GDPR Article 6(1)(e)",
  "GDPR Article 6(1)(f)",
]);
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const PLACEHOLDER = /\b(?:example|sample|placeholder|todo|tbd|complete|your\s+(?:organization|company|controller|name))\b|\[.+?\]|\.invalid\b/i;

function completedText(value: unknown, options: { readonly rejectPlaceholders?: boolean } = {}): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim() === value && value.length <= 1_000 && !CONTROL_CHARACTER.test(value) && (!options.rejectPlaceholders || !PLACEHOLDER.test(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asPersonalNotice(value: unknown): PersonalNotice | null {
  if (!isRecord(value) || value.article !== "GDPR Article 13" || !completedText(value.controller) || !completedText(value.purpose) || !completedText(value.retention) || typeof value.version !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.version)) return null;
  return { article: value.article, controller: value.controller, purpose: value.purpose, retention: value.retention, version: value.version };
}

export function asOrganizationalNotice(value: unknown): OrganizationalNotice | null {
  if (!isRecord(value) || !hasExactKeys(value, ["article", "controller", "controllerContact", "dataProvisionInformation", "mandatoryConsequenceInformation", "lawfulBasis", "purpose", "retention", "dpoContact", "recipients", "rightsContact", "transfers", "rights", "cnilComplaint", "processingInformation", "version"]) || value.article !== "GDPR Article 13" || !completedText(value.controller, { rejectPlaceholders: true }) || !validContact(value.controllerContact) || !validProvisionInformation(value.dataProvisionInformation) || !validConsequenceInformation(value.mandatoryConsequenceInformation) || !isArticle6Basis(value.lawfulBasis) || !completedText(value.purpose, { rejectPlaceholders: true }) || !completedText(value.retention, { rejectPlaceholders: true }) || !validContact(value.dpoContact) || !completedText(value.recipients, { rejectPlaceholders: true }) || !validContact(value.rightsContact) || !completedText(value.transfers, { rejectPlaceholders: true }) || !completedText(value.rights, { rejectPlaceholders: true }) || !completedText(value.cnilComplaint, { rejectPlaceholders: true }) || !validProcessingInformation(value.processingInformation) || typeof value.version !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.version)) return null;
  return { article: value.article, controller: value.controller, controllerContact: value.controllerContact, dataProvisionInformation: value.dataProvisionInformation, mandatoryConsequenceInformation: value.mandatoryConsequenceInformation, lawfulBasis: value.lawfulBasis, purpose: value.purpose, retention: value.retention, dpoContact: value.dpoContact, recipients: value.recipients, rightsContact: value.rightsContact, transfers: value.transfers, rights: value.rights, cnilComplaint: value.cnilComplaint, processingInformation: value.processingInformation, version: value.version };
}

export function asGovernanceRecord(value: unknown): GovernanceRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, ["approvalEvidence", "breachPath", "controller", "controllerContact", "dataProvisionInformation", "dpiaScreening", "lawfulBasis", "mandatoryConsequenceInformation", "noticeDeliveryEvidence", "recipientsProcessorsTransfers", "retentionJustification", "ropaReference", "rightsContact", "status", "version"]) || value.status !== "completed" || !validApprovalEvidence(value.approvalEvidence) || !completedText(value.breachPath, { rejectPlaceholders: true }) || !/72\s*-?\s*hour/i.test(value.breachPath) || !completedText(value.controller, { rejectPlaceholders: true }) || !validContact(value.controllerContact) || !validProvisionInformation(value.dataProvisionInformation) || !validDpiaScreening(value.dpiaScreening) || !isArticle6Basis(value.lawfulBasis) || !validConsequenceInformation(value.mandatoryConsequenceInformation) || !validNoticeDeliveryEvidence(value.noticeDeliveryEvidence) || !completedText(value.recipientsProcessorsTransfers, { rejectPlaceholders: true }) || !completedText(value.retentionJustification, { rejectPlaceholders: true }) || !completedText(value.ropaReference, { rejectPlaceholders: true }) || !validContact(value.rightsContact) || typeof value.version !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.version)) return null;
  return { approvalEvidence: value.approvalEvidence, breachPath: value.breachPath, controller: value.controller, controllerContact: value.controllerContact, dataProvisionInformation: value.dataProvisionInformation, dpiaScreening: value.dpiaScreening, lawfulBasis: value.lawfulBasis, mandatoryConsequenceInformation: value.mandatoryConsequenceInformation, noticeDeliveryEvidence: value.noticeDeliveryEvidence, recipientsProcessorsTransfers: value.recipientsProcessorsTransfers, retentionJustification: value.retentionJustification, ropaReference: value.ropaReference, rightsContact: value.rightsContact, status: value.status, version: value.version };
}

export function renderArticle13Notice(notice: PersonalNotice | OrganizationalNotice, governance?: GovernanceRecord): string {
  if (!("lawfulBasis" in notice)) return `Article 13 notice\nController: ${escapeTerminal(notice.controller)}\nPurpose: ${escapeTerminal(notice.purpose)}\nRetention: ${escapeTerminal(notice.retention)}\nVersion: ${notice.version}\nDigest: ${digest(notice)}`;
  const delivery = governance === undefined ? "" : `\nNotice delivery audience: ${escapeTerminal(governance.noticeDeliveryEvidence.audience)}\nNotice delivery method: ${escapeTerminal(governance.noticeDeliveryEvidence.method)}\nNotice delivery date: ${governance.noticeDeliveryEvidence.deliveredAt}\nNotice delivery reference: ${escapeTerminal(governance.noticeDeliveryEvidence.reference)}`;
  return `Article 13 notice\nController: ${escapeTerminal(notice.controller)}\nController contact: ${escapeTerminal(notice.controllerContact)}\nLawful basis: ${escapeTerminal(notice.lawfulBasis)}\nPurpose: ${escapeTerminal(notice.purpose)}\nRetention: ${escapeTerminal(notice.retention)}\nData provision: ${escapeTerminal(notice.dataProvisionInformation)}\nConsequences: ${escapeTerminal(notice.mandatoryConsequenceInformation)}\nDPO: ${escapeTerminal(notice.dpoContact)}\nRecipients: ${escapeTerminal(notice.recipients)}\nRights contact: ${escapeTerminal(notice.rightsContact)}\nTransfers: ${escapeTerminal(notice.transfers)}\nRights: ${escapeTerminal(notice.rights)}\nCNIL complaint: ${escapeTerminal(notice.cnilComplaint)}\nAutomated processing/profiling: ${escapeTerminal(notice.processingInformation)}${delivery}\nVersion: ${notice.version}\nDigest: ${digest(notice)}`;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isArticle6Basis(value: unknown): value is string {
  return typeof value === "string" && ARTICLE_6_BASES.has(value);
}

function validContact(value: unknown): value is string {
  return completedText(value) && !/\.invalid$/i.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validApprovalEvidence(value: unknown): value is ApprovalEvidence {
  if (!isRecord(value) || !hasExactKeys(value, ["approvedAt", "approvedBy", "decisionReference"]) || !completedText(value.approvedBy, { rejectPlaceholders: true }) || !completedText(value.decisionReference, { rejectPlaceholders: true }) || typeof value.approvedAt !== "string" || CONTROL_CHARACTER.test(value.approvedAt)) return false;
  return Number.isFinite(Date.parse(value.approvedAt)) && new Date(value.approvedAt).toISOString() === value.approvedAt;
}

function validNoticeDeliveryEvidence(value: unknown): value is NoticeDeliveryEvidence {
  if (!isRecord(value) || !hasExactKeys(value, ["audience", "method", "deliveredAt", "reference"]) || !completedText(value.audience, { rejectPlaceholders: true }) || !completedText(value.method, { rejectPlaceholders: true }) || !completedText(value.reference, { rejectPlaceholders: true }) || typeof value.deliveredAt !== "string" || CONTROL_CHARACTER.test(value.deliveredAt)) return false;
  return Number.isFinite(Date.parse(value.deliveredAt)) && new Date(value.deliveredAt).toISOString() === value.deliveredAt;
}

function validProvisionInformation(value: unknown): value is string {
  return completedText(value, { rejectPlaceholders: true }) && /\b(?:mandatory|optional)\b/i.test(value);
}

function validConsequenceInformation(value: unknown): value is string {
  return completedText(value, { rejectPlaceholders: true }) && /\bconsequence(?:s)?\b/i.test(value);
}

function validProcessingInformation(value: unknown): value is string {
  return completedText(value, { rejectPlaceholders: true }) && /\bautomated\s+preference-pattern\s+analysis\b/i.test(value) && /\bno\s+(?:decision\s+is\s+based\s+solely\s+on\s+automated\s+processing|solely\s+automated\s+decision-making)\b/i.test(value);
}

function validDpiaScreening(value: unknown): value is string {
  return completedText(value, { rejectPlaceholders: true }) && /\bDPIA\b/i.test(value) && /\bautomated\s+preference-pattern\s+analysis\b/i.test(value) && /\bsolely\s+automated\s+decision(?:-making)?\b/i.test(value);
}

function escapeTerminal(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`);
}
