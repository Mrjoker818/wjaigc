export type Task7Scenario =
  | 'desktop-valid'
  | 'desktop-invalid'
  | 'desktop-download-off'
  | 'desktop-download-on'
  | 'mobile-portrait'
  | 'mobile-landscape';

export type Task7PageRole = 'primary' | 'secondary' | 'no-frame';
export type Task7FrameRole = 'main' | 'child' | 'none';
export type Task7ForbiddenReason =
  | 'unsafe-method'
  | 'cross-origin'
  | 'contract-not-configured'
  | 'unexpected-page'
  | 'unexpected-frame'
  | 'unexpected-search'
  | 'unexpected-navigation'
  | 'request-contract-mismatch'
  | 'scenario-forbidden-endpoint'
  | 'unexpected-public-share-path'
  | 'unexpected-request';

export interface Task7RequestRecord {
  method: string;
  origin: string;
  pathname: string;
  search: string;
  resourceType: string;
  navigation: boolean;
  pageRole: Task7PageRole;
  frameRole: Task7FrameRole;
  range: string | null;
  reason?: Task7ForbiddenReason;
}

export interface Task7FrameNavigationRecord {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  pageRole: Task7PageRole;
  frameRole: Task7FrameRole;
  reason?: Task7ForbiddenReason;
}

export interface Task7ExpectedRequest {
  readonly label: string;
  readonly method: 'GET' | 'HEAD';
  readonly pathname: string;
  readonly search: '' | 'next-build-query' | 'favicon-hash-query';
  readonly resourceType: string;
  readonly navigation: boolean;
  readonly ranges: readonly (string | null)[];
  readonly count: number;
}

export interface Task7MediaProbe {
  touchStarts: number;
  contextMenus: number;
  defaultPrevented: boolean;
  contextTargetWasMedia: boolean;
  suppressClick: boolean;
}

export interface Task7EvidenceDetails {
  mediaLongPress?: {
    nativeContextMenuSynthesized: boolean;
    mediaProbe: Task7MediaProbe;
  };
}

export interface Task7EvidenceDescriptor {
  readonly scenario: Task7Scenario;
  readonly project: string;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly longPress: 'required' | 'absent';
  readonly requestContract: readonly Task7ExpectedRequest[];
}

export const task7CanonicalPaths = Object.freeze({
  share: '/shared/canvas/:share-token',
  metadata: '/api/public/canvas-shares/:share-token',
  image: '/api/public/canvas-shares/:share-token/media/:image-item',
  video: '/api/public/canvas-shares/:share-token/media/:video-item',
  unavailable: '/api/public/canvas-shares/:share-token/media/:unavailable-item',
  download: '/api/public/canvas-shares/:share-token/media/:image-item/download',
});

function request(
  label: string,
  pathname: string,
  resourceType: string,
  options: Partial<Pick<Task7ExpectedRequest, 'method' | 'search' | 'navigation' | 'ranges' | 'count'>> = {},
): Task7ExpectedRequest {
  return Object.freeze({
    label,
    method: options.method ?? 'GET',
    pathname,
    search: options.search ?? '',
    resourceType,
    navigation: options.navigation ?? false,
    ranges: Object.freeze([...(options.ranges ?? [null])]),
    count: options.count ?? 1,
  });
}

const commonRequests = Object.freeze([
  request('share document', task7CanonicalPaths.share, 'document', { navigation: true }),
  request('layout stylesheet', '/_next/static/css/app/layout.css', 'stylesheet', { search: 'next-build-query' }),
  request('webpack script', '/_next/static/chunks/webpack.js', 'script', { search: 'next-build-query' }),
  request('main app script', '/_next/static/chunks/main-app.js', 'script', { search: 'next-build-query' }),
  request('app pages internals', '/_next/static/chunks/app-pages-internals.js', 'script'),
  request('app layout script', '/_next/static/chunks/app/layout.js', 'script'),
  request('shared canvas page script', '/_next/static/chunks/app/shared/canvas/%5Btoken%5D/page.js', 'script'),
  request('favicon', '/favicon.ico', 'other', { search: 'favicon-hash-query' }),
  request('metadata', task7CanonicalPaths.metadata, 'fetch'),
]);

const sharedMediaRequests = Object.freeze([
  request('initial image media', task7CanonicalPaths.image, 'image', { count: 2 }),
  request('unavailable image media', task7CanonicalPaths.unavailable, 'image'),
  request('browser video lifecycle', task7CanonicalPaths.video, 'media', { ranges: [null, 'bytes=0-'] }),
]);

const videoProbeRequests = Object.freeze([
  request('video HEAD probe', task7CanonicalPaths.video, 'fetch', { method: 'HEAD' }),
  request('video partial probe', task7CanonicalPaths.video, 'fetch', { ranges: ['bytes=2-5'] }),
  request('video clamped probe', task7CanonicalPaths.video, 'fetch', { ranges: ['bytes=1540-999999'] }),
  request('video unsatisfiable probe', task7CanonicalPaths.video, 'fetch', { ranges: ['bytes=999999-1000000'] }),
]);

function descriptor(value: Task7EvidenceDescriptor): Task7EvidenceDescriptor {
  return Object.freeze({
    ...value,
    viewport: Object.freeze({ ...value.viewport }),
    requestContract: Object.freeze([...value.requestContract]),
  });
}

const mobileContract = Object.freeze([...commonRequests, ...sharedMediaRequests]);

export const task7EvidenceDescriptors = Object.freeze({
  'desktop/chromium/valid': descriptor({
    scenario: 'desktop-valid', project: 'chromium', viewport: { width: 1280, height: 720 }, longPress: 'absent',
    requestContract: [...commonRequests, ...sharedMediaRequests, ...videoProbeRequests],
  }),
  'desktop/chromium/invalid': descriptor({
    scenario: 'desktop-invalid', project: 'chromium', viewport: { width: 1280, height: 720 }, longPress: 'absent',
    requestContract: commonRequests,
  }),
  'desktop/chromium/download-off': descriptor({
    scenario: 'desktop-download-off', project: 'chromium', viewport: { width: 1280, height: 720 }, longPress: 'absent',
    requestContract: [
      ...commonRequests,
      request('initial image media', task7CanonicalPaths.image, 'image'),
      request('unavailable image media', task7CanonicalPaths.unavailable, 'image'),
      request('browser video lifecycle', task7CanonicalPaths.video, 'media', { ranges: [null, 'bytes=0-'] }),
      request('disabled download probe', task7CanonicalPaths.download, 'fetch'),
    ],
  }),
  'desktop/chromium/download-on': descriptor({
    scenario: 'desktop-download-on', project: 'chromium', viewport: { width: 1280, height: 720 }, longPress: 'absent',
    requestContract: [
      ...commonRequests,
      ...sharedMediaRequests,
      request('controlled download', task7CanonicalPaths.download, 'document', { navigation: true }),
    ],
  }),
  'mobile/mobile-320-chromium/portrait': descriptor({
    scenario: 'mobile-portrait', project: 'mobile-320-chromium', viewport: { width: 320, height: 568 }, longPress: 'required',
    requestContract: mobileContract,
  }),
  'mobile/mobile-375-chromium/portrait': descriptor({
    scenario: 'mobile-portrait', project: 'mobile-375-chromium', viewport: { width: 375, height: 667 }, longPress: 'required',
    requestContract: mobileContract,
  }),
  'mobile/mobile-393-chromium/portrait': descriptor({
    scenario: 'mobile-portrait', project: 'mobile-393-chromium', viewport: { width: 393, height: 852 }, longPress: 'required',
    requestContract: mobileContract,
  }),
  'mobile/mobile-chromium/landscape': descriptor({
    scenario: 'mobile-landscape', project: 'mobile-chromium', viewport: { width: 812, height: 375 }, longPress: 'absent',
    requestContract: mobileContract,
  }),
} as const);

export type Task7EvidenceIdentity = keyof typeof task7EvidenceDescriptors;
export const task7ChromiumMatrixIdentities = Object.freeze(
  Object.keys(task7EvidenceDescriptors) as Task7EvidenceIdentity[],
);

const nextBuildQueryPattern = /^\?v=\d+$/u;
const faviconQueryPattern = /^\?[a-f0-9]+$/iu;

function matchesSearch(expected: Task7ExpectedRequest['search'], actual: string): boolean {
  if (expected === 'next-build-query') return nextBuildQueryPattern.test(actual);
  if (expected === 'favicon-hash-query') return faviconQueryPattern.test(actual);
  return actual === expected;
}

export function task7RequestMatches(expected: Task7ExpectedRequest, actual: Task7RequestRecord): boolean {
  return actual.reason === undefined
    && actual.method === expected.method
    && actual.origin === ':same-origin'
    && actual.pathname === expected.pathname
    && matchesSearch(expected.search, actual.search)
    && actual.resourceType === expected.resourceType
    && actual.navigation === expected.navigation
    && actual.pageRole === 'primary'
    && actual.frameRole === 'main'
    && expected.ranges.includes(actual.range);
}

export function isTask7VolatileInfrastructureRequest(actual: Task7RequestRecord): boolean {
  if (actual.reason !== undefined
    || actual.method !== 'GET'
    || actual.origin !== ':same-origin'
    || actual.navigation
    || actual.pageRole !== 'primary'
    || actual.frameRole !== 'main'
    || actual.range !== null) return false;
  if (/^\/__nextjs_font\/geist(?:-mono)?-latin\.woff2$/u.test(actual.pathname)) {
    return actual.resourceType === 'font' && actual.search === '';
  }
  if (/^\/_next\/static\/webpack\/[a-f0-9]+\.webpack\.hot-update\.json$/u.test(actual.pathname)) {
    return actual.resourceType === 'fetch' && actual.search === '';
  }
  if (/^\/_next\/static\/webpack\/webpack\.[a-f0-9]+\.hot-update\.js$/u.test(actual.pathname)) {
    return actual.resourceType === 'script' && actual.search === '';
  }
  if (actual.pathname === task7CanonicalPaths.share && /^\?_rsc=[a-zA-Z0-9_-]+$/u.test(actual.search)) {
    return actual.resourceType === 'fetch';
  }
  return actual.pathname === '/_next/webpack-hmr'
    && actual.search === ''
    && ['fetch', 'eventsource'].includes(actual.resourceType);
}

export function task7ScenarioRequestContract(scenario: Task7Scenario): readonly Task7ExpectedRequest[] {
  const descriptorValue = Object.values(task7EvidenceDescriptors).find(item => item.scenario === scenario);
  if (!descriptorValue) throw new Error(`unknown Task 7 scenario: ${scenario}`);
  return descriptorValue.requestContract;
}

const allPublicPaths = new Set<string>(Object.values(task7CanonicalPaths).filter(path => path.startsWith('/api/public/')));

export function classifyTask7Request(
  scenario: Task7Scenario | null,
  requestRecord: Task7RequestRecord,
): Task7ForbiddenReason | null {
  if (requestRecord.method !== 'GET' && requestRecord.method !== 'HEAD') return 'unsafe-method';
  if (requestRecord.origin !== ':same-origin') return 'cross-origin';
  if (!scenario) return 'contract-not-configured';
  if (requestRecord.pageRole !== 'primary') return 'unexpected-page';
  if (requestRecord.frameRole !== 'main') return 'unexpected-frame';
  if (isTask7VolatileInfrastructureRequest(requestRecord)) return null;
  const contract = task7ScenarioRequestContract(scenario);
  if (contract.some(expected => task7RequestMatches(expected, requestRecord))) return null;
  if (requestRecord.search !== '') return 'unexpected-search';
  if (allPublicPaths.has(requestRecord.pathname)
    && !contract.some(expected => expected.pathname === requestRecord.pathname)) {
    return 'scenario-forbidden-endpoint';
  }
  if (requestRecord.pathname.startsWith('/api/public/canvas-shares/')) {
    return allPublicPaths.has(requestRecord.pathname) ? 'request-contract-mismatch' : 'unexpected-public-share-path';
  }
  if (requestRecord.pathname === task7CanonicalPaths.share) return 'request-contract-mismatch';
  if (requestRecord.navigation) return 'unexpected-navigation';
  return 'unexpected-request';
}

export function evaluateTask7RequestContract(
  scenario: Task7Scenario,
  requests: readonly Task7RequestRecord[],
  forbiddenRequestCount: number,
  forbiddenFrameNavigationCount: number,
): {
  valid: boolean;
  errors: string[];
  expected: Array<{ label: string; count: number }>;
  actual: Array<{ label: string; count: number }>;
} {
  const contract = task7ScenarioRequestContract(scenario);
  const relevantRequests = requests.filter(item => !isTask7VolatileInfrastructureRequest(item));
  const errors: string[] = [];
  const actual = contract.map(expected => {
    const count = relevantRequests.filter(item => task7RequestMatches(expected, item)).length;
    if (count !== expected.count) errors.push(`${expected.label}: expected ${expected.count}, received ${count}`);
    return { label: expected.label, count };
  });
  const matched = relevantRequests.filter(item => contract.some(expected => task7RequestMatches(expected, item))).length;
  if (matched !== relevantRequests.length) errors.push(`unexpected scenario requests: ${relevantRequests.length - matched}`);
  if (forbiddenRequestCount !== 0) errors.push(`forbidden requests: ${forbiddenRequestCount}`);
  if (forbiddenFrameNavigationCount !== 0) errors.push(`forbidden frame navigations: ${forbiddenFrameNavigationCount}`);
  return {
    valid: errors.length === 0,
    errors,
    expected: contract.map(expected => ({ label: expected.label, count: expected.count })),
    actual,
  };
}

export interface Task7CanonicalInput {
  identity: string;
  scenario: Task7Scenario;
  project: string;
  viewport: { width: number; height: number } | null;
  requests: readonly Task7RequestRecord[];
  frameNavigations: readonly Task7FrameNavigationRecord[];
  forbiddenRequestCount: number;
  forbiddenRequests: readonly Task7RequestRecord[];
  forbiddenFrameNavigationCount: number;
  forbiddenFrameNavigations: readonly Task7FrameNavigationRecord[];
  details: Task7EvidenceDetails;
}

export function deriveTask7CanonicalSummary(record: Task7CanonicalInput) {
  const descriptorValue = task7EvidenceDescriptors[record.identity as Task7EvidenceIdentity];
  if (!descriptorValue) throw new Error(`no immutable descriptor for evidence identity ${record.identity}`);
  if (record.scenario !== descriptorValue.scenario
    || record.project !== descriptorValue.project
    || record.viewport?.width !== descriptorValue.viewport.width
    || record.viewport?.height !== descriptorValue.viewport.height) {
    throw new Error(`semantic descriptor mismatch for ${record.identity}`);
  }
  if (record.forbiddenRequestCount !== record.forbiddenRequests.length || record.forbiddenRequestCount !== 0) {
    throw new Error(`record ${record.identity} contains forbidden requests`);
  }
  if (record.forbiddenFrameNavigationCount !== record.forbiddenFrameNavigations.length
    || record.forbiddenFrameNavigationCount !== 0
    || record.frameNavigations.length !== 0) {
    throw new Error(`record ${record.identity} contains unexpected frame navigations`);
  }
  const contract = evaluateTask7RequestContract(
    record.scenario,
    record.requests,
    record.forbiddenRequestCount,
    record.forbiddenFrameNavigationCount,
  );
  if (!contract.valid) throw new Error(`semantic request contract mismatch for ${record.identity}: ${contract.errors.join('; ')}`);

  const longPress = record.details.mediaLongPress;
  let longPressObservation: null | {
    required: true;
    nativeContextMenuSynthesized: boolean;
    touchStarts: number;
    contextMenus: number;
    defaultPrevented: boolean;
    contextTargetWasMedia: boolean;
    suppressClick: boolean;
  } = null;
  if (descriptorValue.longPress === 'required') {
    if (!longPress
      || longPress.mediaProbe.touchStarts !== 1
      || longPress.mediaProbe.contextMenus !== 1
      || !longPress.mediaProbe.defaultPrevented
      || !longPress.mediaProbe.contextTargetWasMedia
      || !longPress.mediaProbe.suppressClick) {
      throw new Error(`record ${record.identity} does not satisfy the required media long-press event chain`);
    }
    longPressObservation = Object.freeze({
      required: true as const,
      nativeContextMenuSynthesized: longPress.nativeContextMenuSynthesized,
      ...longPress.mediaProbe,
    });
  } else if (longPress !== undefined) {
    throw new Error(`record ${record.identity} must not contain a media long-press probe`);
  }

  return Object.freeze({
    scenario: descriptorValue.scenario,
    project: descriptorValue.project,
    viewport: { ...descriptorValue.viewport },
    requestContract: descriptorValue.requestContract.map(expected => ({ ...expected, ranges: [...expected.ranges] })),
    requestResults: contract.actual.map((actual, index) => ({
      label: actual.label,
      expectedCount: contract.expected[index].count,
      actualCount: actual.count,
    })),
    requestCount: record.requests.filter(item => !isTask7VolatileInfrastructureRequest(item)).length,
    volatileInfrastructureCount: record.requests.filter(isTask7VolatileInfrastructureRequest).length,
    frameNavigationCount: record.frameNavigations.length,
    forbiddenRequestCount: record.forbiddenRequestCount,
    forbiddenFrameNavigationCount: record.forbiddenFrameNavigationCount,
    longPressObservation,
  });
}
