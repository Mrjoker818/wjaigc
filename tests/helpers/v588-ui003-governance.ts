export type Ui003GovernanceDocumentName =
  | 'inventory'
  | 'regression'
  | 'release'
  | 'unverified'
  | 'progress';

export type Ui003GovernanceDocuments = Record<Ui003GovernanceDocumentName, string>;

export const UI003_GOVERNANCE_DOCUMENT_NAMES: Ui003GovernanceDocumentName[] = [
  'inventory',
  'regression',
  'release',
  'unverified',
  'progress',
];

const ui003StatusPrefix = '(?:V588-UI-003|状态|发布判定)';
const absorbedPattern = new RegExp(
  `${ui003StatusPrefix}[^\\r\\n]*(?:已吸收|完成吸收|云端(?:回归|验收|验证)?通过|ABSORBED|CLOUD VERIFIED)`,
  'iu',
);
const pendingPattern = new RegExp(
  `${ui003StatusPrefix}[^\\r\\n]*(?:本地候选通过|云端待验|尚无 Coze exact SHA)`,
  'iu',
);

export function extractUi003GovernanceSection(
  document: string,
  headingLevel: 2 | 3,
): string {
  const headingPattern = new RegExp(`^#{${headingLevel}}\\s+.*V588-UI-003.*$`, 'imu');
  const heading = headingPattern.exec(document);
  if (!heading) return '';

  const start = heading.index;
  const following = document.slice(start + heading[0].length);
  const nextHeading = following.search(new RegExp(`\\n#{1,${headingLevel}}\\s`));
  return nextHeading === -1
    ? document.slice(start)
    : document.slice(start, start + heading[0].length + nextHeading);
}

export function findUi003AbsorptionGovernanceIssues(
  documents: Ui003GovernanceDocuments,
  evidenceSha: string,
): string[] {
  const issues: string[] = [];

  if (!/^[0-9a-f]{40}$/iu.test(evidenceSha)) {
    issues.push('evidence: gitCommit must be a 40-character SHA');
  }

  for (const name of UI003_GOVERNANCE_DOCUMENT_NAMES) {
    const section = documents[name];
    if (!section.includes(evidenceSha)) {
      issues.push(`${name}: missing exact evidence SHA`);
    }
    if (pendingPattern.test(section)) {
      issues.push(`${name}: still pending cloud verification`);
    }
    if (!absorbedPattern.test(section)) {
      issues.push(`${name}: missing absorbed status`);
    }
  }

  return issues;
}
