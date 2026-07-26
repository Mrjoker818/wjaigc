import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const baseRequiredTargets = [
  'src/app/api/annotations/execute/route.ts',
  'src/app/api/annotations/resolve-target/route.ts',
  'src/features/annotations/annotation-types.ts',
  'src/features/annotations/annotation-bundle.ts',
  'src/features/annotations/annotation-composer.tsx',
  'src/features/annotations/annotation-overlay.tsx',
  'src/features/annotations/node-annotation-workspace.tsx',
  'src/features/annotations/use-annotation-controller.ts',
  'src/lib/annotation-mask.ts',
  'src/lib/annotation-provider-adapter.ts',
  'tests/e2e/annotation-core.spec.ts',
];

const r3SecurityTargets = [
  'src/app/api/edit/route.ts',
  'src/lib/annotation-idempotency.ts',
  'src/lib/cloud-task-storage.ts',
  'src/lib/safe-image-download.ts',
];
const r4SecurityTargets = [
  ...r3SecurityTargets,
  'src/app/api/cancel-task/route.ts',
  'src/app/api/poll-task/route.ts',
  'src/lib/edit-task-store.ts',
  'src/lib/safe-image-input.ts',
  'src/lib/task-registry.ts',
];
const requiredTargets = [...baseRequiredTargets, ...r4SecurityTargets];

const allowedPatterns = [
  /^src\/app\/api\/annotations\//,
  /^src\/app\/api\/(cancel-task|edit|poll-task)\/route\.ts$/,
  /^src\/app\/api\/workflow\/execute\/route\.ts$/,
  /^src\/components\/(canvas-workspace|infinite-canvas|node-editor)\.tsx$/,
  /^src\/features\/annotations\//,
  /^src\/lib\/(annotation-[^/]+|canvas-annotation|cloud-task-storage|edit-task-store|identify-subject|safe-image-download|safe-image-input|task-registry|user-types|workflow-engine)\.ts$/,
  /^src\/__tests__\/(api|components|lib)\/.*annotation.*\.test\.ts$/,
  /^src\/__tests__\/api\/cancel-task\.test\.ts$/,
  /^src\/__tests__\/components\/workflow-persistence-wiring\.test\.ts$/,
  /^src\/__tests__\/lib\/workflow-annotation-node\.test\.ts$/,
  /^src\/__tests__\/lib\/(cloud-task-storage|edit-task-abort|safe-image-download|safe-image-input)\.test\.ts$/,
  /^tests\/e2e\/annotation-core\.spec\.ts$/,
  /^tests\/fixtures\/annotation-source\.png$/,
  /^docs\/testing\/ANNOTATION_(IMPLEMENTATION|REGRESSION)_REPORT\.md$/,
  /^docs\/superpowers\/plans\/2026-07-25-chatcanvas-fused-annotation-implementation\.md$/,
  /^scripts\/(build|verify)-annotation-upgrade(?:-package)?\.mjs$/,
];

const forbiddenPatterns = [
  /(^|\/)\.coze(\/|$)/,
  /^src\/app\/api\/auth\//,
  /^src\/app\/(auth|login)(\/|$)/,
  /^src\/components\/login-panel\.tsx$/,
  /^src\/lib\/(auth|db-client|db-storage)(\.|\/)/,
  /(^|\/)(Dockerfile|docker-compose[^/]*|package\.json|pnpm-lock\.yaml|next\.config\.[^/]+)$/,
  /^scripts\/(start|deploy|coze)[^/]*$/,
];

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function normalizeContent(content, hashMode) {
  if (hashMode === 'binary') return content;
  return Buffer.from(content.toString('utf8').replaceAll('\r\n', '\n'), 'utf8');
}

function installedSha256(filePath, hashMode) {
  return createHash('sha256')
    .update(normalizeContent(readFileSync(filePath), hashMode))
    .digest('hex');
}

function listFiles(root) {
  const output = [];
  for (const name of readdirSync(root)) {
    const absolute = resolve(root, name);
    if (statSync(absolute).isDirectory()) output.push(...listFiles(absolute));
    else output.push(absolute);
  }
  return output;
}

function assertAllowed(targets) {
  const invalidPaths = targets.filter((target) => (
    isAbsolute(target)
    || target === '..'
    || target.startsWith('../')
    || target.includes('/../')
  ));
  if (invalidPaths.length > 0) {
    throw new Error(`升级范围包含不安全路径:\n${invalidPaths.join('\n')}`);
  }

  const forbidden = targets.filter((target) => forbiddenPatterns.some((pattern) => pattern.test(target)));
  const outsideAllowlist = targets.filter((target) => !allowedPatterns.some((pattern) => pattern.test(target)));
  if (forbidden.length > 0) {
    throw new Error(`升级范围包含禁止文件:\n${forbidden.join('\n')}`);
  }
  if (outsideAllowlist.length > 0) {
    throw new Error(`升级范围包含未授权文件:\n${outsideAllowlist.join('\n')}`);
  }
}

function readManifest(packageRoot) {
  const manifestPath = resolve(packageRoot, 'MANIFEST.json');
  if (!existsSync(manifestPath)) throw new Error(`缺少 MANIFEST.json: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 2) {
    throw new Error(`MANIFEST.json schemaVersion 必须为 2，当前为 ${String(manifest.schemaVersion)}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('MANIFEST.json 没有文件记录');
  }
  if (manifest.fileCount !== manifest.files.length) {
    throw new Error(`MANIFEST.json fileCount 不一致: ${String(manifest.fileCount)} != ${manifest.files.length}`);
  }
  return manifest;
}

function validateManifestEntries(manifest) {
  const targets = manifest.files.map((entry) => normalizePath(entry.targetPath));
  assertAllowed(targets);
  const packageId = String(manifest.packageId);
  const manifestRequiredTargets = packageId.endsWith('-r4')
    ? requiredTargets
    : packageId.endsWith('-r3')
      ? [...baseRequiredTargets, ...r3SecurityTargets]
      : baseRequiredTargets;
  for (const required of manifestRequiredTargets) {
    if (!targets.includes(required)) throw new Error(`升级包缺少必需文件: ${required}`);
  }

  const duplicateTargets = targets.filter((target, index) => targets.indexOf(target) !== index);
  if (duplicateTargets.length > 0) {
    throw new Error(`manifest 存在重复目标: ${duplicateTargets.join(', ')}`);
  }

  for (const entry of manifest.files) {
    const target = normalizePath(entry.targetPath);
    if (!['add', 'replace'].includes(entry.operation)) {
      throw new Error(`manifest operation 无效: ${target}`);
    }
    if (!Number.isInteger(entry.size) || entry.size < 0) {
      throw new Error(`manifest size 无效: ${target}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(entry.sha256 || '')) {
      throw new Error(`manifest sha256 无效: ${target}`);
    }
    if (!['text-lf', 'binary'].includes(entry.hashMode)) {
      throw new Error(`manifest hashMode 无效: ${target}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(entry.installedSha256 || '')) {
      throw new Error(`manifest installedSha256 无效: ${target}`);
    }
    if (entry.operation === 'replace' && !/^[a-f0-9]{64}$/i.test(entry.expectedBaseSha256 || '')) {
      throw new Error(`replace 文件必须提供 expectedBaseSha256: ${target}`);
    }
    if (entry.operation === 'add' && entry.expectedBaseSha256) {
      throw new Error(`add 文件不得提供 expectedBaseSha256: ${target}`);
    }
  }
  return targets;
}

function verifyPackage(packageRoot) {
  const manifest = readManifest(packageRoot);
  const targets = validateManifestEntries(manifest);

  if (String(manifest.packageId).endsWith('-r4') && !manifest.sourceBundle) {
    throw new Error('r4 升级包必须包含可验证的 SOURCE_COMMIT.bundle');
  }
  if (String(manifest.packageId).endsWith('-r3') && !manifest.sourceBundle) {
    throw new Error('r3 升级包必须包含可验证的 SOURCE_COMMIT.bundle');
  }
  if (manifest.sourceBundle) {
    const bundlePathValue = normalizePath(manifest.sourceBundle.path || '');
    if (bundlePathValue !== 'SOURCE_COMMIT.bundle') {
      throw new Error('sourceBundle 路径必须为 SOURCE_COMMIT.bundle');
    }
    const bundlePath = resolve(packageRoot, bundlePathValue);
    if (!existsSync(bundlePath)) throw new Error('缺少 SOURCE_COMMIT.bundle');
    if (statSync(bundlePath).size !== manifest.sourceBundle.size) {
      throw new Error('SOURCE_COMMIT.bundle 大小不一致');
    }
    if (sha256(bundlePath) !== manifest.sourceBundle.sha256) {
      throw new Error('SOURCE_COMMIT.bundle SHA-256 不一致');
    }
    const heads = execFileSync('git', ['bundle', 'list-heads', bundlePath], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    if (!heads.includes(manifest.sourceCommit)) {
      throw new Error(`SOURCE_COMMIT.bundle 不包含 sourceCommit: ${manifest.sourceCommit}`);
    }
  }

  for (const entry of manifest.files) {
    const target = normalizePath(entry.targetPath);
    const payloadPath = resolve(packageRoot, 'payload', target);
    if (!existsSync(payloadPath)) throw new Error(`payload 缺少文件: ${target}`);
    const actualHash = sha256(payloadPath);
    if (actualHash !== entry.sha256) throw new Error(`SHA-256 不一致: ${target}`);
    if (statSync(payloadPath).size !== entry.size) throw new Error(`文件大小不一致: ${target}`);
  }

  const payloadRoot = resolve(packageRoot, 'payload');
  const actualTargets = listFiles(payloadRoot).map((file) => normalizePath(relative(payloadRoot, file)));
  const extras = actualTargets.filter((target) => !targets.includes(target));
  if (extras.length > 0) {
    throw new Error(`payload 包含 manifest 外文件:\n${extras.join('\n')}`);
  }

  console.log(`PASS package=${manifest.packageId} files=${targets.length}`);
  return manifest;
}

function verifyTarget(packageRoot, targetRoot, manifest) {
  let ready = 0;
  let alreadyApplied = 0;

  for (const entry of manifest.files) {
    const target = normalizePath(entry.targetPath);
    const targetPath = resolve(targetRoot, target);
    const targetExists = existsSync(targetPath);

    if (targetExists && installedSha256(targetPath, entry.hashMode) === entry.installedSha256) {
      alreadyApplied += 1;
      continue;
    }

    if (entry.operation === 'add') {
      if (targetExists) {
        throw new Error(`新增文件已存在且内容不同: ${target}`);
      }
      ready += 1;
      continue;
    }

    if (!targetExists) {
      throw new Error(`待替换文件不存在: ${target}`);
    }

    const targetHash = installedSha256(targetPath, entry.hashMode);
    if (targetHash !== entry.expectedBaseSha256) {
      throw new Error(
        `安装前哈希不匹配: ${target}\n`
        + `expected=${entry.expectedBaseSha256}\n`
        + `actual=${targetHash}`,
      );
    }
    ready += 1;
  }

  console.log(`PASS target-ready=${ready} already-applied=${alreadyApplied} root=${targetRoot}`);
}

function verifyRepository(repoRoot) {
  for (const required of requiredTargets) {
    if (!existsSync(resolve(repoRoot, required))) throw new Error(`仓库缺少必需文件: ${required}`);
  }
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const comparisonBranch = git(['rev-parse', '--verify', 'origin/main']);
  const tracked = git(['diff', '--name-only', `${comparisonBranch}..HEAD`]).split(/\r?\n/).filter(Boolean);
  const working = git(['diff', '--name-only']).split(/\r?\n/).filter(Boolean);
  const targets = [...new Set([...tracked, ...working].map(normalizePath))];
  assertAllowed(targets);
  console.log(`PASS repository base=${comparisonBranch} changed=${targets.length}`);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少路径参数`);
  return value;
}

function run() {
  const args = process.argv.slice(2);
  if (args[0] === '--repo') {
    verifyRepository(resolve(args[1] || process.cwd()));
    return;
  }

  const packageOption = readOption(args, '--package');
  const targetOption = readOption(args, '--target');
  const packageRoot = resolve(packageOption || args[0] || process.cwd());
  const manifest = verifyPackage(packageRoot);
  if (targetOption) verifyTarget(packageRoot, resolve(targetOption), manifest);
}

try {
  run();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
