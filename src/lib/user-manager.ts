// 用户数据管理器 - localStorage + 服务器数据库双重存储
import { User, Project, ApiKey, UsageStats, UserData, WujieProjectFile, ImageGroupData, CanvasImage } from './user-types';
import { APP_VERSION_LABEL } from '@/config/app-meta';
import {
  selectCanvasPlacementSnapshot,
  serializeCanvasWorkspacePlacements,
} from '@/lib/asset-core/canvas-adapter';
import { readProjectSnapshot } from '@/lib/asset-core/project-readers';
import type { AssetGraphMode } from '@/lib/asset-core/types';

const STORAGE_KEY = 'unbounded_ai_user_data';
const CURRENT_USER_KEY = 'unbounded_ai_current_user';
const PROJECT_AUTHORITATIVE_BASE_KEY_PREFIX = 'unbounded_ai_project_authoritative_base_v1:';
const PROJECT_CONFLICT_BACKUP_KEY_PREFIX = 'unbounded_ai_project_conflict_backups_v1:';
const PROJECT_ADOPTION_COMMIT_KEY_PREFIX = 'unbounded_ai_project_adoption_commit_v2:';
const PROJECT_SYNC_STORAGE_VERSION = 1;
const PROJECT_ADOPTION_COMMIT_VERSION = 2;
const MAX_PROJECT_CONFLICT_BACKUPS = 50;
const MAX_PROJECT_ADOPTION_COMMIT_BYTES = 12_000_000;
const DEFAULT_ADMIN_NAME = 'Mr.joker';
const PROJECT_SYNC_TIMEOUT_MS = 8_000;
// Default admin password is no longer stored in client code for security.
// The server handles authentication; client sends the password the user types.

const userStorageFolder = (userId: string): string => `data/users/${userId}`;

const defaultApiPermissions = () => ({
  image: true,
  chat: true,
  threeD: true,
  imageEdit: true,
  vectorize: true,
  vlm: true,
  layer: true,
  video: true,
  upscaler: true,
  removebg: true,
  audio: true,
});

interface MultiUserData {
  users: User[];
  userData: Record<string, UserData>; // userId -> UserData
}

interface SnapshotProject {
  id?: string;
  projectId?: string;
  name?: string;
  canvasImages?: unknown[];
  updatedAt?: number;
}

interface SnapshotUserData {
  projects?: SnapshotProject[];
}

interface ProjectSyncResponse {
  success?: boolean;
  error?: string;
  projectRevision?: number;
  currentRevision?: number;
  projectIdMap?: Record<string, string>;
  assetGraphMappings?: Record<string, Record<string, {
    assetId: string;
    versionId: string;
    placementId: string;
  }>>;
  assetGraphUpdates?: Record<string, Record<string, {
    assetId: string;
    versionId: string;
    placementId: string;
    url: string;
    sourceUrl: string | null;
    thumbnailUrl: string | null;
    mediaAvailability: CanvasImage['mediaAvailability'];
    mediaErrorCode: string | null;
    originalWidth: number;
    originalHeight: number;
  }>>;
  assetGraphMode?: AssetGraphMode;
}

export interface ProjectSyncResult {
  projectIdMap: Record<string, string>;
}

export class ProjectSyncConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super('Canvas project sync conflict; refresh or retry after the latest server snapshot is loaded');
    this.name = 'ProjectSyncConflictError';
    this.currentRevision = currentRevision;
  }
}

type ProjectConflictType =
  | 'concurrent-image-add'
  | 'concurrent-image-edit'
  | 'remote-image-delete-local-edit'
  | 'local-image-delete-remote-edit'
  | 'concurrent-project-add'
  | 'concurrent-project-edit'
  | 'remote-project-delete-local-edit'
  | 'local-project-delete-remote-edit';

interface ProjectConflictBackup {
  conflictType: ProjectConflictType;
  userId: string;
  projectId: string;
  imageId?: string;
  localValue: Project | CanvasImage | null;
  remoteValue: Project | CanvasImage | null;
  createdAt: number;
}

interface ProjectAuthoritativeBaseEnvelope {
  version: 1;
  userId: string;
  revision: number;
  projects: Project[];
  updatedAt: number;
}

interface ProjectAdoptionCommitEnvelope {
  version: 2;
  userId: string;
  revision: number;
  assetGraphMode: AssetGraphMode;
  authoritativeBase: Project[];
  adoptedDraft: Project[];
  conflictBackups: ProjectConflictBackup[];
  updatedAt: number;
  pending?: {
    startedAt: number;
  };
}

interface LocalDataCommitResult {
  ok: boolean;
  persistedData?: MultiUserData;
  error?: unknown;
}

interface ProjectRebaseResult {
  projects: Project[];
  conflicts: ProjectConflictBackup[];
}

function cloneProjects(projects: Project[]): Project[] {
  return JSON.parse(JSON.stringify(projects)) as Project[];
}

function canonicalizeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSnapshot);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeSnapshot(entry)]),
    );
  }
  return value;
}

function snapshotsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeSnapshot(left)) === JSON.stringify(canonicalizeSnapshot(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidCanvasImageSnapshot(value: unknown): value is CanvasImage {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || typeof value.url !== 'string') {
    return false;
  }
  if (
    !isFiniteNumber(value.x)
    || !isFiniteNumber(value.y)
    || !isFiniteNumber(value.width)
    || value.width <= 0
    || !isFiniteNumber(value.height)
    || value.height <= 0
    || !isFiniteNumber(value.originalWidth)
    || value.originalWidth <= 0
    || !isFiniteNumber(value.originalHeight)
    || value.originalHeight <= 0
    || !isFiniteNumber(value.rotation)
    || !isFiniteNumber(value.zIndex)
    || !isFiniteNumber(value.createdAt)
  ) {
    return false;
  }
  const optionalStrings = [
    value.sourceUrl,
    value.thumbnailUrl,
    value.mediaErrorCode,
    value.assetId,
    value.assetVersionId,
    value.placementId,
  ];
  return optionalStrings.every((entry) => entry === undefined || typeof entry === 'string');
}

function isValidProjectSnapshot(value: unknown, userId: string): value is Project {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.name !== 'string'
    || !isFiniteNumber(value.createdAt)
    || !isFiniteNumber(value.updatedAt)
    || !isRecord(value.settings)
    || !Array.isArray(value.canvasImages)
  ) return false;
  if (value.userId !== undefined && value.userId !== userId) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.metadata !== undefined && !isRecord(value.metadata)) return false;
  return value.canvasImages.every(isValidCanvasImageSnapshot);
}

function isValidProjectSnapshotArray(value: unknown, userId: string): value is Project[] {
  if (!Array.isArray(value)) return false;
  const projectIds = new Set<string>();
  for (const project of value) {
    if (!isValidProjectSnapshot(project, userId) || projectIds.has(project.id)) return false;
    projectIds.add(project.id);
    const imageIds = new Set<string>();
    const placementIds = new Set<string>();
    for (const image of project.canvasImages) {
      if (imageIds.has(image.id)) return false;
      imageIds.add(image.id);
      if (image.placementId !== undefined) {
        if (placementIds.has(image.placementId)) return false;
        placementIds.add(image.placementId);
      }
    }
  }
  return true;
}

function isValidConflictBackup(value: unknown, userId: string): value is ProjectConflictBackup {
  if (!isRecord(value)) return false;
  const imageConflictTypes = new Set<ProjectConflictType>([
    'concurrent-image-add',
    'concurrent-image-edit',
    'remote-image-delete-local-edit',
    'local-image-delete-remote-edit',
  ]);
  const projectConflictTypes = new Set<ProjectConflictType>([
    'concurrent-project-add',
    'concurrent-project-edit',
    'remote-project-delete-local-edit',
    'local-project-delete-remote-edit',
  ]);
  const conflictType = value.conflictType as ProjectConflictType;
  const isImageConflict = imageConflictTypes.has(conflictType);
  const isProjectConflict = projectConflictTypes.has(conflictType);
  const isValidValue = (candidate: unknown): boolean => candidate === null || (
    isImageConflict
      ? isValidCanvasImageSnapshot(candidate)
      : isProjectConflict && isValidProjectSnapshot(candidate, userId)
  );
  return (isImageConflict || isProjectConflict)
    && value.userId === userId
    && typeof value.projectId === 'string'
    && typeof value.conflictType === 'string'
    && (isImageConflict ? typeof value.imageId === 'string' : value.imageId === undefined)
    && isFiniteNumber(value.createdAt)
    && isValidValue(value.localValue)
    && isValidValue(value.remoteValue);
}

function serializedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function projectWithoutImages(project: Project): Omit<Project, 'canvasImages'> {
  const fields: Partial<Project> = { ...project };
  delete fields.canvasImages;
  return fields as Omit<Project, 'canvasImages'>;
}

function rebaseProjectSnapshots(
  baseProjects: Project[],
  localProjects: Project[],
  remoteProjects: Project[],
  userId: string,
): ProjectRebaseResult {
  const baseById = new Map(baseProjects.map((project) => [project.id, project]));
  const localById = new Map(localProjects.map((project) => [project.id, project]));
  const remoteById = new Map(remoteProjects.map((project) => [project.id, project]));
  const rebased: Project[] = [];
  const conflicts: ProjectConflictBackup[] = [];
  const backup = (
    conflictType: ProjectConflictType,
    projectId: string,
    localValue: Project | CanvasImage | null,
    remoteValue: Project | CanvasImage | null,
    imageId?: string,
  ): void => {
    conflicts.push({
      conflictType,
      userId,
      projectId,
      ...(imageId ? { imageId } : {}),
      localValue: localValue === null ? null : JSON.parse(JSON.stringify(localValue)) as Project | CanvasImage,
      remoteValue: remoteValue === null ? null : JSON.parse(JSON.stringify(remoteValue)) as Project | CanvasImage,
      createdAt: Date.now(),
    });
  };

  for (const baseProject of baseProjects) {
    const localProject = localById.get(baseProject.id);
    const remoteProject = remoteById.get(baseProject.id);
    if (!remoteProject && localProject) {
      if (!snapshotsEqual(localProject, baseProject)) {
        backup('remote-project-delete-local-edit', baseProject.id, localProject, null);
      }
      localById.delete(baseProject.id);
    }
  }

  for (const remoteProject of remoteProjects) {
    const baseProject = baseById.get(remoteProject.id);
    const localProject = localById.get(remoteProject.id);
    if (baseProject && !localProject) {
      if (snapshotsEqual(projectWithoutImages(remoteProject), projectWithoutImages(baseProject))
        && snapshotsEqual(remoteProject.canvasImages, baseProject.canvasImages)) continue;
      backup('local-project-delete-remote-edit', remoteProject.id, null, remoteProject);
      rebased.push(remoteProject);
      continue;
    }
    if (!localProject) {
      rebased.push(remoteProject);
      continue;
    }

    const baseImages = new Map((baseProject?.canvasImages ?? []).map((image) => [image.id, image]));
    const localImages = new Map(localProject.canvasImages.map((image) => [image.id, image]));
    const remoteImages = new Map(remoteProject.canvasImages.map((image) => [image.id, image]));
    const canvasImages: CanvasImage[] = [];

    for (const remoteImage of remoteProject.canvasImages) {
      const baseImage = baseImages.get(remoteImage.id);
      const localImage = localImages.get(remoteImage.id);
      if (baseImage && !localImage) {
        if (snapshotsEqual(remoteImage, baseImage)) continue;
        backup('local-image-delete-remote-edit', remoteProject.id, null, remoteImage, remoteImage.id);
        canvasImages.push(remoteImage);
        continue;
      }
      if (!localImage) {
        canvasImages.push(remoteImage);
        continue;
      }
      if (!baseImage) {
        if (!snapshotsEqual(localImage, remoteImage)) {
          backup('concurrent-image-add', remoteProject.id, localImage, remoteImage, remoteImage.id);
        }
        canvasImages.push(remoteImage);
        continue;
      }
      const localChanged = !snapshotsEqual(localImage, baseImage);
      const remoteChanged = !snapshotsEqual(remoteImage, baseImage);
      if (localChanged && !remoteChanged) {
        canvasImages.push(localImage);
      } else if (localChanged && remoteChanged && !snapshotsEqual(localImage, remoteImage)) {
        backup('concurrent-image-edit', remoteProject.id, localImage, remoteImage, remoteImage.id);
        canvasImages.push(remoteImage);
      } else {
        canvasImages.push(remoteImage);
      }
    }

    for (const localImage of localProject.canvasImages) {
      if (remoteImages.has(localImage.id)) continue;
      const baseImage = baseImages.get(localImage.id);
      if (baseImage) {
        if (!snapshotsEqual(localImage, baseImage)) {
          backup('remote-image-delete-local-edit', remoteProject.id, localImage, null, localImage.id);
        }
        continue;
      }
      canvasImages.push(localImage);
    }

    const baseFields = baseProject ? projectWithoutImages(baseProject) : undefined;
    const localFields = projectWithoutImages(localProject);
    const remoteFields = projectWithoutImages(remoteProject);
    let fields = remoteFields;
    if (baseFields) {
      const localChanged = !snapshotsEqual(localFields, baseFields);
      const remoteChanged = !snapshotsEqual(remoteFields, baseFields);
      if (localChanged && !remoteChanged) {
        fields = localFields;
      } else if (localChanged && remoteChanged && !snapshotsEqual(localFields, remoteFields)) {
        backup('concurrent-project-edit', remoteProject.id, localProject, remoteProject);
      }
    } else if (!snapshotsEqual(localProject, remoteProject)) {
      backup('concurrent-project-add', remoteProject.id, localProject, remoteProject);
    }
    rebased.push({ ...fields, canvasImages });
    localById.delete(remoteProject.id);
  }

  for (const localProject of localById.values()) {
    if (!baseById.has(localProject.id) && !remoteById.has(localProject.id)) rebased.push(localProject);
  }
  return { projects: rebased, conflicts };
}

export class UserManager {
  private static instance: UserManager;
  private multiUserData: MultiUserData | null = null;
  private currentUserId: string | null = null;
  private _serverSyncReady = false; // 在 loadProjectsFromServer 成功前阻止 syncToServer 上传空数据
  private _assetGraphMode: AssetGraphMode = 'legacy';
  private _projectSyncRevision = 0;
  private _projectSyncRequestEpoch = 0;
  private _projectSyncSessionEpoch = 0;
  private _projectMutationGeneration = 0;
  private _projectSyncInFlightTokens = new Set<string>();
  private _lastAuthoritativeProjects = new Map<string, Project[]>();
  private _onProjectsChanged: (() => void) | null = null;
  // ★ 跟踪最近删除的图片ID，防止服务器同步时将已删除的图片合并回来
  // Map: imageId → 删除时间戳(ms)，60秒后自动清理
  private _recentlyDeletedImageIds: Map<string, number> = new Map();
  private static readonly DELETED_IMAGE_TTL_MS = 60_000; // 60秒内过滤已删除图片

  /** 注册项目数据变更回调（用于跨设备同步时刷新 UI），返回取消订阅函数 */
  onProjectsChanged(callback: (() => void) | null): () => void {
    this._onProjectsChanged = callback;
    return () => { if (this._onProjectsChanged === callback) this._onProjectsChanged = null; };
  }

  /** 记录已删除的图片ID（防止服务器同步时恢复已删除图片） */
  recordDeletedImageIds(imageIds: string[]): void {
    const now = Date.now();
    for (const id of imageIds) {
      this._recentlyDeletedImageIds.set(id, now);
    }
    // 清理过期的记录
    this.cleanupDeletedImageIds();
  }

  /** 检查图片ID是否在最近删除列表中 */
  isRecentlyDeletedImage(imageId: string): boolean {
    const deleteTime = this._recentlyDeletedImageIds.get(imageId);
    if (!deleteTime) return false;
    if (Date.now() - deleteTime > UserManager.DELETED_IMAGE_TTL_MS) {
      this._recentlyDeletedImageIds.delete(imageId);
      return false;
    }
    return true;
  }

  /** 清理过期的已删除图片ID记录 */
  private cleanupDeletedImageIds(): void {
    const now = Date.now();
    for (const [id, time] of this._recentlyDeletedImageIds) {
      if (now - time > UserManager.DELETED_IMAGE_TTL_MS) {
        this._recentlyDeletedImageIds.delete(id);
      }
    }
  }

  private notifyProjectsChanged() {
    if (this._onProjectsChanged) {
      try { this._onProjectsChanged(); } catch { /* best effort */ }
    }
  }

  private constructor() {
    this.loadData();
  }

  static getInstance(): UserManager {
    if (!UserManager.instance) {
      UserManager.instance = new UserManager();
    }
    return UserManager.instance;
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }

  private loadData(): void {
    if (!this.canUseStorage()) {
      this.multiUserData = {
        users: [],
        userData: {},
      };
      this.ensureDefaultAdmin();
      return;
    }

    try {
      // ?????????ID
      const currentUserIdStored = localStorage.getItem(CURRENT_USER_KEY);
      if (currentUserIdStored) {
        this.currentUserId = currentUserIdStored;
      }

      // ???????????
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // ???????????
        if (data.user && !data.users) {
          // ???????????????
          const oldUserData = data as UserData;
          this.multiUserData = {
            users: [oldUserData.user],
            userData: {
              [oldUserData.user.id]: oldUserData
            }
          };
          this.currentUserId = oldUserData.user.id;
          this.saveData();
        } else {
          // ?????
          this.multiUserData = data;
        }
      } else {
        this.multiUserData = {
          users: [],
          userData: {}
        };
      }
      this.ensureDefaultAdmin();
      // 构造函数加载数据后，严格验证所有用户的项目数据隔离
      // 核心原则：每个用户键下只能保留属于该用户的项目
      if (this.multiUserData?.userData) {
        // ★ 第一轮：找出跨用户重复的项目ID（同一ID出现在多个用户下）
        const projectIdToUsers = new Map<string, string[]>();
        for (const uid of Object.keys(this.multiUserData.userData)) {
          const ud = this.multiUserData.userData[uid];
          if (ud?.projects) {
            for (const p of ud.projects) {
              if (!p.id) continue;
              const users = projectIdToUsers.get(p.id) || [];
              if (!users.includes(uid)) users.push(uid);
              projectIdToUsers.set(p.id, users);
            }
          }
        }
        const duplicateProjectIds = new Set(
          [...projectIdToUsers.entries()]
            .filter(([, users]) => users.length > 1)
            .map(([id]) => id)
        );

        // ★ 第二轮：严格过滤每个用户的项目
        for (const uid of Object.keys(this.multiUserData.userData)) {
          const ud = this.multiUserData.userData[uid];
          if (ud?.projects) {
            const before = ud.projects.length;
            ud.projects = ud.projects.filter(p => {
              // 跨用户重复的项目ID，全部移除，等服务器加载时恢复正确数据
              if (duplicateProjectIds.has(p.id)) {
                console.warn(`[DataIsolation] loadData: project ${p.id} exists in multiple users, removing from user ${uid}`);
                return false;
              }
              if (p.userId && p.userId !== uid) return false; // userId不匹配，严格拒绝
              if (!p.userId) p.userId = uid; // 历史数据补上 userId
              return true;
            });
            const removed = before - ud.projects.length;
            if (removed > 0) {
              console.warn(`[DataIsolation] loadData: removed ${removed} cross-user projects from user ${uid}`);
              this.saveData(); // 立即保存清理后的数据
            }
          }
        }
      }

      // 规范化图片 URL：将旧格式 /uploads/xxx 转换为 /api/serve-upload/uploads/xxx
      this.restoreProjectAdoptionState();
      this.normalizeImageUrls();
      // 持久化规范化后的 URL 到 localStorage，避免每次重复转换
      this.saveData();
    } catch (error) {
      console.error('Failed to load user data:', error);
      this.multiUserData = {
        users: [],
        userData: {}
      };
      this.ensureDefaultAdmin();
    }
  }

  /** 规范化图片 URL：将旧格式 /uploads/xxx 转换为 /api/serve-upload/uploads/xxx
   *  确保跨环境（开发/生产）和跨浏览器图片可访问 */
  private normalizeImageUrls(): void {
    if (!this.multiUserData) return;
    for (const userData of Object.values(this.multiUserData.userData)) {
      if (userData.projects) {
        for (const project of userData.projects) {
          if (project.canvasImages) {
            for (const img of project.canvasImages) {
              if (img.url && img.url.startsWith('/uploads/') && !img.url.startsWith('/api/')) {
                img.url = `/api/serve-upload${img.url}`;
              }
              // ★ blob: URL 跨会话不可用，但不清空（清空会导致自动保存时 .filter(img => img.url) 误删图片数据）
              // 保留原始 URL，浏览器渲染时 blob: URL 失效会显示为空白但不丢失元数据
              // data: URL 保留（当前会话可渲染），但标记为待持久化以便异步转存
              if (img.url && img.url.startsWith('blob:')) {
                // 不清空 URL，仅标记需要持久化
                (img as unknown as Record<string, unknown>)._needsPersist = true;
              } else if (img.url && img.url.startsWith('data:')) {
                // data: URL 在当前会话中可以正常渲染，保留但标记待持久化
                (img as unknown as Record<string, unknown>)._pendingPersist = true;
              }
              // 回填：历史数据 modelName 为空但 model 有值时，用 model 补充
              if ((!img.modelName || img.modelName === '') && img.model) {
                img.modelName = img.model;
              }
            }
          }
        }
      }
    }
  }

  private ensureDefaultAdmin(): void {
    if (!this.multiUserData) {
      this.multiUserData = { users: [], userData: {} };
    }

    const admin = this.multiUserData.users.find(u => u.name === DEFAULT_ADMIN_NAME) ?? {
        id: 'admin_mr_joker',
        name: DEFAULT_ADMIN_NAME,
        password: '',  // Password is managed server-side; client never stores it
        role: 'admin',
        status: 'active',
        apiPermissions: defaultApiPermissions(),
        storageFolder: userStorageFolder('admin_mr_joker'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    const isNewAdmin = !this.multiUserData.users.find(u => u.name === DEFAULT_ADMIN_NAME);
    if (isNewAdmin) {
      this.multiUserData.users.unshift(admin);
      this.multiUserData.userData[admin.id] = {
        user: admin,
        projects: this.createDemoProjects(),
        apiKeys: [],
        usageStats: [],
      };
      this.saveData();
      return;
    }

    const normalizedAdmin: User = {
      ...admin,
      password: admin.password || '',  // Password managed server-side
      role: 'admin',
      status: admin.status || 'active',
      apiPermissions: { ...defaultApiPermissions(), ...(admin.apiPermissions || {}) },
      storageFolder: admin.storageFolder?.startsWith('data/users/') ? admin.storageFolder : userStorageFolder(admin.id),
      updatedAt: Date.now(),
    };
    this.multiUserData.users = this.multiUserData.users.map(u => u.id === normalizedAdmin.id ? normalizedAdmin : {
      ...u,
      role: u.role || 'user',
      status: u.status || 'active',
      apiPermissions: { ...defaultApiPermissions(), ...(u.apiPermissions || {}) },
    });
    if (this.multiUserData.userData[normalizedAdmin.id]) {
      this.multiUserData.userData[normalizedAdmin.id].user = normalizedAdmin;
    }
    this.saveData();
  }

  private commitLocalDataOnly(authoritative = false): LocalDataCommitResult {
    if (!this.canUseStorage()) {
      return { ok: false, error: new Error('PROJECT_SYNC_STORAGE_UNAVAILABLE') };
    }

    try {
      let persistedData = this.multiUserData ?? undefined;
      if (this.multiUserData) {
        // ★ 图片数量断崖检测：保存前快照保护，防止bug导致图片被清空
        if (!authoritative) this.protectAgainstDataLoss();
        // ★ 保存到 localStorage 时，data: URL 可能导致配额溢出
        // 先尝试直接保存，如果配额不足则将 data: URL 替换为空字符串后重试
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.multiUserData));
        } catch {
          // localStorage 配额溢出，将 data:/blob: URL 替换为空字符串后重试
          console.warn('[saveData] localStorage quota exceeded, retrying without data:/blob: URLs');
          const trimmedData = JSON.parse(JSON.stringify(this.multiUserData));
          this.trimDataUrls(trimmedData);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedData));
            persistedData = trimmedData as MultiUserData;
          } catch (retryError) {
            console.error('[saveData] localStorage still exceeded after trimming data URLs:', retryError);
            return { ok: false, error: retryError };
          }
        }
      }
      if (this.currentUserId) {
        localStorage.setItem(CURRENT_USER_KEY, this.currentUserId);
      }
      return { ok: true, persistedData };
    } catch (error) {
      console.error('Failed to save user data:', error);
      return { ok: false, error };
    }

  }

  private saveData(): void {
    if (!this.canUseStorage()) return;
    this.commitLocalDataOnly();
    // 同步当前用户的项目数据到服务器数据库（防抖）
    this.scheduleServerSync();
  }

  /** 数据丢失保护：检测"大量图片突然清零"异常，写入快照备份并阻断空数据覆盖
   *  场景：bug 导致内存中 canvasImages 变成 []，但真实图片仍在服务器/文件系统
   *  策略：
   *   1. 记录上次已知的项目图片数快照（lastProjectImageCounts）
   *   2. 保存前比较：某项目此前 ≥10 张图、现在变成 0 → 判定异常，保留内存但不阻断
   *   3. 每次 save 都写一份最近 N=5 份 autosave 快照到 localStorage（__AUTOSAVE_KEY__）
   */
  private lastProjectImageCounts: Map<string, number> = new Map();
  private protectAgainstDataLoss(): void {
    try {
      if (!this.multiUserData?.userData) return;
      const AUTOSAVE_KEY = 'wujie_autosave_snapshots_v1';
      const MAX_SNAPSHOTS = 4;
      // 读取历史快照
      let snapshots: Array<{ t: number; payload: string }> = [];
      try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        if (raw) snapshots = JSON.parse(raw);
        if (!Array.isArray(snapshots)) snapshots = [];
      } catch { snapshots = []; }

      // 检测异常：如果某个项目从≥N张掉到0，标记，用快照数据修复
      for (const [uid, ud] of Object.entries(this.multiUserData.userData as unknown as Record<string, SnapshotUserData>)) {
        const projects = ud?.projects || [];
        for (const proj of projects) {
          const pid = typeof proj.id === 'string' ? proj.id : typeof proj.projectId === 'string' ? proj.projectId : '';
          if (!pid) continue;
          const current = (proj.canvasImages || []).length;
          const last = this.lastProjectImageCounts.get(pid) || 0;
          // 断崖：之前 ≥10 张 → 现在 0 张，且快照里有数据
          if (last >= 10 && current === 0) {
            console.warn(`[DataLossGuard] Project "${proj.name}"(${pid}) canvasImages dropped from ${last} to 0! Restoring from last snapshot...`);
            // 尝试在快照里找这个项目的非空数据
            for (const snap of snapshots.slice().reverse()) {
              try {
                const snapData = JSON.parse(snap.payload);
                const snapUd = snapData?.userData?.[uid];
                const snapProj = snapUd?.projects?.find((p: Record<string, unknown>) => (p.id || p.projectId) === pid);
                if (snapProj && (snapProj.canvasImages || []).length >= 10) {
                  proj.canvasImages = snapProj.canvasImages;
                  proj.updatedAt = Date.now();
                  break;
                }
              } catch {}
            }
          }
          if (current > 0) this.lastProjectImageCounts.set(pid, current);
        }
      }

      // 写新快照（在恢复后写，这样快照里是恢复后的健康数据）
      try {
        const snapshotData = JSON.parse(JSON.stringify(this.multiUserData));
        this.trimDataUrls(snapshotData);
        snapshots.push({ t: Date.now(), payload: JSON.stringify(snapshotData) });
        if (snapshots.length > MAX_SNAPSHOTS) snapshots = snapshots.slice(-MAX_SNAPSHOTS);
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshots));
      } catch (e) {
        // 快照写失败不影响主流程
        while (snapshots.length > 1) {
          snapshots = snapshots.slice(1);
          try {
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshots));
            return;
          } catch {
            // Keep evicting the oldest recovery point until a bounded snapshot fits.
          }
        }
        console.warn('[DataLossGuard] Failed to write autosave snapshot:', e);
      }
    } catch (e) {
      console.warn('[DataLossGuard] protector error:', e);
    }
  }

  /** 清理 data:/blob: URL 以避免 localStorage 配额溢出
   * 策略：对包含 data:/blob: URL 的图片，将 URL 清空为空字符串以释放空间
   * 同时标记 _needsPersist=true，以便后续 onProjectsChanged 合并时
   * 从本地数据恢复 URL（因为内存中的原始数据仍保留 data:/blob: URL）
   * 注意：此函数操作的是 data 的深拷贝（trimmedData），不影响内存中的原始数据
   */
  private trimDataUrls(data: Record<string, unknown>): void {
    if (!data || !data.userData) return;
    for (const ud of Object.values(data.userData as Record<string, { projects?: Array<{ canvasImages?: Array<{ url?: string; _needsPersist?: boolean }> }> }>)) {
      if (ud.projects) {
        for (const project of ud.projects) {
          if (project.canvasImages) {
            for (const img of project.canvasImages) {
              if (img.url && (img.url.startsWith('data:') || img.url.startsWith('blob:'))) {
                // 清空 URL 以释放 localStorage 空间
                img.url = '';
                // 标记为需要恢复，onProjectsChanged 合并时从本地数据恢复 URL
                img._needsPersist = true;
              }
            }
          }
        }
      }
    }
  }

  // ====== 服务器同步 ======
  private serverSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SYNC_DEBOUNCE_MS = 2000; // 2秒防抖

  private resetProjectSyncSession(): void {
    this._projectSyncSessionEpoch += 1;
    this._projectSyncRequestEpoch += 1;
    this._projectSyncRevision = 0;
    this._projectMutationGeneration = 0;
    this._recentlyDeletedImageIds.clear();
  }

  private beginProjectSyncRequest(): {
    userId: string;
    requestEpoch: number;
    sessionEpoch: number;
    revision: number;
    mutationGeneration: number;
    token: string;
  } | null {
    if (!this.currentUserId) return null;
    const requestEpoch = ++this._projectSyncRequestEpoch;
    const token = `${this._projectSyncSessionEpoch}:${requestEpoch}`;
    this._projectSyncInFlightTokens.add(token);
    return {
      userId: this.currentUserId,
      requestEpoch,
      sessionEpoch: this._projectSyncSessionEpoch,
      revision: this._projectSyncRevision,
      mutationGeneration: this._projectMutationGeneration,
      token,
    };
  }

  private isCurrentProjectSyncRequest(request: {
    userId: string;
    requestEpoch: number;
    sessionEpoch: number;
    mutationGeneration: number;
  }): boolean {
    return this.currentUserId === request.userId
      && this._projectSyncSessionEpoch === request.sessionEpoch
      && this._projectSyncRequestEpoch === request.requestEpoch
      && this._projectMutationGeneration === request.mutationGeneration;
  }

  getProjectSyncRevision(): number {
    return this._projectSyncRevision;
  }

  isProjectSyncInFlight(): boolean {
    const currentPrefix = `${this._projectSyncSessionEpoch}:`;
    return [...this._projectSyncInFlightTokens].some((token) => token.startsWith(currentPrefix));
  }

  private finishProjectSyncRequest(request: { token: string }): void {
    this._projectSyncInFlightTokens.delete(request.token);
  }

  private projectSyncStorageKey(prefix: string, userId: string): string {
    return `${prefix}${encodeURIComponent(userId)}`;
  }

  private readProjectAdoptionCommit(userId: string): ProjectAdoptionCommitEnvelope | undefined {
    if (!this.canUseStorage()) return undefined;
    const stored = localStorage.getItem(this.projectSyncStorageKey(PROJECT_ADOPTION_COMMIT_KEY_PREFIX, userId));
    if (!stored) return undefined;
    if (serializedByteLength(stored) > MAX_PROJECT_ADOPTION_COMMIT_BYTES) {
      throw new Error('PROJECT_SYNC_ADOPTION_COMMIT_TOO_LARGE');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error('PROJECT_SYNC_ADOPTION_COMMIT_INVALID');
    }
    if (
      !isRecord(parsed)
      || parsed.version !== PROJECT_ADOPTION_COMMIT_VERSION
      || parsed.userId !== userId
      || !Number.isSafeInteger(parsed.revision)
      || Number(parsed.revision) < 0
      || !['legacy', 'shadow', 'asset-v3'].includes(String(parsed.assetGraphMode))
      || !isValidProjectSnapshotArray(parsed.authoritativeBase, userId)
      || !isValidProjectSnapshotArray(parsed.adoptedDraft, userId)
      || !Array.isArray(parsed.conflictBackups)
      || parsed.conflictBackups.length > MAX_PROJECT_CONFLICT_BACKUPS
      || parsed.conflictBackups.some((entry) => !isValidConflictBackup(entry, userId))
      || !isFiniteNumber(parsed.updatedAt)
      || (parsed.pending !== undefined && (
        !isRecord(parsed.pending) || !isFiniteNumber(parsed.pending.startedAt)
      ))
    ) {
      throw new Error('PROJECT_SYNC_ADOPTION_COMMIT_INVALID');
    }
    return parsed as unknown as ProjectAdoptionCommitEnvelope;
  }

  private serializeProjectAdoptionCommit(
    envelope: ProjectAdoptionCommitEnvelope,
    requiredBackupCount = 0,
  ): string {
    if (requiredBackupCount > MAX_PROJECT_CONFLICT_BACKUPS) {
      throw new Error('PROJECT_SYNC_CONFLICT_BACKUP_TOO_LARGE');
    }
    const minimumRetained = Math.min(requiredBackupCount, envelope.conflictBackups.length);
    while (true) {
      const serialized = JSON.stringify(envelope);
      if (serializedByteLength(serialized) <= MAX_PROJECT_ADOPTION_COMMIT_BYTES) return serialized;
      if (envelope.conflictBackups.length <= minimumRetained) {
        throw new Error('PROJECT_SYNC_ADOPTION_COMMIT_TOO_LARGE');
      }
      envelope.conflictBackups.shift();
    }
  }

  private writeProjectAdoptionCommit(
    envelope: ProjectAdoptionCommitEnvelope,
    requiredBackupCount = 0,
  ): void {
    if (!this.canUseStorage()) throw new Error('PROJECT_SYNC_STORAGE_UNAVAILABLE');
    localStorage.setItem(
      this.projectSyncStorageKey(PROJECT_ADOPTION_COMMIT_KEY_PREFIX, envelope.userId),
      this.serializeProjectAdoptionCommit(envelope, requiredBackupCount),
    );
  }

  private settleProjectAdoptionCommit(envelope: ProjectAdoptionCommitEnvelope): void {
    const settled = { ...envelope, updatedAt: Date.now() };
    delete settled.pending;
    try {
      this.writeProjectAdoptionCommit(settled);
    } catch (error) {
      if (this.canUseStorage()) {
        try {
          localStorage.removeItem(
            this.projectSyncStorageKey(PROJECT_ADOPTION_COMMIT_KEY_PREFIX, envelope.userId),
          );
        } catch (removeError) {
          console.warn('[Sync] failed to clear unsettled project adoption commit:', removeError);
        }
      }
      throw error;
    }
  }

  private readPersistedAuthoritativeBase(userId: string): ProjectAuthoritativeBaseEnvelope | undefined {
    if (!this.canUseStorage()) return undefined;
    const stored = localStorage.getItem(this.projectSyncStorageKey(PROJECT_AUTHORITATIVE_BASE_KEY_PREFIX, userId));
    if (!stored) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error('PROJECT_SYNC_AUTHORITATIVE_BASE_INVALID');
    }
    if (
      !isRecord(parsed)
      || parsed.version !== PROJECT_SYNC_STORAGE_VERSION
      || parsed.userId !== userId
      || !Number.isSafeInteger(parsed.revision)
      || Number(parsed.revision) < 0
      || !isValidProjectSnapshotArray(parsed.projects, userId)
    ) {
      throw new Error('PROJECT_SYNC_AUTHORITATIVE_BASE_INVALID');
    }
    return parsed as unknown as ProjectAuthoritativeBaseEnvelope;
  }

  private readLegacyConflictBackups(userId: string): ProjectConflictBackup[] {
    if (!this.canUseStorage()) return [];
    const stored = localStorage.getItem(this.projectSyncStorageKey(PROJECT_CONFLICT_BACKUP_KEY_PREFIX, userId));
    if (!stored) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error('PROJECT_SYNC_CONFLICT_BACKUP_INVALID');
    }
    if (
      !isRecord(parsed)
      || parsed.version !== PROJECT_SYNC_STORAGE_VERSION
      || parsed.userId !== userId
      || !Array.isArray(parsed.entries)
      || parsed.entries.length > MAX_PROJECT_CONFLICT_BACKUPS
      || parsed.entries.some((entry) => !isValidConflictBackup(entry, userId))
    ) {
      throw new Error('PROJECT_SYNC_CONFLICT_BACKUP_INVALID');
    }
    return parsed.entries as unknown as ProjectConflictBackup[];
  }

  private restoreProjectAdoptionState(): void {
    const userId = this.currentUserId;
    const userData = userId ? this.multiUserData?.userData[userId] : undefined;
    if (!userId || !userData) return;
    try {
      const envelope = this.readProjectAdoptionCommit(userId);
      if (!envelope) return;
      if (envelope.pending) {
        userData.projects = cloneProjects(envelope.adoptedDraft);
        const recovery = this.commitLocalDataOnly(true);
        if (!recovery.ok) {
          console.warn('[Sync] failed to persist recovered project draft:', recovery.error);
        } else {
          try {
            this.settleProjectAdoptionCommit(envelope);
          } catch (error) {
            console.warn('[Sync] failed to settle recovered project adoption commit:', error);
          }
        }
      }
      this._projectSyncRevision = envelope.revision;
      this._assetGraphMode = envelope.assetGraphMode;
      this._lastAuthoritativeProjects.set(userId, cloneProjects(envelope.authoritativeBase));
    } catch (error) {
      console.warn('[Sync] ignored invalid project adoption commit during reload:', error);
    }
  }

  private hasPersistedProjectDraft(userId: string, projects: Project[]): boolean {
    if (!this.canUseStorage()) return false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;
      const parsed = JSON.parse(stored) as MultiUserData;
      return snapshotsEqual(parsed.userData?.[userId]?.projects, projects);
    } catch {
      return false;
    }
  }

  private commitProjectAdoption(input: {
    userId: string;
    revision: number;
    assetGraphMode: AssetGraphMode;
    authoritativeBase: Project[];
    adoptedDraft: Project[];
    requiredBackups: ProjectConflictBackup[];
  }): void {
    if (!this.canUseStorage()) throw new Error('PROJECT_SYNC_STORAGE_UNAVAILABLE');
    const userData = this.multiUserData?.userData[input.userId];
    if (!userData || this.currentUserId !== input.userId) throw new Error('PROJECT_SYNC_SESSION_CHANGED');
    if (
      !isValidProjectSnapshotArray(input.authoritativeBase, input.userId)
      || !isValidProjectSnapshotArray(input.adoptedDraft, input.userId)
    ) {
      throw new Error('PROJECT_SYNC_PROJECT_PAYLOAD_INVALID');
    }

    const existing = this.readProjectAdoptionCommit(input.userId);
    const legacyBase = existing ? undefined : this.readPersistedAuthoritativeBase(input.userId);
    const acceptedRevision = Math.max(
      this._projectSyncRevision,
      existing?.revision ?? 0,
      legacyBase?.revision ?? 0,
    );
    if (input.revision < acceptedRevision) throw new Error('PROJECT_SYNC_STALE_REVISION');

    const previousProjects = cloneProjects(userData.projects);
    const previousBase = cloneProjects(
      this._lastAuthoritativeProjects.get(input.userId)
      ?? existing?.authoritativeBase
      ?? legacyBase?.projects
      ?? [],
    );
    const previousBackups = (
      existing?.conflictBackups
      ?? this.readLegacyConflictBackups(input.userId)
    ).slice(-MAX_PROJECT_CONFLICT_BACKUPS);
    const prepared: ProjectAdoptionCommitEnvelope = {
      version: PROJECT_ADOPTION_COMMIT_VERSION,
      userId: input.userId,
      revision: acceptedRevision,
      assetGraphMode: existing?.assetGraphMode ?? this._assetGraphMode,
      authoritativeBase: previousBase,
      adoptedDraft: previousProjects,
      conflictBackups: previousBackups,
      updatedAt: Date.now(),
      pending: { startedAt: Date.now() },
    };

    this.writeProjectAdoptionCommit(prepared);
    try {
      userData.projects = cloneProjects(input.adoptedDraft);
      let persistedDraft = cloneProjects(input.adoptedDraft);
      if (!this.hasPersistedProjectDraft(input.userId, input.adoptedDraft)) {
        const mainCommit = this.commitLocalDataOnly(true);
        if (!mainCommit.ok) throw mainCommit.error ?? new Error('PROJECT_SYNC_DRAFT_PERSIST_FAILED');
        persistedDraft = cloneProjects(
          mainCommit.persistedData?.userData[input.userId]?.projects ?? input.adoptedDraft,
        );
      }
      const retainedExistingCount = Math.max(0, MAX_PROJECT_CONFLICT_BACKUPS - input.requiredBackups.length);
      const conflictBackups = [
        ...previousBackups.slice(-retainedExistingCount),
        ...input.requiredBackups,
      ];
      const committed: ProjectAdoptionCommitEnvelope = {
        version: PROJECT_ADOPTION_COMMIT_VERSION,
        userId: input.userId,
        revision: input.revision,
        assetGraphMode: input.assetGraphMode,
        authoritativeBase: cloneProjects(input.authoritativeBase),
        adoptedDraft: persistedDraft,
        conflictBackups,
        updatedAt: Date.now(),
      };
      this.writeProjectAdoptionCommit(committed, input.requiredBackups.length);

      userData.projects = persistedDraft;
      this._projectSyncRevision = input.revision;
      this._assetGraphMode = input.assetGraphMode;
      this._lastAuthoritativeProjects.set(input.userId, cloneProjects(input.authoritativeBase));
      this._serverSyncReady = true;
    } catch (error) {
      userData.projects = previousProjects;
      const rollback = this.commitLocalDataOnly(true);
      if (!rollback.ok) {
        console.warn('[Sync] project draft rollback will be completed from pending envelope on reload:', rollback.error);
      } else {
        try {
          this.settleProjectAdoptionCommit(prepared);
        } catch (settleError) {
          console.warn('[Sync] failed to settle rolled-back project adoption commit:', settleError);
        }
      }
      throw error;
    }
  }

  private markProjectMutation(): void {
    this._projectMutationGeneration += 1;
  }

  private scheduleServerSync(): void {
    if (typeof window === 'undefined') return;
    if (this.serverSyncTimer) clearTimeout(this.serverSyncTimer);
    this.serverSyncTimer = setTimeout(() => {
      this.serverSyncTimer = null;
      void this.syncToServer();
    }, UserManager.SYNC_DEBOUNCE_MS);
  }

  private buildProjectsSyncPayload(strict: boolean): Project[] | null {
    if (!this.currentUserId || !this.multiUserData) {
      if (strict) throw new Error('登录状态已失效，请重新登录');
      return null;
    }
    const userData = this.multiUserData.userData[this.currentUserId];
    if (!userData) {
      if (strict) throw new Error('当前用户项目数据不可用');
      return null;
    }
    if (!this._serverSyncReady) {
      if (strict) throw new Error('项目数据尚未完成服务器校验，请稍后重试');
      console.log('[Sync] project sync blocked until server data has loaded');
      return null;
    }

    const currentUserId = this.currentUserId;
    const projectsPayload = userData.projects
      .filter((project) => {
        if (project.userId && project.userId !== currentUserId) {
          console.warn(`[DataIsolation] project sync skipped cross-user project "${project.name}"`);
          return false;
        }
        return true;
      })
      .map((project) => ({
        ...project,
        userId: project.userId || currentUserId,
        canvasImages: serializeCanvasWorkspacePlacements(project.canvasImages),
      }));
    const payloadImageCount = projectsPayload.reduce((sum, project) => sum + (project.canvasImages?.length || 0), 0);
    const memoryImageCount = userData.projects.reduce((sum, project) => sum + (project.canvasImages?.length || 0), 0);
    if (memoryImageCount > 0 && payloadImageCount === 0) {
      const message = `项目同步已阻止：待提交快照缺少内存中的 ${memoryImageCount} 张图片`;
      if (strict) throw new Error(message);
      console.warn(`[Sync] ${message}`);
      return null;
    }
    return projectsPayload;
  }

  private applyProjectIdMap(projectIdMap: Record<string, string>): void {
    if (!this.currentUserId || !this.multiUserData || Object.keys(projectIdMap).length === 0) return;
    const userData = this.multiUserData.userData[this.currentUserId];
    if (!userData) return;
    userData.projects = userData.projects.map((project) => {
      const nextId = projectIdMap[project.id];
      if (!nextId) return project;
      const annotations = project.metadata?.annotationsV2;
      const nextMetadata = Array.isArray(annotations)
        ? {
            ...project.metadata,
            annotationsV2: annotations.map((annotation) => (
              annotation && typeof annotation === 'object'
                ? { ...annotation, projectId: nextId }
                : annotation
            )),
          }
        : project.metadata;
      return { ...project, id: nextId, metadata: nextMetadata, updatedAt: Date.now() };
    });
  }

  getAssetGraphMode(): AssetGraphMode {
    return this._assetGraphMode;
  }

  private applyAssetGraphMappings(
    assetGraphMappings: NonNullable<ProjectSyncResponse['assetGraphMappings']>,
    assetGraphUpdates: NonNullable<ProjectSyncResponse['assetGraphUpdates']>,
  ): void {
    if (
      !this.currentUserId
      || !this.multiUserData
      || (Object.keys(assetGraphMappings).length === 0 && Object.keys(assetGraphUpdates).length === 0)
    ) return;
    const userData = this.multiUserData.userData[this.currentUserId];
    if (!userData) return;
    let changed = false;
    userData.projects = userData.projects.map((project) => {
      const mappings = assetGraphMappings[project.id];
      const updates = assetGraphUpdates[project.id];
      if (!mappings && !updates) return project;
      let projectChanged = false;
      const canvasImages = project.canvasImages.map((image) => {
        const mapping = mappings?.[image.id];
        const update = updates?.[image.id];
        if (!mapping && !update) return image;
        const nextFields: Partial<CanvasImage> = {
          assetId: update?.assetId ?? mapping?.assetId,
          assetVersionId: update?.versionId ?? mapping?.versionId,
          placementId: update?.placementId ?? mapping?.placementId,
          ...(update ? {
            url: update.url,
            sourceUrl: update.sourceUrl ?? undefined,
            thumbnailUrl: update.thumbnailUrl ?? undefined,
            mediaAvailability: update.mediaAvailability,
            mediaErrorCode: update.mediaErrorCode ?? undefined,
            originalWidth: update.originalWidth,
            originalHeight: update.originalHeight,
          } : {}),
        };
        const fieldChanged = Object.entries(nextFields).some(([key, value]) => (
          image[key as keyof CanvasImage] !== value
        ));
        if (!fieldChanged) return image;
        changed = true;
        projectChanged = true;
        return { ...image, ...nextFields };
      });
      return projectChanged ? { ...project, canvasImages } : project;
    });
    void changed;
  }

  /** 强制将当前项目快照提交到数据库；任何失败都会抛错并阻断依赖该快照的操作。 */
  private acceptProjectSyncSuccess(data: ProjectSyncResponse, nextRevision: number): void {
    const userId = this.currentUserId;
    const userData = userId ? this.multiUserData?.userData[userId] : undefined;
    if (!userId || !userData) throw new Error('PROJECT_SYNC_SESSION_CHANGED');
    const projectsBeforeResponse = userData.projects;
    let candidateProjects: Project[];
    try {
      userData.projects = cloneProjects(projectsBeforeResponse);
      this.applyProjectIdMap(data.projectIdMap || {});
      this.applyAssetGraphMappings(data.assetGraphMappings || {}, data.assetGraphUpdates || {});
      candidateProjects = cloneProjects(userData.projects);
    } finally {
      userData.projects = projectsBeforeResponse;
    }
    this.commitProjectAdoption({
      userId,
      revision: nextRevision,
      assetGraphMode: this._assetGraphMode,
      authoritativeBase: candidateProjects,
      adoptedDraft: candidateProjects,
      requiredBackups: [],
    });
    this._recentlyDeletedImageIds.clear();
    this.notifyProjectsChanged();
  }

  async flushProjectsToServer(): Promise<ProjectSyncResult> {
    if (this.serverSyncTimer) {
      clearTimeout(this.serverSyncTimer);
      this.serverSyncTimer = null;
    }
    const projectsPayload = this.buildProjectsSyncPayload(true);
    if (!projectsPayload) {
      throw new Error('项目数据尚未准备完成');
    }
    const request = this.beginProjectSyncRequest();
    if (!request) throw new Error('登录状态已失效，请重新登录');
    try {
      const response = await fetch('/api/user-data/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(PROJECT_SYNC_TIMEOUT_MS)
          : undefined,
        body: JSON.stringify({ key: 'projects', value: projectsPayload, projectRevision: request.revision }),
      });
      const data = await response.json().catch(() => null) as ProjectSyncResponse | null;
      if (!this.isCurrentProjectSyncRequest(request)) {
        return { projectIdMap: {} };
      }
      if (
        response.status === 409
        && Number.isSafeInteger(data?.currentRevision)
        && Number(data?.currentRevision) >= 0
      ) {
        throw new ProjectSyncConflictError(Number(data?.currentRevision));
      }
      if (!response.ok || !data?.success) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('登录状态已失效，请重新登录');
        }
        throw new Error(data?.error || `项目数据库同步失败 (${response.status})`);
      }
      const projectIdMap = data.projectIdMap && typeof data.projectIdMap === 'object'
        ? data.projectIdMap
        : {};
      const nextRevision = Number.isSafeInteger(data.projectRevision) && Number(data.projectRevision) >= 0
        ? Number(data.projectRevision)
        : this._projectSyncRevision;
      this.acceptProjectSyncSuccess(data, nextRevision);
      return { projectIdMap };
    } finally {
      this.finishProjectSyncRequest(request);
    }
  }

  /** 将当前用户的项目数据同步到服务器数据库
   * @param immediate 是否立即同步（跳过防抖），用于删除等关键操作
   * @param silent 静默模式（退出登录时使用），不向 console.error 输出 fetch 失败
   */
  private async syncToServer(
    immediate: boolean = false,
    silent: boolean = false,
  ): Promise<void> {
    let requestToken: { token: string } | null = null;
    try {
      const projectsPayload = this.buildProjectsSyncPayload(false);
      if (!projectsPayload) return;
      const request = this.beginProjectSyncRequest();
      if (!request) return;
      requestToken = request;
      const syncRes = await fetch('/api/user-data/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: immediate,
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(PROJECT_SYNC_TIMEOUT_MS)
          : undefined,
        body: JSON.stringify({ key: 'projects', value: projectsPayload, projectRevision: request.revision }),
      });
      const data = await syncRes.json().catch(() => null) as ProjectSyncResponse | null;
      if (!this.isCurrentProjectSyncRequest(request)) return;
      if (syncRes.status === 409) {
        console.warn('[Sync] syncToServer: conflict; local draft retained for explicit resolution');
        return;
      }
      if (!syncRes.ok) {
        console.warn('[Sync] syncToServer: server returned', syncRes.status);
      } else {
        if (data?.success) {
          const nextRevision = Number.isSafeInteger(data.projectRevision) && Number(data.projectRevision) >= 0
            ? Number(data.projectRevision)
            : this._projectSyncRevision;
          this.acceptProjectSyncSuccess(data, nextRevision);
          console.log('[Sync] syncToServer: success, projects=', projectsPayload.length);
        } else {
          console.warn('[Sync] syncToServer: invalid success response');
        }
      }
    } catch (error) {
      if (!silent) {
        console.error('[Sync] syncToServer error:', error);
      }
    } finally {
      if (requestToken) this.finishProjectSyncRequest(requestToken);
    }
  }

  private parseServerProjects(value: unknown, userId: string): Project[] | null {
    let parsed = value;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed) as unknown;
      } catch {
        return null;
      }
    }
    if (!Array.isArray(parsed)) return null;
    const normalized: Project[] = [];
    for (const rawProject of parsed) {
      if (!isRecord(rawProject)) return null;
      if (rawProject.userId !== undefined) {
        if (typeof rawProject.userId !== 'string') return null;
        if (rawProject.userId !== userId) continue;
      }
      if (rawProject.settings !== undefined && !isRecord(rawProject.settings)) return null;
      const read = readProjectSnapshot(rawProject);
      if (!read.project || read.sourceSchemaVersion === null) return null;

      const projectRecord = read.project as unknown as Record<string, unknown>;
      const createdAt = projectRecord.createdAt === undefined ? 0 : projectRecord.createdAt;
      const updatedAt = projectRecord.updatedAt === undefined ? createdAt : projectRecord.updatedAt;
      const canvasImages = read.project.canvasImages.map((image, index) => {
        const imageRecord = image as unknown as Record<string, unknown>;
        const width = imageRecord.width === undefined
          ? (imageRecord.originalWidth === undefined ? 1 : imageRecord.originalWidth)
          : imageRecord.width;
        const height = imageRecord.height === undefined
          ? (imageRecord.originalHeight === undefined ? 1 : imageRecord.originalHeight)
          : imageRecord.height;
        return {
          ...image,
          x: imageRecord.x === undefined ? 0 : imageRecord.x,
          y: imageRecord.y === undefined ? 0 : imageRecord.y,
          width,
          height,
          originalWidth: imageRecord.originalWidth === undefined ? width : imageRecord.originalWidth,
          originalHeight: imageRecord.originalHeight === undefined ? height : imageRecord.originalHeight,
          rotation: imageRecord.rotation === undefined ? 0 : imageRecord.rotation,
          zIndex: imageRecord.zIndex === undefined ? index : imageRecord.zIndex,
          createdAt: imageRecord.createdAt === undefined ? createdAt : imageRecord.createdAt,
        } as CanvasImage;
      });
      normalized.push({
        ...read.project,
        userId,
        name: projectRecord.name === undefined ? '' : read.project.name,
        schemaVersion: read.sourceSchemaVersion,
        createdAt: createdAt as number,
        updatedAt: updatedAt as number,
        settings: read.project.settings,
        canvasImages,
      });
    }
    return isValidProjectSnapshotArray(normalized, userId) ? normalized : null;
  }

  /** 从服务器加载当前用户的项目数据 */
  async loadProjectsFromServer(retryCount = 1, expectedUserId: string | null = this.currentUserId): Promise<boolean> {
    if (!expectedUserId || !this.multiUserData) return false;
    const activeUserData = this.multiUserData.userData[expectedUserId];
    if (!activeUserData) return false;
    const request = this.beginProjectSyncRequest();
    if (!request || request.userId !== expectedUserId) {
      if (request) this.finishProjectSyncRequest(request);
      return false;
    }
    const userData: UserData = { ...activeUserData, projects: cloneProjects(activeUserData.projects) };

    try {
      const res = await fetch('/api/user-data/sync?key=projects', {
        credentials: 'include',
        signal: AbortSignal.timeout(PROJECT_SYNC_TIMEOUT_MS),
      });
      if (!this.isCurrentProjectSyncRequest(request)) return false;
      if (!res.ok) {
        console.warn('[Sync] loadProjectsFromServer: server returned', res.status);
        // 重试：登录后 session cookie 可能尚未生效
        if (retryCount > 0) {
          await new Promise(r => setTimeout(r, 1000));
          return this.loadProjectsFromServer(retryCount - 1, expectedUserId);
        }
        return false;
      }
      const data = await res.json() as {
        success: boolean;
        value?: unknown;
        assetGraphMode?: AssetGraphMode;
        projectRevision?: number;
      };
      if (!this.isCurrentProjectSyncRequest(request)) return false;
      if (!data.success) {
        if (retryCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.loadProjectsFromServer(retryCount - 1, expectedUserId);
        }
        console.warn('[Sync] loadProjectsFromServer: unsuccessful response', data);
        return false;
      }
      const nextAssetGraphMode = data.assetGraphMode === 'shadow' || data.assetGraphMode === 'asset-v3'
        ? data.assetGraphMode
        : 'legacy';
      const nextProjectSyncRevision = Number.isSafeInteger(data.projectRevision) && Number(data.projectRevision) >= 0
        ? Number(data.projectRevision)
        : 0;
      const persistedCommit = this.readProjectAdoptionCommit(expectedUserId);
      const persistedLegacyBase = persistedCommit
        ? undefined
        : this.readPersistedAuthoritativeBase(expectedUserId);
      const acceptedRevision = Math.max(
        request.revision,
        this._projectSyncRevision,
        persistedCommit?.revision ?? 0,
        persistedLegacyBase?.revision ?? 0,
      );
      if (nextProjectSyncRevision < acceptedRevision) return false;

      if (data.value === undefined || data.value === null) {
        // A missing record is a valid first-login state, not a failed sync.
        this.commitProjectAdoption({
          userId: expectedUserId,
          revision: nextProjectSyncRevision,
          assetGraphMode: nextAssetGraphMode,
          authoritativeBase: [],
          adoptedDraft: userData.projects,
          requiredBackups: [],
        });
        await this.syncToServer();
        return true;
      }

      const serverProjects = this.parseServerProjects(data.value, expectedUserId);
      if (!serverProjects) return false;

      if (serverProjects.length === 0 && userData.projects.length === 0) {
        console.log('[Sync] loadProjectsFromServer: both local and server empty');
        this.commitProjectAdoption({
          userId: expectedUserId,
          revision: nextProjectSyncRevision,
          assetGraphMode: nextAssetGraphMode,
          authoritativeBase: [],
          adoptedDraft: [],
          requiredBackups: [],
        });
        return true;
      }

      // 【数据隔离】过滤掉不属于当前用户的项目（防御性检查，防止跨用户数据泄漏）
      const currentUserId = expectedUserId;
      // 严格用户隔离：仅保留当前用户的项目
      // - 有 userId 的项目必须匹配当前用户
      // - 无 userId 的旧数据（历史遗留）补上当前用户ID后保留
      const localProjectsFiltered = userData.projects.filter(p => {
        if (p.userId && p.userId !== currentUserId) return false;
        if (!p.userId) p.userId = currentUserId;
        return true;
      });

      // 字段名兼容：服务器/本地数据可能使用 'images'（旧字段名）或 'canvasImages'（新字段名）
      // 统一归一化为 canvasImages
      for (const p of serverProjects) {
        const legacyImages = (p as Project & { images?: Project['canvasImages'] }).images;
        if (!p.canvasImages && legacyImages) {
          p.canvasImages = legacyImages;
        }
        // 确保canvasImages是数组
        if (!Array.isArray(p.canvasImages)) {
          p.canvasImages = [];
        }
      }
      for (const p of userData.projects) {
        const legacyImages = (p as Project & { images?: Project['canvasImages'] }).images;
        if (!p.canvasImages && legacyImages) {
          p.canvasImages = legacyImages;
        }
        if (!Array.isArray(p.canvasImages)) {
          p.canvasImages = [];
        }
      }
      for (const p of localProjectsFiltered) {
        const legacyImages = (p as Project & { images?: Project['canvasImages'] }).images;
        if (!p.canvasImages && legacyImages) {
          p.canvasImages = legacyImages;
        }
        if (!Array.isArray(p.canvasImages)) {
          p.canvasImages = [];
        }
      }

      // 【数据隔离增强】跨用户ID冲突检测
      // 如果某个项目ID同时出现在其他用户的数据槽中，说明该数据已被污染
      // 此时应以服务器数据为准，本地该项目不可信
      const otherUserProjectIds = new Set<string>();
      if (this.multiUserData) {
        for (const uid of Object.keys(this.multiUserData.userData)) {
          if (uid === currentUserId) continue;
          const otherProjects = this.multiUserData.userData[uid]?.projects || [];
          for (const op of otherProjects) {
            if (op.id) otherUserProjectIds.add(op.id);
          }
        }
      }
      if (otherUserProjectIds.size > 0) {
        const beforeConflict = localProjectsFiltered.length;
        const conflictIds: string[] = [];
        // 检查本地项目是否与其他用户的项目ID冲突
        for (let i = localProjectsFiltered.length - 1; i >= 0; i--) {
          const p = localProjectsFiltered[i];
          if (otherUserProjectIds.has(p.id)) {
            conflictIds.push(p.id);
            // 如果该项目的服务器版本不存在，说明该项目不属于当前用户
            if (!serverProjects.some(sp => sp.id === p.id)) {
              localProjectsFiltered.splice(i, 1);
            }
            // 如果服务器版本存在，保留本地版本（当前用户确实有这个项目）
          }
        }
        if (conflictIds.length > 0) {
          console.warn(`[DataIsolation] cross-user project ID conflict detected: ${conflictIds.join(', ')}. Filtered local projects: ${beforeConflict} → ${localProjectsFiltered.length}`);
        }
      }

      const inMemoryBase = this._lastAuthoritativeProjects.get(currentUserId);
      const authoritativeBase = inMemoryBase
        ?? persistedCommit?.authoritativeBase
        ?? persistedLegacyBase?.projects;
      let requiredBackups: ProjectConflictBackup[] = [];
      if (authoritativeBase) {
        const rebase = rebaseProjectSnapshots(
          authoritativeBase,
          localProjectsFiltered,
          serverProjects,
          currentUserId,
        );
        requiredBackups = rebase.conflicts;
        userData.projects = rebase.projects;
      } else {
      // 合并策略：按项目 ID 合并，保留更新时间更晚的版本
      const localHasData = localProjectsFiltered.length > 0;
      const serverHasData = serverProjects.length > 0;

      if (!localHasData && serverHasData) {
        // 本地无数据，直接使用服务器数据，但回填 modelName（历史数据可能缺失）
        for (const sp of serverProjects) {
          for (const img of sp.canvasImages) {
            if ((!img.modelName || img.modelName === '') && img.model) {
              img.modelName = img.model;
            }
          }
        }
        userData.projects = serverProjects;
      } else if (localHasData && serverHasData) {
        // 双方都有数据，按项目 ID 逐个合并
        // 关键修复：不再用 "updatedAt 更大者覆盖" 策略（会丢失另一方的图片），
        // 而是对 canvasImages 按图片 ID 做并集合并，确保双方图片都不丢失
        // 【数据隔离】使用过滤后的本地项目列表
        const localProjectMap = new Map(localProjectsFiltered.map(p => [p.id, p]));
        const mergedProjects: Project[] = [];
        for (const sp of serverProjects) {
          const lp = localProjectMap.get(sp.id);
          if (lp) {
            // 同 ID 项目：合并 canvasImages（按图片 ID 去重，保留双方全部图片）
            const localImgMap = new Map(lp.canvasImages.map(img => [img.id, img]));
            const serverImgMap = new Map(sp.canvasImages.map(img => [img.id, img]));
            // 以服务器版本为基础，补充本地独有的图片
            // ★ 关键修复：对于本地和服务器都存在的图片，进行字段级合并
            // 服务器可能缺少 modelName/apiProvider 等字段（历史遗留），
            // 此时保留本地非空值，避免每次30秒同步都丢失这些字段
            const mergedImages = sp.canvasImages
              .filter(sImg => !this.isRecentlyDeletedImage(sImg.id)) // ★ 过滤掉最近删除的图片
              .map(sImg => {
              const lImg = localImgMap.get(sImg.id);
              const enriched = { ...sImg };
              // 回填：历史数据 modelName 为空但 model 有值时，用 model 补充
              if ((!enriched.modelName || enriched.modelName === '') && enriched.model) {
                enriched.modelName = enriched.model;
              }
              if (!lImg) return enriched;
              // ★ BUG3 关键修复：从本地恢复被 trimDataUrls 清空的 URL
              // 服务器同步下来的数据 URL 可能为空（trimDataUrls 为节省 localStorage 配额而清空）
              // 必须从本地内存数据恢复，否则图片会从画布消失
              if ((!enriched.url || enriched.url === '') && lImg.url) {
                enriched.url = lImg.url;
                if (enriched._needsPersist) {
                  delete (enriched as Record<string, unknown>)._needsPersist;
                }
              }
              // ★ 关键修复：保留本地的位置信息（x, y, width, height）
              // 用户可能在本地拖动了图片，但服务器还没同步到最新位置
              // 优先使用本地的位置数据，避免图片"回位"
              if (lImg.x !== undefined) enriched.x = lImg.x;
              if (lImg.y !== undefined) enriched.y = lImg.y;
              if (lImg.width !== undefined) enriched.width = lImg.width;
              if (lImg.height !== undefined) enriched.height = lImg.height;
              // 逐字段检查，从本地补充服务器缺失的字段
              if ((!enriched.modelName || enriched.modelName === '') && lImg.modelName) {
                enriched.modelName = lImg.modelName;
              }
              if ((!enriched.apiProvider || enriched.apiProvider === '') && lImg.apiProvider) {
                enriched.apiProvider = lImg.apiProvider;
              }
              if ((!enriched.model || enriched.model === '') && lImg.model) {
                enriched.model = lImg.model;
              }
              if (!enriched.originalWidth && lImg.originalWidth) {
                enriched.originalWidth = lImg.originalWidth;
              }
              if (!enriched.originalHeight && lImg.originalHeight) {
                enriched.originalHeight = lImg.originalHeight;
              }
              if ((!enriched.apiBaseUrl || enriched.apiBaseUrl === '') && lImg.apiBaseUrl) {
                enriched.apiBaseUrl = lImg.apiBaseUrl;
              }
              return enriched;
            });
            for (const [imgId, img] of localImgMap) {
              if (!serverImgMap.has(imgId) && !this.isRecentlyDeletedImage(imgId)) {
                mergedImages.push(img);
              }
            }
            // ★ 防止僵尸任务恢复：过滤掉已失败/取消/错误的处理占位框
            // 服务器可能保存了旧状态的占位框（如 queued→服务器→failed→用户删除），
            // 合并时这些占位框会从服务器端被恢复，导致已删除的失败任务重新出现。
            // 这里按 id 统一过滤，确保任何来源的终端状态占位框都不会被合并。
            const terminalProcessingStatuses = new Set(['failed', 'cancelled', 'error']);
            const filteredMergedImages = mergedImages.filter(img => {
              if (!img.isProcessingPlaceholder) return true;
              const status = img.processing?.status as string | undefined;
              // 终端状态：已失败/取消/错误 → 永不恢复
              if (status && terminalProcessingStatuses.has(status)) return false;
              // 非终端状态(queued/processing)但本地没有对应图片 → 说明本地已删除，服务器数据是过期的
              if (status && !localImgMap.has(img.id)) {
                console.log(`[Sync] merge: filtered out stale processing placeholder ${img.id} (status=${status}, missing in local)`);
                return false;
              }
              return true;
            });
            if (filteredMergedImages.length < mergedImages.length) {
              console.log(`[Sync] merge: filtered out ${mergedImages.length - filteredMergedImages.length} terminal processing placeholders`);
            }
            // 用过滤后的数组替换
            mergedImages.length = 0;
            mergedImages.push(...filteredMergedImages);
            // 取双方较新的 updatedAt
            const localTime = lp.updatedAt || lp.createdAt || 0;
            const serverTime = sp.updatedAt || sp.createdAt || 0;
            const selectedImages = selectCanvasPlacementSnapshot(
              nextAssetGraphMode,
              sp.canvasImages,
              () => mergedImages,
            );
            const baseProject: Project = serverTime >= localTime
              ? { ...sp, canvasImages: selectedImages }
              : { ...lp, canvasImages: selectedImages, updatedAt: Math.max(localTime, serverTime) };
            // 补充合并 metadata.groups（按 group ID 并集）
            if (lp.metadata?.groups || sp.metadata?.groups) {
              const localGroups = new Map(((lp.metadata?.groups ?? []) as ImageGroupData[]).map(g => [g.id, g]));
              const serverGroups = ((sp.metadata?.groups ?? []) as ImageGroupData[]);
              const mergedGroups = [...serverGroups];
              for (const [gid, g] of localGroups) {
                if (!mergedGroups.some(mg => mg.id === gid)) {
                  mergedGroups.push(g);
                }
              }
              baseProject.metadata = { ...baseProject.metadata, groups: mergedGroups };
            }
            mergedProjects.push(baseProject);
            localProjectMap.delete(sp.id);
          } else {
            // 服务器独有的项目，直接添加
            mergedProjects.push(sp);
          }
        }
        // 保留本地独有的项目
        for (const lp of localProjectMap.values()) {
          mergedProjects.push(lp);
        }
        userData.projects = mergedProjects;
      }
      // 如果只有本地数据，不做任何修改
      }

      // 规范化图片 URL：将旧格式 /uploads/xxx 转换为 /api/serve-upload/uploads/xxx
      // 确保跨环境（开发/生产）和跨浏览器图片可访问
      for (const project of userData.projects) {
        if (project.canvasImages) {
          for (const img of project.canvasImages) {
            if (img.url && img.url.startsWith('/uploads/') && !img.url.startsWith('/api/')) {
              img.url = `/api/serve-upload${img.url}`;
            }
          }
        }
      }

      if (!this.isCurrentProjectSyncRequest(request)) return false;
      this.commitProjectAdoption({
        userId: currentUserId,
        revision: nextProjectSyncRevision,
        assetGraphMode: nextAssetGraphMode,
        authoritativeBase: serverProjects,
        adoptedDraft: userData.projects,
        requiredBackups,
      });
      this.notifyProjectsChanged(); // 通知 UI 刷新
      // ★ 调试日志：帮助追踪数据恢复
      const totalImages = userData.projects.reduce((sum, p) => sum + (p.canvasImages?.length || 0), 0);
      console.log('[Sync] loadProjectsFromServer: server=', serverProjects.length, 'local=', userData.projects.length, 'totalImages=', totalImages);
      for (const p of userData.projects) {
        console.log('[Sync] project:', p.id, p.name, 'canvasImages:', p.canvasImages?.length || 0);
      }
      return true;
    } catch (error) {
      // Downgrade to warn: fetch failures during session teardown (logout/reload) are expected, not code errors
      console.warn('[Sync] loadProjectsFromServer error:', error);
      if (retryCount > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return this.loadProjectsFromServer(retryCount - 1, expectedUserId);
      }
      return false;
    } finally {
      this.finishProjectSyncRequest(request);
    }
  }

  private async syncAdminUserAction(
    action: 'create' | 'update' | 'delete',
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, ...payload }),
      });
    } catch {
      // Local state remains the immediate source of truth in the browser.
    }
  }

  async upsertUserFromServer(user: User, password?: string): Promise<User> {
    if (!this.multiUserData) {
      this.multiUserData = { users: [], userData: {} };
    }

    const nextUser: User = {
      ...user,
      password: password ?? user.password,
      role: user.role || 'user',
      status: user.status || 'active',
      apiPermissions: { ...defaultApiPermissions(), ...(user.apiPermissions || {}) },
      storageFolder: user.storageFolder?.startsWith('data/users/') ? user.storageFolder : userStorageFolder(user.id),
      updatedAt: user.updatedAt || Date.now(),
    };

    const index = this.multiUserData.users.findIndex(existing => existing.id === nextUser.id);
    if (index === -1) {
      this.multiUserData.users.unshift(nextUser);
    } else {
      this.multiUserData.users[index] = nextUser;
    }

    const isExistingUser = !!this.multiUserData.userData[nextUser.id];
    const existingLocalProjects = isExistingUser
      ? [...(this.multiUserData.userData[nextUser.id].projects || [])]
      : [];

    if (!isExistingUser) {
      this.multiUserData.userData[nextUser.id] = {
        user: nextUser,
        projects: existingLocalProjects,
        apiKeys: [],
        usageStats: [],
      };
    } else {
      this.multiUserData.userData[nextUser.id].user = nextUser;
      // 保留本地项目数据作为兜底，等服务器加载后合并（loadProjectsFromServer会做merge）
      // 不再无条件清空本地数据，防止服务器加载失败导致用户图片丢失
    }

    // 始终尝试从服务器加载项目数据（解决跨设备同步问题）
    this.resetProjectSyncSession();
    this.currentUserId = nextUser.id;
    if (this.serverSyncTimer) {
      clearTimeout(this.serverSyncTimer);
      this.serverSyncTimer = null;
    }
    this._serverSyncReady = false;
    const syncUserId = nextUser.id;
    const fallbackMutationGeneration = this._projectMutationGeneration;
    void this.loadProjectsFromServer(1, syncUserId).then(loadSuccess => {
      // Do not let a delayed sync for a previous account change the next account's data.
      if (
        !loadSuccess
        && this.currentUserId === syncUserId
        && this._projectMutationGeneration === fallbackMutationGeneration
        && existingLocalProjects.length > 0
      ) {
        const activeUserData = this.multiUserData?.userData[syncUserId];
        if (activeUserData) {
          activeUserData.projects = existingLocalProjects;
          this.notifyProjectsChanged();
        }
      }
    }).catch(error => {
      console.warn('[Sync] background project sync error:', error);
    });

    this.saveData();
    return nextUser;
  }

  private getCurrentUserData(): UserData | null {
    if (!this.currentUserId || !this.multiUserData) {
      return null;
    }
    return this.multiUserData.userData[this.currentUserId] || null;
  }

  // 用户相关方法
  getAllUsers(): User[] {
    return this.multiUserData?.users || [];
  }

  isCurrentAdmin(): boolean {
    return this.getUser()?.role === 'admin';
  }

  login(name: string, password: string): User | null {
    this.ensureDefaultAdmin();
    const user = this.multiUserData?.users.find(u => u.name === name);
    if (!user || user.status === 'disabled') return null;
    if ((user.password || '') !== password) return null;

    // ★ 数据隔离：登录时不清空本地项目缓存，由 loadProjectsFromServer 负责合并/替换
    // 如果 loadProjectsFromServer 失败，保留本地数据作为兜底
    // 跨用户数据泄露由 loadProjectsFromServer 中的 userId 过滤逻辑防护
    // 取消待执行的同步定时器（来自上一个用户的）
    if (this.serverSyncTimer) {
      clearTimeout(this.serverSyncTimer);
      this.serverSyncTimer = null;
    }
    this._serverSyncReady = false; // 重置同步状态，需要重新从服务器加载

    this.resetProjectSyncSession();
    this.currentUserId = user.id;
    this.saveData();
    return user;
  }

  createUser(name: string, email?: string, password: string = '123456'): User {
    if (!this.multiUserData) {
      this.multiUserData = {
        users: [],
        userData: {}
      };
    }

    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const user: User = {
      id: userId,
      name,
      password,
      role: 'user',
      status: 'active',
      apiPermissions: defaultApiPermissions(),
      storageFolder: userStorageFolder(userId),
      email,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    user.storageFolder = userStorageFolder(userId);

    // 添加到用户列表
    this.multiUserData.users.unshift(user);

    // 初始化用户数据
    this.multiUserData.userData[user.id] = {
      user,
      projects: [],
      apiKeys: [],
      usageStats: [],
    };

    // 设置为当前用户
    this.resetProjectSyncSession();
    this.currentUserId = user.id;

    this.saveData();
    return user;
  }

  adminCreateUser(name: string, password: string, email?: string): User {
    if (!this.isCurrentAdmin()) throw new Error('Only administrator can create users');
    const previousUserId = this.currentUserId;
    const user = this.createUser(name, email, password);
    this.resetProjectSyncSession();
    this.currentUserId = previousUserId;
    this.saveData();
    void this.syncAdminUserAction('create', { name, password, email });
    return user;
  }

  adminUpdateUser(userId: string, updates: Partial<User>): User | null {
    if (!this.isCurrentAdmin()) throw new Error('Only administrator can update users');
    if (!this.multiUserData) return null;
    const index = this.multiUserData.users.findIndex(u => u.id === userId);
    if (index === -1) return null;
    const current = this.multiUserData.users[index];
    if (current.role === 'admin' && current.name === DEFAULT_ADMIN_NAME && updates.role && updates.role !== 'admin') {
      throw new Error('Default administrator role cannot be changed');
    }
    const next = { ...current, ...updates, updatedAt: Date.now() };
    this.multiUserData.users[index] = next;
    if (this.multiUserData.userData[userId]) {
      this.multiUserData.userData[userId].user = next;
    }
    this.saveData();
    void this.syncAdminUserAction('update', { userId, updates });
    return next;
  }

  adminDeleteUser(userId: string): boolean {
    if (!this.isCurrentAdmin()) throw new Error('Only administrator can delete users');
    const user = this.multiUserData?.users.find(u => u.id === userId);
    if (user?.role === 'admin' && user.name === DEFAULT_ADMIN_NAME) return false;
    const deleted = this.deleteUser(userId);
    if (deleted) {
      void this.syncAdminUserAction('delete', { userId });
    }
    return deleted;
  }

  deleteUser(userId: string): boolean {
    if (!this.multiUserData) return false;
    const userIndex = this.multiUserData.users.findIndex(u => u.id === userId);
    if (userIndex === -1) return false;

    // ?????????
    delete this.multiUserData.userData[userId];
    // ????????????
    this.multiUserData.users.splice(userIndex, 1);

    // ??????????????????????????
    if (this.currentUserId === userId) {
      this.resetProjectSyncSession();
      this.currentUserId = null;
      if (this.canUseStorage()) {
        localStorage.removeItem(CURRENT_USER_KEY);
      }
    }

    this.saveData();
    return true;
  }  setCurrentUser(userId: string): boolean {
    if (!this.multiUserData) return false;
    const user = this.multiUserData.users.find(u => u.id === userId);
    if (!user || user.status === 'disabled') return false;

    if (this.currentUserId !== userId) this.resetProjectSyncSession();
    this.currentUserId = userId;
    this.saveData();
    return true;
  }

  getCurrentUserId(): string | null {
    return this.currentUserId || null;
  }

  getUser(): User | null {
    const userData = this.getCurrentUserData();
    return userData?.user || null;
  }

  updateUser(name: string, email?: string): User | null {
    const userData = this.getCurrentUserData();
    if (!userData?.user) return null;
    if (userData.user.role !== 'admin') return userData.user;

    userData.user = {
      ...userData.user,
      name,
      email,
      updatedAt: Date.now(),
    };

    // 同时更新用户列表中的信息
    if (this.multiUserData) {
      const userIndex = this.multiUserData.users.findIndex(u => u.id === userData.user.id);
      if (userIndex !== -1) {
        this.multiUserData.users[userIndex] = { ...userData.user };
      }
    }

    this.saveData();
    return userData.user;
  }

  // 项目相关方法
  createProject(name: string, description?: string): Project {
    const userData = this.getCurrentUserData();
    if (!userData?.user) {
      throw new Error('No user found');
    }

    const project: Project = {
      id: `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: userData.user.id,
      name,
      description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      canvasImages: [],
      settings: {
        themeStyle: 'gold',
      },
    };

    userData.projects.unshift(project);
    this.markProjectMutation();
    this.saveData();
    return project;
  }

  private createDemoProjects(): Project[] {
    const now = Date.now();
    const sampleImages: Project['canvasImages'] = [
      {
        id: 'demo-1',
        url: 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=800&q=80',
        prompt: '美丽的山景，日落时分',
        x: 100, y: 100, width: 400, height: 300,
        originalWidth: 400, originalHeight: 300, rotation: 0, zIndex: 1,
        createdAt: now - 60000,
        mediaType: 'image' as const,
      },
      {
        id: 'demo-2',
        url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
        prompt: '阿尔卑斯山脉，雪峰',
        x: 550, y: 200, width: 400, height: 267,
        originalWidth: 400, originalHeight: 267, rotation: 0, zIndex: 2,
        createdAt: now - 30000,
        mediaType: 'image' as const,
      },
    ];
    return [
      {
        id: 'demo-project',
        userId: this.currentUserId || 'demo',
        name: '示例项目',
        canvasImages: sampleImages,
        createdAt: now,
        updatedAt: now,
        settings: {},
        metadata: { groups: [] },
      },
      {
        id: 'empty-canvas',
        userId: this.currentUserId || 'demo',
        name: '空画布',
        canvasImages: [],
        createdAt: now,
        updatedAt: now,
        settings: {},
        metadata: { groups: [] },
      },
    ];
  }

  getProjects(): Project[] {
    const userData = this.getCurrentUserData();
    const projects = userData?.projects || [];
    // 如果用户项目为空，返回默认示例项目
    if (projects.length === 0) {
      return this.createDemoProjects();
    }
    // 智能排序：优先展示有图片的项目，其次按更新时间倒序
    // 避免空项目（如"测试项目"）排在最前面导致用户以为数据丢失
    return [...projects].sort((a, b) => {
      const aHasImgs = (a.canvasImages?.length || 0) > 0;
      const bHasImgs = (b.canvasImages?.length || 0) > 0;
      if (aHasImgs !== bHasImgs) return aHasImgs ? -1 : 1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  /** 获取默认应该选中的项目ID（优先选有图片的最新项目） */
  getDefaultProjectId(): string | null {
    const projects = this.getProjects();
    if (projects.length === 0) return null;
    // getProjects 已按"有图优先 + 时间倒序"排好，取第一个
    return projects[0].id;
  }

  getProject(projectId: string): Project | null {
    const userData = this.getCurrentUserData();
    return userData?.projects.find(p => p.id === projectId) || null;
  }

  updateProject(projectId: string, updates: Partial<Project>): Project | null {
    const userData = this.getCurrentUserData();
    if (!userData) return null;

    const index = userData.projects.findIndex(p => p.id === projectId);
    if (index === -1) return null;

    userData.projects[index] = {
      ...userData.projects[index],
      ...updates,
      updatedAt: Date.now(),
    };

    this.markProjectMutation();
    this.saveData();
    return userData.projects[index];
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const result = await this.deleteProjects([projectId]);
    return result.deletedIds.includes(projectId);
  }

  async deleteProjects(projectIds: string[]): Promise<{ deletedIds: string[]; skippedIds: string[] }> {
    const userData = this.getCurrentUserData();
    const requestedIds = [...new Set(projectIds.map(id => id.trim()).filter(Boolean))];
    if (!userData) return { deletedIds: [], skippedIds: requestedIds };

    const existingIds = new Set(userData.projects.map(project => project.id));
    const deletedIds = requestedIds.filter(id => existingIds.has(id));
    const skippedIds = requestedIds.filter(id => !existingIds.has(id));
    if (deletedIds.length === 0) return { deletedIds, skippedIds };

    const deletedIdSet = new Set(deletedIds);
    userData.projects = userData.projects.filter(project => !deletedIdSet.has(project.id));
    this.markProjectMutation();
    this.saveData();
    if (this.serverSyncTimer) {
      clearTimeout(this.serverSyncTimer);
      this.serverSyncTimer = null;
    }
    // Keep deletion optimistic while one bounded background sync persists the complete batch.
    void this.syncToServer(true);

    return { deletedIds, skippedIds };
  }

  // API Key 相关方法
  addApiKey(name: string, provider: 'apimart' | 'gemini' | 'custom' | 'openai' | 'openai-async' | 'async-poll' | 'direct', key: string, baseUrl?: string): ApiKey {
    const userData = this.getCurrentUserData();
    if (!userData?.user) {
      throw new Error('No user found');
    }

    // 检查是否已存在相同key的密钥，防止重复
    const existingKey = userData.apiKeys.find(k => k.key === key);
    if (existingKey) {
      return existingKey;
    }

    const apiKey: ApiKey = {
      id: `apikey_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: userData.user.id,
      name,
      provider,
      key,
      baseUrl,
      isEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    userData.apiKeys.unshift(apiKey);
    this.saveData();
    return apiKey;
  }

  getApiKeys(): ApiKey[] {
    const userData = this.getCurrentUserData();
    return userData?.apiKeys || [];
  }

  updateApiKey(apiKeyId: string, updates: Partial<ApiKey>): ApiKey | null {
    const userData = this.getCurrentUserData();
    if (!userData) return null;

    const index = userData.apiKeys.findIndex(k => k.id === apiKeyId);
    if (index === -1) return null;

    userData.apiKeys[index] = {
      ...userData.apiKeys[index],
      ...updates,
      updatedAt: Date.now(),
    };

    this.saveData();
    return userData.apiKeys[index];
  }

  deleteApiKey(apiKeyId: string): boolean {
    const userData = this.getCurrentUserData();
    if (!userData) return false;

    const initialLength = userData.apiKeys.length;
    userData.apiKeys = userData.apiKeys.filter(k => k.id !== apiKeyId);

    if (userData.apiKeys.length !== initialLength) {
      this.saveData();
      return true;
    }

    return false;
  }

  // 使用统计相关方法
  recordUsage(type: 'image' | 'chat' | 'video' | '3d' | 'edit' | 'erase' | 'removebg' | 'upscale', tokensUsed: number = 0, cost: number = 0): UsageStats {
    const userData = this.getCurrentUserData();
    if (!userData?.user) {
      throw new Error('No user found');
    }

    const today = new Date().toISOString().split('T')[0];
    let stats = userData.usageStats.find(s => s.date === today);

    if (!stats) {
      stats = {
        userId: userData.user.id,
        date: today,
        requests: 0,
        imagesGenerated: 0,
        videosGenerated: 0,
        models3dGenerated: 0,
        editsPerformed: 0,
        chatsCount: 0,
        tokensUsed: 0,
        estimatedCost: 0,
        eraseCount: 0,
        removeBgCount: 0,
        upscaleCount: 0,
      };
      userData.usageStats.unshift(stats);
    }

    stats.requests += 1;
    if (type === 'image') {
      stats.imagesGenerated += 1;
    } else if (type === 'video') {
      stats.videosGenerated += 1;
    } else if (type === '3d') {
      stats.models3dGenerated += 1;
    } else if (type === 'edit') {
      stats.editsPerformed += 1;
    } else if (type === 'chat') {
      stats.chatsCount += 1;
    } else if (type === 'erase') {
      stats.eraseCount += 1;
      stats.editsPerformed += 1;
    } else if (type === 'removebg') {
      stats.removeBgCount += 1;
      stats.editsPerformed += 1;
    } else if (type === 'upscale') {
      stats.upscaleCount += 1;
      stats.editsPerformed += 1;
    }
    stats.tokensUsed += tokensUsed;
    stats.estimatedCost += cost;

    this.saveData();
    return stats;
  }

  getUsageStats(days: number = 30): UsageStats[] {
    const userData = this.getCurrentUserData();
    if (!userData) return [];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    return userData.usageStats.filter(s => s.date >= cutoffStr);
  }

  // 导出功能
  exportProjectToMarkdown(projectId: string): string {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const modelNames: Record<string, string> = {
      'gemini-2.5-flash-image-preview': 'Nano Banana (2.5-flash)',
      'gemini-2.5-flash-image': 'Nano Banana (2.5-flash)',
      'gemini-2.0-flash-exp-image': 'Nano Banana 2 (3.1-flash)',
      'gemini-2.0-flash-exp': 'Nano Banana 2 (3.1-flash)',
      'gemini-2.5-pro-image-preview': 'Nano Banana Pro (3-pro)',
      'seedance-4k': '豆包4.5 (Seedance)',
      'doubao-seedance-4-5': '豆包4.5 (Seedance)',
      'gpt-image-2': 'GPT-Image 2',
      'gpt-image-2-official': 'GPT-Image 2',
      'dall-e-3': 'DALL-E 3',
      'stable-diffusion-xl': 'Stable Diffusion XL',
      'flux-pro': 'Flux Pro',
      'flux-schnell': 'Flux Schnell',
    };

    const getModelLabel = (modelId: string) => modelNames[modelId] || modelId;

    const formatDate = (ts: number) => new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // 统计模型使用
    const modelStats: Record<string, number> = {};
    project.canvasImages.forEach(img => {
      const m = img.model || 'unknown';
      modelStats[m] = (modelStats[m] || 0) + 1;
    });

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(project.name)} - 项目导出</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; line-height: 1.6; }
  .container { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
  .header { text-align: center; margin-bottom: 48px; }
  .header h1 { font-size: 28px; font-weight: 600; color: #d4af37; margin-bottom: 8px; }
  .header .subtitle { font-size: 14px; color: #888; }
  .header .subtitle span { margin: 0 8px; }
  .section { margin-bottom: 36px; }
  .section-title { font-size: 16px; font-weight: 600; color: #d4af37; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #1a1a1a; display: flex; align-items: center; gap: 8px; }
  .section-title::before { content: ''; display: inline-block; width: 3px; height: 16px; background: #d4af37; border-radius: 2px; }
  .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .info-card { background: #111; border: 1px solid #1a1a1a; border-radius: 10px; padding: 16px; }
  .info-card .label { font-size: 12px; color: #666; margin-bottom: 4px; }
  .info-card .value { font-size: 15px; color: #e0e0e0; font-weight: 500; }
  .model-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .model-bar .name { font-size: 13px; color: #ccc; min-width: 160px; }
  .model-bar .bar { flex: 1; height: 6px; background: #1a1a1a; border-radius: 3px; overflow: hidden; }
  .model-bar .bar-fill { height: 100%; background: linear-gradient(90deg, #d4af37, #b8860b); border-radius: 3px; }
  .model-bar .count { font-size: 12px; color: #888; min-width: 30px; text-align: right; }
  .image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
  .image-card { background: #111; border: 1px solid #1a1a1a; border-radius: 12px; overflow: hidden; transition: transform 0.2s; }
  .image-card:hover { transform: translateY(-2px); }
  .image-card img { width: 100%; aspect-ratio: 1; object-fit: contain; background: #0a0a0a; display: block; }
  .image-card .meta { padding: 14px 16px; }
  .image-card .meta .prompt { font-size: 13px; color: #ccc; line-height: 1.5; margin-bottom: 10px; max-height: 60px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .image-card .meta .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .image-card .meta .tag { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #1a1a1a; color: #999; border: 1px solid #222; }
  .image-card .meta .tag.model { color: #d4af37; border-color: #d4af3722; background: #d4af3708; }
  .image-card .meta .tag.quality { color: #8b5cf6; border-color: #8b5cf622; background: #8b5cf608; }
  .image-card .meta .tag.ratio { color: #06b6d4; border-color: #06b6d422; background: #06b6d408; }
  .image-card .meta .tag.size { color: #10b981; border-color: #10b98122; background: #10b98108; }
  .image-card .meta .tag.date { color: #666; }
  .image-card .meta .detail-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 11px; color: #555; }
  .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #1a1a1a; }
  .footer p { font-size: 12px; color: #444; }
  .no-images { text-align: center; padding: 40px; color: #555; font-size: 14px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${escapeHtml(project.name)}</h1>
    <div class="subtitle">
      <span>无界AI 平台导出</span>
      <span>|</span>
      <span>版本号：${APP_VERSION_LABEL}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">项目信息</div>
    <div class="info-grid">
      <div class="info-card">
        <div class="label">项目名称</div>
        <div class="value">${escapeHtml(project.name)}</div>
      </div>
      <div class="info-card">
        <div class="label">创建时间</div>
        <div class="value">${formatDate(project.createdAt)}</div>
      </div>
      <div class="info-card">
        <div class="label">最后更新</div>
        <div class="value">${formatDate(project.updatedAt)}</div>
      </div>
      <div class="info-card">
        <div class="label">图片数量</div>
        <div class="value">${project.canvasImages.length} 张</div>
      </div>
      ${project.description ? `<div class="info-card" style="grid-column: span 2;"><div class="label">项目描述</div><div class="value">${escapeHtml(project.description)}</div></div>` : ''}
    </div>
  </div>

  ${Object.keys(modelStats).length > 0 ? `
  <div class="section">
    <div class="section-title">模型使用统计</div>
    ${Object.entries(modelStats).sort((a, b) => b[1] - a[1]).map(([modelId, count]) => {
      const maxCount = Math.max(...Object.values(modelStats));
      const pct = Math.round((count / maxCount) * 100);
      return `<div class="model-bar">
        <div class="name">${escapeHtml(getModelLabel(modelId))}</div>
        <div class="bar"><div class="bar-fill" style="width: ${pct}%"></div></div>
        <div class="count">${count}张</div>
      </div>`;
    }).join('\n')}
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">画布图片</div>
    ${project.canvasImages.length > 0 ? `
    <div class="image-grid">
      ${project.canvasImages.map((img, idx) => `
      <div class="image-card">
        <img src="${escapeHtml(img.url)}" alt="图片 ${idx + 1}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22400%22><rect fill=%22%23111%22 width=%22400%22 height=%22400%22/><text x=%2250%25%22 y=%2250%25%22 fill=%22%23444%22 font-size=%2214%22 text-anchor=%22middle%22 dy=%22.3em%22>图片加载失败</text></svg>'" />
        <div class="meta">
          ${img.prompt ? `<div class="prompt">${escapeHtml(img.prompt)}</div>` : ''}
          <div class="tags">
            ${img.model ? `<span class="tag model">${escapeHtml(getModelLabel(img.model))}</span>` : ''}
            ${img.quality ? `<span class="tag quality">${img.quality}</span>` : ''}
            ${img.aspectRatio ? `<span class="tag ratio">${img.aspectRatio}</span>` : ''}
            ${img.size ? `<span class="tag size">${img.size.replace('x', '×')}</span>` : ''}
            ${img.category ? `<span class="tag">${escapeHtml(img.category)}</span>` : ''}
            ${img.stylePreset && img.stylePreset !== 'auto' ? `<span class="tag">${escapeHtml(img.stylePreset)}</span>` : ''}
          </div>
          <div class="detail-row">
            <span>${img.originalWidth}×${img.originalHeight}px</span>
            <span class="tag date">${formatDate(img.createdAt)}</span>
          </div>
        </div>
      </div>
      `).join('\n')}
    </div>
    ` : '<div class="no-images">暂无画布图片</div>'}
  </div>

  <div class="footer">
    <p>由 无界AI 平台导出 · ${formatDate(Date.now())}</p>
  </div>
</div>
</body>
</html>`;

    return html;
  }

  // 清空数据（用于测试）
  clearAllData(): void {
    this.multiUserData = null;
    this.resetProjectSyncSession();
    this.currentUserId = null;
    if (this.canUseStorage()) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CURRENT_USER_KEY);
    }
    this.ensureDefaultAdmin();
  }

  /**
   * 退出登录 - 清除当前用户状态，取消待执行的同步任务
   */
  async logout(): Promise<void> {
    // Cancel the delayed copy, then finish one authenticated sync before invalidating the session.
    if (this.serverSyncTimer) {
      clearTimeout(this.serverSyncTimer);
      this.serverSyncTimer = null;
    }
    await this.syncToServer(true, true);
    this._serverSyncReady = false; // 重置同步状态，新用户登录后需重新加载
    this.resetProjectSyncSession();
    this.currentUserId = null;
    if (this.canUseStorage()) {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
    if (typeof window !== 'undefined') {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Local session cleanup must still complete if the logout endpoint is unavailable.
      }
    }
  }
  async exportProjectToWujie(projectId: string): Promise<string> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const userData = this.getCurrentUserData();
    const user = userData?.user;

    // Convert image URLs to base64 data URLs for offline viewing
    const imageUrlMap = new Map<string, string>();
    const uniqueUrls = [...new Set(project.canvasImages.map(img => img.url).filter(Boolean))];
    await Promise.all(uniqueUrls.map(async (url) => {
      try {
        // For relative URLs, prepend the origin
        const fetchUrl = url.startsWith('/') ? `${window.location.origin}${url}` : url;
        const resp = await fetch(fetchUrl, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(url);
            reader.readAsDataURL(blob);
          });
          imageUrlMap.set(url, dataUrl);
        } else {
          imageUrlMap.set(url, url);
        }
      } catch {
        imageUrlMap.set(url, url);
      }
    }));
    const resolveUrl = (url: string) => imageUrlMap.get(url) || url;

    const modelNames: Record<string, string> = {
      'gemini-2.5-flash-image-preview': 'Nano Banana (2.5-flash)',
      'gemini-2.5-flash-image': 'Nano Banana (2.5-flash)',
      'gemini-2.0-flash-exp-image': 'Nano Banana 2 (3.1-flash)',
      'gemini-2.0-flash-exp': 'Nano Banana 2 (3.1-flash)',
      'gemini-2.5-pro-image-preview': 'Nano Banana Pro (3-pro)',
      'seedance-4k': '豆包4.5 (Seedance)',
      'gpt-image-2-official': 'GPT-Image 2',
    };
    const getModelLabel = (m: string) => modelNames[m] || m;
    const formatDate = (ts: number) => new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Embed JSON data for re-import
    const payload: WujieProjectFile = {
      format: 'wujie-project',
      version: '2.0',
      exportedAt: Date.now(),
      project,
    };
    const jsonBlock = JSON.stringify(payload);

    // Model stats
    const modelStats: Record<string, number> = {};
    project.canvasImages.forEach(img => {
      const m = img.model || 'unknown';
      modelStats[m] = (modelStats[m] || 0) + 1;
    });
    const maxModelCount = Math.max(1, ...Object.values(modelStats));

    // Group stats
    const groupCount = project.metadata?.groups?.length || 0;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(project.name)} - 无界AI 图册</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans SC',sans-serif;background:#080808;color:#ccc;line-height:1.6;min-height:100vh}
  ::selection{background:#d4af3744;color:#fff}
  ::-webkit-scrollbar{width:6px}
  ::-webkit-scrollbar-track{background:#111}
  ::-webkit-scrollbar-thumb{background:#333;border-radius:3px}
  ::-webkit-scrollbar-thumb:hover{background:#555}

  .page{max-width:1200px;margin:0 auto;padding:48px 32px 80px}

  /* ── Hero ── */
  .hero{text-align:center;margin-bottom:56px;position:relative}
  .hero::after{content:'';position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:120px;height:1px;background:linear-gradient(90deg,transparent,#d4af37,transparent)}
  .hero .logo{display:inline-flex;align-items:center;gap:8px;margin-bottom:16px}
  .hero .logo svg{width:32px;height:32px}
  .hero .logo span{font-size:14px;letter-spacing:4px;color:#d4af37;font-weight:300;text-transform:uppercase}
  .hero h1{font-size:36px;font-weight:700;color:#fff;margin-bottom:8px;letter-spacing:1px}
  .hero .meta-line{font-size:13px;color:#666;display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin-bottom:12px}
  .hero .meta-line .sep{color:#333}
  .hero .desc{font-size:14px;color:#888;max-width:600px;margin:0 auto}

  /* ── User Card ── */
  .user-card{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,#0f0f0f,#141414);border:1px solid #1e1e1e;border-radius:16px;padding:20px 24px;margin-bottom:40px}
  .user-card .avatar{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#d4af37,#b8860b);display:flex;align-items:center;justify-content:center;font-size:20px;color:#000;font-weight:700;flex-shrink:0}
  .user-card .info{flex:1}
  .user-card .info .name{font-size:16px;color:#eee;font-weight:600}
  .user-card .info .role{font-size:12px;color:#d4af37;margin-left:8px;font-weight:400;vertical-align:middle}
  .user-card .info .email{font-size:12px;color:#666;margin-top:2px}
  .user-card .export-time{font-size:12px;color:#555;text-align:right;white-space:nowrap}

  /* ── Stats Bar ── */
  .stats-bar{display:flex;gap:1px;margin-bottom:40px;border-radius:12px;overflow:hidden;border:1px solid #1a1a1a}
  .stat-item{flex:1;background:#0d0d0d;padding:16px 12px;text-align:center}
  .stat-item .num{font-size:24px;font-weight:700;color:#d4af37;line-height:1.2}
  .stat-item .num small{font-size:12px;font-weight:400;color:#666;margin-left:2px}
  .stat-item .label{font-size:11px;color:#555;margin-top:4px;letter-spacing:1px}

  /* ── Model Usage ── */
  .section{margin-bottom:36px}
  .section-title{font-size:14px;font-weight:600;color:#d4af37;margin-bottom:16px;display:flex;align-items:center;gap:10px;letter-spacing:1px;text-transform:uppercase}
  .section-title::before{content:'';width:3px;height:14px;background:#d4af37;border-radius:2px}
  .model-row{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .model-row .name{font-size:13px;color:#aaa;min-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .model-row .bar-wrap{flex:1;height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden}
  .model-row .bar-fill{height:100%;background:linear-gradient(90deg,#d4af37,#b8860b);border-radius:2px;transition:width 0.6s ease}
  .model-row .cnt{font-size:12px;color:#777;min-width:36px;text-align:right}

  /* ── Image Gallery ── */
  .gallery{columns:3;column-gap:20px}
  @media(max-width:900px){.gallery{columns:2}}
  @media(max-width:560px){.gallery{columns:1}}
  .img-card{break-inside:avoid;margin-bottom:20px;background:#0d0d0d;border:1px solid #1a1a1a;border-radius:14px;overflow:hidden;transition:border-color 0.3s}
  .img-card:hover{border-color:#d4af3733}
  .img-card .img-wrap{position:relative;overflow:hidden;background:#080808}
  .img-card .img-wrap img{width:100%;display:block;transition:transform 0.4s ease}
  .img-card:hover .img-wrap img{transform:scale(1.02)}
  .img-card .img-wrap .idx{position:absolute;top:10px;left:10px;background:#000a;color:#d4af37;font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600}
  .img-card .img-wrap .dims{position:absolute;bottom:10px;right:10px;background:#000a;color:#888;font-size:10px;padding:2px 8px;border-radius:4px}
  .img-card .card-body{padding:14px 16px}
  .img-card .prompt{font-size:13px;color:#bbb;line-height:1.6;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .img-card .tags{display:flex;flex-wrap:wrap;gap:5px}
  .img-card .tag{font-size:10px;padding:2px 8px;border-radius:4px;letter-spacing:0.3px}
  .img-card .tag.model{color:#d4af37;background:#d4af3712;border:1px solid #d4af3722}
  .img-card .tag.quality{color:#a78bfa;background:#a78bfa12;border:1px solid #a78bfa22}
  .img-card .tag.ratio{color:#22d3ee;background:#22d3ee12;border:1px solid #22d3ee22}
  .img-card .tag.size{color:#34d399;background:#34d39912;border:1px solid #34d39922}
  .img-card .tag.cat{color:#888;background:#ffffff08;border:1px solid #ffffff12}
  .img-card .card-footer{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:11px;color:#555}
  .img-card .modify-prompt{font-size:11px;color:#666;margin-top:6px;font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .img-card .modify-prompt::before{content:'✎ ';color:#d4af37;font-style:normal}

  .no-images{text-align:center;padding:60px 20px;color:#444;font-size:14px}

  /* ── Footer ── */
  .footer{text-align:center;margin-top:64px;padding-top:24px;border-top:1px solid #1a1a1a}
  .footer .brand{font-size:13px;color:#333;letter-spacing:2px}
  .footer .brand b{color:#d4af37;font-weight:500}
  .footer .tip{font-size:11px;color:#2a2a2a;margin-top:8px}
</style>
</head>
<body>
<div class="page">

  <!-- Hero -->
  <div class="hero">
    <div class="logo">
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="8" fill="#d4af37" fill-opacity="0.15"/>
        <path d="M8 22L16 10L24 22H8Z" stroke="#d4af37" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="16" cy="18" r="3" fill="#d4af37" fill-opacity="0.6"/>
      </svg>
      <span>无界 AI</span>
    </div>
    <h1>${esc(project.name)}</h1>
    <div class="meta-line">
      <span>${project.canvasImages.length} 张作品</span>
      <span class="sep">|</span>
      <span>创建于 ${formatDate(project.createdAt)}</span>
      <span class="sep">|</span>
      <span>${APP_VERSION_LABEL}</span>
    </div>
    ${project.description ? `<div class="desc">${esc(project.description)}</div>` : ''}
  </div>

  <!-- User Card -->
  ${user ? `
  <div class="user-card">
    <div class="avatar">${esc(user.name.charAt(0).toUpperCase())}</div>
    <div class="info">
      <div><span class="name">${esc(user.name)}</span>${user.role === 'admin' ? '<span class="role">管理员</span>' : ''}</div>
      ${user.email ? `<div class="email">${esc(user.email)}</div>` : ''}
    </div>
    <div class="export-time">
      导出时间<br/>${formatDate(Date.now())}
    </div>
  </div>
  ` : ''}

  <!-- Stats Bar -->
  <div class="stats-bar">
    <div class="stat-item">
      <div class="num">${project.canvasImages.length}<small>张</small></div>
      <div class="label">作品数</div>
    </div>
    <div class="stat-item">
      <div class="num">${Object.keys(modelStats).length}<small>个</small></div>
      <div class="label">使用模型</div>
    </div>
    <div class="stat-item">
      <div class="num">${groupCount}<small>组</small></div>
      <div class="label">图片分组</div>
    </div>
    <div class="stat-item">
      <div class="num">${Math.round((Date.now() - project.createdAt) / 86400000)}<small>天</small></div>
      <div class="label">项目周期</div>
    </div>
  </div>

  ${Object.keys(modelStats).length > 0 ? `
  <!-- Model Usage -->
  <div class="section">
    <div class="section-title">模型使用</div>
    ${Object.entries(modelStats).sort((a, b) => b[1] - a[1]).map(([modelId, count]) => `
    <div class="model-row">
      <div class="name">${esc(getModelLabel(modelId))}</div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${Math.round((count / maxModelCount) * 100)}%"></div></div>
      <div class="cnt">${count}张</div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- Gallery -->
  <div class="section">
    <div class="section-title">作品画廊</div>
    ${project.canvasImages.length > 0 ? `
    <div class="gallery">
      ${project.canvasImages.map((img, idx) => `
      <div class="img-card">
        <div class="img-wrap">
          <img src="${esc(resolveUrl(img.url))}" alt="作品 ${idx + 1}" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\\'padding:40px;text-align:center;color:#333;font-size:13px\\'>图片不可用</div>'" />
          <div class="idx">#${idx + 1}</div>
          <div class="dims">${img.originalWidth || img.width || '?'}×${img.originalHeight || img.height || '?'}</div>
        </div>
        <div class="card-body">
          ${img.prompt ? `<div class="prompt">${esc(img.prompt)}</div>` : '<div class="prompt" style="color:#444">无提示词</div>'}
          ${img.modifyPrompt ? `<div class="modify-prompt">${esc(img.modifyPrompt)}</div>` : ''}
          <div class="tags">
            ${img.model ? `<span class="tag model">${esc(getModelLabel(img.model))}</span>` : ''}
            ${img.quality ? `<span class="tag quality">${esc(img.quality)}</span>` : ''}
            ${img.aspectRatio ? `<span class="tag ratio">${esc(img.aspectRatio)}</span>` : ''}
            ${img.size ? `<span class="tag size">${esc(img.size.replace(/x/g, '×'))}</span>` : ''}
            ${img.category ? `<span class="tag cat">${esc(img.category)}</span>` : ''}
            ${img.stylePreset && img.stylePreset !== 'auto' ? `<span class="tag cat">${esc(img.stylePreset)}</span>` : ''}
          </div>
          <div class="card-footer">
            <span>${formatDate(img.createdAt)}</span>
          </div>
        </div>
      </div>
      `).join('')}
    </div>
    ` : '<div class="no-images">暂无作品</div>'}
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="brand">由 <b>无界AI</b> 平台导出</div>
    <div class="tip">本文件为 HTML 格式，可直接用浏览器打开浏览 · 扩展名 .wujie</div>
  </div>
</div>

<!-- Embedded project data for re-import -->
<script id="wujie-project-data" type="application/json">${jsonBlock.replace(/<\//g, '<\\/')}</script>
</body>
</html>`;
    return html;
  }

  importProjectFromWujie(content: string): Project {
    const userData = this.getCurrentUserData();
    if (!userData?.user) throw new Error('No user found');

    let payload: WujieProjectFile;

    // Support both HTML (v2+) and JSON (v1) formats
    const trimmed = content.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      // HTML format: extract JSON from <script id="wujie-project-data">
      const match = trimmed.match(/<script\s+id="wujie-project-data"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
      if (!match || !match[1]) {
        throw new Error('Invalid .wujie file: embedded project data not found');
      }
      // Only need to unescape the <\/ we escaped during export
      const jsonStr = match[1].replace(/<\\\//g, '</');
      payload = JSON.parse(jsonStr) as WujieProjectFile;
    } else {
      // Legacy JSON format
      payload = JSON.parse(trimmed) as WujieProjectFile;
    }

    if (payload.format !== 'wujie-project' || !payload.project) {
      throw new Error('Invalid .wujie project file');
    }

    const project: Project = {
      ...payload.project,
      id: `project_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      userId: userData.user.id,
      name: payload.project.name || 'Imported Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    userData.projects.unshift(project);
    this.markProjectMutation();
    this.saveData();
    return project;
  }
}
