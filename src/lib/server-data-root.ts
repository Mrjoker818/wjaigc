/**
 * 数据持久化根目录配置
 * 
 * 生产环境优先使用 /space/wujie-data（S3持久化存储）
 * 确保 re-deploy 不会丢失用户数据
 * 
 * 优先级：
 * 1. 环境变量 WUJIE_DATA_DIR（手动指定）
 * 2. /space/wujie-data（S3持久化卷，生产环境推荐）
 * 3. {cwd}/data（本地开发回退）
 */

import path from 'path';
import fs from 'fs';

const PROJECT_ROOT = process.env.COZE_WORKSPACE_PATH || process.cwd();
const PERSISTENT_DIR = '/space/wujie-data';
const LOCAL_DATA_DIR = path.join(PROJECT_ROOT, 'data');

let _dataRoot: string | null = null;

function getWritableDir(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Test write
    const testFile = path.join(dir, '.write_test');
    fs.writeFileSync(testFile, 'test', 'utf-8');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

export function getServerDataRoot(): string {
  if (_dataRoot) return _dataRoot;

  // 1. 环境变量优先
  if (process.env.WUJIE_DATA_DIR) {
    const envDir = process.env.WUJIE_DATA_DIR;
    if (getWritableDir(envDir)) {
      _dataRoot = envDir;
      console.log(`[DataRoot] Using WUJIE_DATA_DIR: ${_dataRoot}`);
      return _dataRoot;
    }
    console.warn(`[DataRoot] WUJIE_DATA_DIR ${envDir} not writable, falling back`);
  }

  // 2. 尝试 S3 持久化目录 /space/wujie-data
  if (getWritableDir(PERSISTENT_DIR)) {
    _dataRoot = PERSISTENT_DIR;
    console.log(`[DataRoot] Using persistent storage: ${_dataRoot}`);
    
    // 自动迁移旧数据
    migrateFromLocalIfNeeded();
    return _dataRoot;
  }

  // 3. 回退到项目本地目录
  if (getWritableDir(LOCAL_DATA_DIR)) {
    _dataRoot = LOCAL_DATA_DIR;
    console.log(`[DataRoot] Using local data dir: ${_dataRoot} (data will NOT survive redeployment!)`);
    return _dataRoot;
  }

  // 4. 最后回退到 /tmp
  _dataRoot = '/tmp/wujie-data';
  fs.mkdirSync(_dataRoot, { recursive: true });
  console.warn(`[DataRoot] WARNING: Using /tmp/wujie-data - data will be lost on restart!`);
  return _dataRoot;
}

/**
 * 如果本地 data/ 有旧数据且持久目录为空，自动迁移
 */
function migrateFromLocalIfNeeded(): void {
  if (!_dataRoot || _dataRoot === LOCAL_DATA_DIR) return;

  try {
    const localSystemDir = path.join(LOCAL_DATA_DIR, 'system');
    const localUsersDir = path.join(LOCAL_DATA_DIR, 'users');
    
    const hasLocalData = fs.existsSync(localSystemDir) || fs.existsSync(localUsersDir);
    if (!hasLocalData) return;

    const persistentSystemDir = path.join(_dataRoot, 'system');
    const persistentUsersDir = path.join(_dataRoot, 'users');
    
    const hasPersistentData = fs.existsSync(persistentSystemDir) || fs.existsSync(persistentUsersDir);
    if (hasPersistentData) return; // 持久目录已有数据，不覆盖

    console.log(`[DataRoot] Migrating data from ${LOCAL_DATA_DIR} to ${_dataRoot}...`);

    // 迁移 system 目录
    if (fs.existsSync(localSystemDir)) {
      copyDirRecursive(localSystemDir, persistentSystemDir);
      console.log(`[DataRoot] Migrated system/`);
    }

    // 迁移 users 目录
    if (fs.existsSync(localUsersDir)) {
      copyDirRecursive(localUsersDir, persistentUsersDir);
      console.log(`[DataRoot] Migrated users/`);
    }

    console.log(`[DataRoot] Migration complete!`);
  } catch (err) {
    console.error(`[DataRoot] Migration failed:`, err);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function getServerSystemDir(): string {
  return path.join(getServerDataRoot(), 'system');
}

export function getServerUsersDir(): string {
  return path.join(getServerDataRoot(), 'users');
}

/**
 * 保存图片文件到服务器，兼容开发/生产环境
 * - 开发环境: 保存到 public/{subDir}/ 并返回 /{subDir}/filename 的公共URL
 * - 生产环境: 保存到 /space/wujie-data/{subDir}/ 并通过 /api/serve-upload/{subDir}/filename 访问
 * @param buffer 文件数据 (Buffer | string)
 * @param filename 文件名 (如 composite_1234.png)
 * @param subDir 子目录 (如 outpaint, upscale, generated 等)
 * @returns 公共URL路径 (如 /outpaint/composite_1234.png 或 /api/serve-upload/outpaint/composite_1234.png)
 */
export function saveImageFile(
  buffer: Buffer | string,
  filename: string,
  subDir: string
): string {
  const root = getServerDataRoot();
  const dir = path.join(root, subDir);
  
  // 确保目录存在
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const filePath = path.join(dir, filename);
  const data = typeof buffer === 'string' ? Buffer.from(buffer, 'base64') : buffer;
  fs.writeFileSync(filePath, data);
  
  // 统一通过 serve-upload API 访问，确保开发和生产环境路径一致可达
  return `/api/serve-upload/${subDir}/${filename}`;
}

/**
 * 获取图片文件的可写目录路径
 * 用于需要直接写入文件的场景（如第三方工具输出）
 * @param subDir 子目录名
 * @returns 目录的绝对路径
 */
/** Removes one generated file without allowing paths outside the managed data root. */
export function deleteImageFile(filename: string, subDir: string): boolean {
  if (
    !filename
    || filename !== path.basename(filename)
    || !subDir
    || subDir.includes('\0')
  ) {
    return false;
  }
  const root = path.resolve(getServerDataRoot());
  const filePath = path.resolve(root, subDir, filename);
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Returns a writable subdirectory under the managed server data root. */
export function getImageWriteDir(subDir: string): string {
  const root = getServerDataRoot();
  const dir = path.join(root, subDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 将文件路径转换为公共URL
 * @param filePath 文件的绝对路径
 * @param subDir 子目录名 (用于计算相对路径)
 * @returns 公共URL路径
 */
export function filePathToPublicUrl(filePath: string, subDir: string): string {
  const filename = path.basename(filePath);
  const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
  if (isProd) {
    return `/api/serve-upload/${subDir}/${filename}`;
  }
  return `/${subDir}/${filename}`;
}
