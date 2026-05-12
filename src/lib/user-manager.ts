// 用户数据管理器 - localStorage + 服务器数据库双重存储
import { User, Project, ApiKey, UsageStats, UserData, WujieProjectFile } from './user-types';
import { APP_VERSION_LABEL } from '@/config/app-meta';

const STORAGE_KEY = 'unbounded_ai_user_data';
const CURRENT_USER_KEY = 'unbounded_ai_current_user';
const DEFAULT_ADMIN_NAME = 'Mr.joker';
const DEFAULT_ADMIN_PASSWORD = 'dongdong851212';

const userStorageFolder = (userId: string): string => `data/users/${userId}`;

const defaultApiPermissions = () => ({
  image: true,
  chat: true,
  threeD: true,
  imageEdit: true,
  vectorize: true,
  layer: true,
});

interface MultiUserData {
  users: User[];
  userData: Record<string, UserData>; // userId -> UserData
}

export class UserManager {
  private static instance: UserManager;
  private multiUserData: MultiUserData | null = null;
  private currentUserId: string | null = null;

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
    } catch (error) {
      console.error('Failed to load user data:', error);
      this.multiUserData = {
        users: [],
        userData: {}
      };
      this.ensureDefaultAdmin();
    }
  }

  private ensureDefaultAdmin(): void {
    if (!this.multiUserData) {
      this.multiUserData = { users: [], userData: {} };
    }

    let admin = this.multiUserData.users.find(u => u.name === DEFAULT_ADMIN_NAME);
    if (!admin) {
      admin = {
        id: 'admin_mr_joker',
        name: DEFAULT_ADMIN_NAME,
        password: DEFAULT_ADMIN_PASSWORD,
        role: 'admin',
        status: 'active',
        apiPermissions: defaultApiPermissions(),
        storageFolder: userStorageFolder('admin_mr_joker'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.multiUserData.users.unshift(admin);
      this.multiUserData.userData[admin.id] = {
        user: admin,
        projects: [],
        apiKeys: [],
        usageStats: [],
      };
      this.saveData();
      return;
    }

    const normalizedAdmin: User = {
      ...admin,
      password: admin.password || DEFAULT_ADMIN_PASSWORD,
      role: 'admin',
      status: admin.status || 'active',
      apiPermissions: admin.apiPermissions || defaultApiPermissions(),
      storageFolder: admin.storageFolder?.startsWith('data/users/') ? admin.storageFolder : userStorageFolder(admin.id),
      updatedAt: Date.now(),
    };
    this.multiUserData.users = this.multiUserData.users.map(u => u.id === normalizedAdmin.id ? normalizedAdmin : {
      ...u,
      role: u.role || 'user',
      status: u.status || 'active',
      apiPermissions: u.apiPermissions || defaultApiPermissions(),
      storageFolder: u.storageFolder?.startsWith('data/users/') ? u.storageFolder : userStorageFolder(u.id),
    });
    if (this.multiUserData.userData[normalizedAdmin.id]) {
      this.multiUserData.userData[normalizedAdmin.id].user = normalizedAdmin;
    }
    this.saveData();
  }

  private saveData(): void {
    if (!this.canUseStorage()) return;

    try {
      if (this.multiUserData) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.multiUserData));
      }
      if (this.currentUserId) {
        localStorage.setItem(CURRENT_USER_KEY, this.currentUserId);
      }
    } catch (error) {
      console.error('Failed to save user data:', error);
    }

    // 同步当前用户的项目数据到服务器数据库（防抖）
    this.scheduleServerSync();
  }

  // ====== 服务器同步 ======
  private serverSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SYNC_DEBOUNCE_MS = 2000; // 2秒防抖

  private scheduleServerSync(): void {
    if (typeof window === 'undefined') return;
    if (this.serverSyncTimer) clearTimeout(this.serverSyncTimer);
    this.serverSyncTimer = setTimeout(() => {
      this.serverSyncTimer = null;
      void this.syncToServer();
    }, UserManager.SYNC_DEBOUNCE_MS);
  }

  /** 将当前用户的项目数据同步到服务器数据库 */
  private async syncToServer(): Promise<void> {
    if (!this.currentUserId || !this.multiUserData) return;
    const userData = this.multiUserData.userData[this.currentUserId];
    if (!userData) return;

    try {
      // 只同步项目数据（最关键的画布数据）
      const projectsPayload = userData.projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        canvasImages: p.canvasImages,
        metadata: p.metadata,
        settings: p.settings,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

      await fetch('/api/user-data/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key: 'projects', value: projectsPayload }),
      });
    } catch {
      // 服务器同步是尽力而为，失败不影响本地功能
    }
  }

  /** 从服务器加载当前用户的项目数据 */
  async loadProjectsFromServer(): Promise<void> {
    if (!this.currentUserId || !this.multiUserData) return;
    const userData = this.multiUserData.userData[this.currentUserId];
    if (!userData) return;

    try {
      const res = await fetch('/api/user-data/sync?key=projects', {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json() as { success: boolean; value?: unknown };
      if (!data.success || !data.value) return;

      // value 可能是字符串（需要 JSON.parse）或已解析的对象
      let serverProjects: Project[];
      if (typeof data.value === 'string') {
        try {
          serverProjects = JSON.parse(data.value) as Project[];
        } catch {
          return;
        }
      } else if (Array.isArray(data.value)) {
        serverProjects = data.value as Project[];
      } else {
        return;
      }
      if (serverProjects.length === 0) return;

      // 合并策略：以服务器数据为主，但保留本地独有的项目
      const serverProjectIds = new Set(serverProjects.map(p => p.id));
      const localOnlyProjects = userData.projects.filter(p => !serverProjectIds.has(p.id));
      // 如果服务器有项目且本地为空，或服务器项目更新时间更晚，则使用服务器数据
      const localHasData = userData.projects.length > 0;
      const serverHasData = serverProjects.length > 0;

      if (!localHasData && serverHasData) {
        // 本地无数据，直接使用服务器数据
        userData.projects = serverProjects;
      } else if (localHasData && serverHasData) {
        // 双方都有数据，合并（服务器优先，保留本地独有的）
        userData.projects = [...serverProjects, ...localOnlyProjects];
      }
      // 如果只有本地数据，不做任何修改

      this.saveData();
    } catch {
      // 加载失败不影响本地功能
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
      apiPermissions: user.apiPermissions || defaultApiPermissions(),
      storageFolder: user.storageFolder?.startsWith('data/users/') ? user.storageFolder : userStorageFolder(user.id),
      updatedAt: user.updatedAt || Date.now(),
    };

    const index = this.multiUserData.users.findIndex(existing => existing.id === nextUser.id);
    if (index === -1) {
      this.multiUserData.users.unshift(nextUser);
    } else {
      this.multiUserData.users[index] = nextUser;
    }

    if (!this.multiUserData.userData[nextUser.id]) {
      this.multiUserData.userData[nextUser.id] = {
        user: nextUser,
        projects: [],
        apiKeys: [],
        usageStats: [],
      };
      // 新用户（localStorage为空），从服务器加载项目数据
      const prevUserId = this.currentUserId;
      this.currentUserId = nextUser.id;
      await this.loadProjectsFromServer();
      this.currentUserId = prevUserId || nextUser.id;
    } else {
      this.multiUserData.userData[nextUser.id].user = nextUser;
    }

    this.currentUserId = nextUser.id;
    this.saveData();
    void this.ensureServerFolder(nextUser.id);
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
    this.currentUserId = user.id;
    this.saveData();
    void this.ensureServerFolder(user.id);
    return user;
  }

  private async ensureServerFolder(userId: string): Promise<void> {
    try {
      await fetch('/api/admin/user-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    } catch {
      // Local folder creation is best-effort in the browser runtime.
    }
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
    this.currentUserId = user.id;

    this.saveData();
    void this.ensureServerFolder(user.id);
    return user;
  }

  adminCreateUser(name: string, password: string, email?: string): User {
    if (!this.isCurrentAdmin()) throw new Error('Only administrator can create users');
    const previousUserId = this.currentUserId;
    const user = this.createUser(name, email, password);
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

    this.currentUserId = userId;
    this.saveData();
    return true;
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
    this.saveData();
    return project;
  }

  getProjects(): Project[] {
    const userData = this.getCurrentUserData();
    return userData?.projects || [];
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

    this.saveData();
    return userData.projects[index];
  }

  deleteProject(projectId: string): boolean {
    const userData = this.getCurrentUserData();
    if (!userData) return false;

    const initialLength = userData.projects.length;
    userData.projects = userData.projects.filter(p => p.id !== projectId);

    if (userData.projects.length !== initialLength) {
      this.saveData();
      return true;
    }

    return false;
  }

  // API Key 相关方法
  addApiKey(name: string, provider: 'apimart' | 'gemini' | 'custom', key: string, baseUrl?: string): ApiKey {
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
  recordUsage(type: 'image' | 'chat', tokensUsed: number = 0, cost: number = 0): UsageStats {
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
        tokensUsed: 0,
        estimatedCost: 0,
      };
      userData.usageStats.unshift(stats);
    }

    stats.requests += 1;
    if (type === 'image') {
      stats.imagesGenerated += 1;
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
      'gpt-image-2-official': 'GPT-Image 2',
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
    this.currentUserId = null;
    if (this.canUseStorage()) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CURRENT_USER_KEY);
    }
    this.ensureDefaultAdmin();
  }

  /**
   * ??????????
   */
  logout(): void {
    this.currentUserId = null;
    if (this.canUseStorage()) {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
    if (typeof window !== 'undefined') {
      void fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
    }
  }
  exportProjectToWujie(projectId: string): string {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const payload: WujieProjectFile = {
      format: 'wujie-project',
      version: '1.0',
      exportedAt: Date.now(),
      project,
    };
    return JSON.stringify(payload, null, 2);
  }

  importProjectFromWujie(content: string): Project {
    const userData = this.getCurrentUserData();
    if (!userData?.user) throw new Error('No user found');
    const payload = JSON.parse(content) as WujieProjectFile;
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
    this.saveData();
    return project;
  }
}
