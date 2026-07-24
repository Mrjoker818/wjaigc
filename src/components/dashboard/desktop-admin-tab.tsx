'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Box,
  CheckCircle2,
  Clipboard,
  Download,
  FileArchive,
  HardDrive,
  Image,
  Link,
  Megaphone,
  RefreshCw,
  Save,
  Search,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';

type DesktopSection = 'overview' | 'updates' | 'backups' | 'connection' | 'resources' | 'records';

interface DesktopAdminTabProps {
  isDark: boolean;
  textPrimary: string;
  textSecondary: string;
  softClass: string;
  inputClass: string;
  accentBgClass: string;
  accentTextOnBgClass: string;
  accentHoverBgClass: string;
}

interface DesktopUpdateConfig {
  enabled: boolean;
  version: string;
  packageUrl: string;
  fileBackupId?: string;
  sha256?: string;
  size?: number;
  mandatory?: boolean;
  notes?: string;
  publishedAt: number;
}

interface CloudBackup {
  id: string;
  userId: string;
  category: string;
  filename: string;
  originalFilename: string;
  contentType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
  downloadPath?: string;
}

interface CloudResource {
  id: string;
  type: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  thumbnailUrl: string;
  content: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

interface ManagedUser {
  id: string;
  name?: string;
  username?: string;
  email?: string;
}

interface ResourceMeta {
  value: string;
  label: string;
  desc: string;
  contentLabel: string;
  contentPlaceholder: string;
  thumbnailLabel?: string;
  thumbnailRequired?: boolean;
  defaultCategory: string;
  defaultPayload: Record<string, unknown>;
}

const RESOURCE_TYPES: ResourceMeta[] = [
  {
    value: 'prompt-template',
    label: '提示词模板',
    desc: '用于提示词库、聊天输入框和快捷调用，重点填写模板正文和变量说明。',
    contentLabel: '提示词正文',
    contentPlaceholder: '例如：产品摄影，白色背景，柔和棚拍灯光，突出 {product} 的材质与卖点...',
    defaultCategory: '通用提示词',
    defaultPayload: { variables: ['product', 'style'], usage: 'prompt-library' },
  },
  {
    value: 'material',
    label: '公共素材',
    desc: '用于素材库，支持上传缩略图和素材文件，较大文件建议填写外部 URL。',
    contentLabel: '素材说明或素材地址',
    contentPlaceholder: '填写素材用途、版权说明，或粘贴素材原图 URL。',
    thumbnailLabel: '素材缩略图 / 素材文件',
    thumbnailRequired: true,
    defaultCategory: '公共素材',
    defaultPayload: { assetUrl: '', assetType: 'image', license: 'admin-shared' },
  },
  {
    value: 'favorite-preset',
    label: '收藏预设',
    desc: '管理员预设给用户调用的常用参数组合。',
    contentLabel: '预设说明',
    contentPlaceholder: '说明这个收藏预设适用的场景。',
    thumbnailLabel: '预设缩略图',
    defaultCategory: '收藏预设',
    defaultPayload: { targetTool: 'image-generate', settings: {} },
  },
  {
    value: 'ecom-template',
    label: '电商模板',
    desc: '用于品牌电商、品牌工厂等工具，包含模板 ID、比例和提示词模板。',
    contentLabel: '电商模板提示词',
    contentPlaceholder: '例如：为 {product} 生成白底主图，主体居中，占画面 75%，商业棚拍...',
    thumbnailLabel: '模板预览缩略图',
    thumbnailRequired: true,
    defaultCategory: '电商主图',
    defaultPayload: { id: '', icon: 'box', aspectRatio: '1:1', promptTemplate: '', negativePrompt: 'low quality, blurry, watermark' },
  },
  {
    value: 'workflow-template',
    label: '工作流模板',
    desc: '用于节点工作流一键加载，JSON 参数中保存 nodes、edges 或工作流配置。',
    contentLabel: '工作流说明',
    contentPlaceholder: '说明工作流用途、输入要求和输出结果。',
    thumbnailLabel: '工作流预览图',
    defaultCategory: '工作流',
    defaultPayload: { nodes: [], edges: [], version: 1 },
  },
  {
    value: 'agent-template',
    label: 'Agent 模板',
    desc: '用于 AI 编排入口，保存系统提示词、步骤和默认工具。',
    contentLabel: 'Agent 系统提示词',
    contentPlaceholder: '定义 Agent 的角色、执行规则、输出格式和限制。',
    thumbnailLabel: 'Agent 封面',
    defaultCategory: '智能体',
    defaultPayload: { tools: [], steps: [], maxRounds: 5 },
  },
  {
    value: 'font-gallery',
    label: '字体/案例图库',
    desc: '用于字境大师、字体设计案例或参考图库，建议上传案例缩略图。',
    contentLabel: '案例说明 / 字体提示词',
    contentPlaceholder: '填写字体风格、案例描述、适用行业等。',
    thumbnailLabel: '案例缩略图',
    thumbnailRequired: true,
    defaultCategory: '字体案例',
    defaultPayload: { style: '', fontMood: '', referenceUrl: '' },
  },
  {
    value: 'brand-template',
    label: '品牌模板',
    desc: '用于品牌视觉规范、品牌电商和品牌工厂，保存品牌色、字体和限制规则。',
    contentLabel: '品牌模板说明',
    contentPlaceholder: '描述品牌调性、适用场景、视觉方向。',
    thumbnailLabel: '品牌封面 / Logo',
    thumbnailRequired: true,
    defaultCategory: '品牌模板',
    defaultPayload: { primaryColor: '#d4af37', secondaryColor: '#111111', fontFamily: '', visualTone: '', restrictions: '' },
  },
];

const BACKUP_CATEGORIES = [
  ['images', '图片'],
  ['projects', '项目'],
  ['uploads', '上传'],
  ['layers', '图层'],
  ['exports', '导出'],
  ['desktop-update-file', '更新包'],
  ['desktop-update-config', '更新配置'],
];

function emptyResourceForm(): CloudResource {
  const meta = RESOURCE_TYPES[0];
  return {
    id: '',
    type: meta.value,
    name: '',
    description: '',
    category: meta.defaultCategory,
    tags: [],
    thumbnailUrl: '',
    content: '',
    payload: { ...meta.defaultPayload },
    enabled: true,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function emptyUpdateConfig(): DesktopUpdateConfig {
  return { enabled: false, version: '', packageUrl: '', sha256: '', size: 0, mandatory: false, notes: '', publishedAt: 0 };
}

function resourceMeta(type: string): ResourceMeta {
  return RESOURCE_TYPES.find(item => item.value === type) || RESOURCE_TYPES[0];
}

function formatBytes(value: unknown): string {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(value: unknown): string {
  const n = Number(value || 0);
  return n ? new Date(n).toLocaleString('zh-CN') : '-';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export default function DesktopAdminTab({
  isDark,
  textPrimary,
  textSecondary,
  softClass,
  inputClass,
  accentBgClass,
  accentTextOnBgClass,
  accentHoverBgClass,
}: DesktopAdminTabProps) {
  const [section, setSection] = useState<DesktopSection>('overview');
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [devices, setDevices] = useState<Record<string, unknown>[]>([]);
  const [backups, setBackups] = useState<CloudBackup[]>([]);
  const [resources, setResources] = useState<CloudResource[]>([]);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [updateConfig, setUpdateConfig] = useState<DesktopUpdateConfig>(emptyUpdateConfig());
  const [updateFiles, setUpdateFiles] = useState<CloudBackup[]>([]);
  const [backupUserFilter, setBackupUserFilter] = useState('');
  const [backupCategoryFilter, setBackupCategoryFilter] = useState('');
  const [resourceSearch, setResourceSearch] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [savingResource, setSavingResource] = useState(false);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [resourceForm, setResourceForm] = useState<CloudResource>(emptyResourceForm());
  const [resourcePayloadText, setResourcePayloadText] = useState(JSON.stringify(emptyResourceForm().payload, null, 2));
  const [updateFile, setUpdateFile] = useState<File | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'resource' | 'backup'; id: string } | null>(null);

  const cardClass = `${softClass} rounded-xl border ${isDark ? 'border-white/10' : 'border-gray-200'}`;
  const buttonGhost = `rounded-lg px-3 py-2 text-xs font-medium transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-white/75' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`;
  const buttonPrimary = `rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${accentBgClass} ${accentTextOnBgClass} ${accentHoverBgClass}`;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '300');
      if (backupUserFilter) qs.set('userId', backupUserFilter);
      if (backupCategoryFilter) qs.set('category', backupCategoryFilter);
      const [usersRes, devicesRes, backupsRes, resourcesRes, recordsRes, updateRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/desktop-devices'),
        fetch(`/api/admin/backups?${qs.toString()}`),
        fetch('/api/admin/resources'),
        fetch('/api/admin/local-generation-records?limit=200'),
        fetch('/api/admin/desktop-update'),
      ]);
      const [usersJson, devicesJson, backupsJson, resourcesJson, recordsJson, updateJson] = await Promise.all([
        usersRes.json().catch(() => ({})),
        devicesRes.json().catch(() => ({})),
        backupsRes.json().catch(() => ({})),
        resourcesRes.json().catch(() => ({})),
        recordsRes.json().catch(() => ({})),
        updateRes.json().catch(() => ({})),
      ]);
      setUsers(Array.isArray(usersJson.users) ? usersJson.users : []);
      setDevices(Array.isArray(devicesJson.devices) ? devicesJson.devices : []);
      setBackups(Array.isArray(backupsJson.backups) ? backupsJson.backups : []);
      setResources(Array.isArray(resourcesJson.resources) ? resourcesJson.resources : []);
      setRecords(Array.isArray(recordsJson.records) ? recordsJson.records : []);
      const config = updateJson.config && typeof updateJson.config === 'object' ? updateJson.config as DesktopUpdateConfig : emptyUpdateConfig();
      setUpdateConfig({ ...emptyUpdateConfig(), ...config });
      setUpdateFiles(Array.isArray(updateJson.files) ? updateJson.files : []);
    } finally {
      setLoading(false);
    }
  }, [backupCategoryFilter, backupUserFilter]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const totals = useMemo(() => {
    const totalSize = backups.reduce((sum, item) => sum + Number(item.size || 0), 0);
    const imageCount = backups.filter(item => item.category === 'images').length;
    const latest = backups[0]?.createdAt || 0;
    return { totalSize, imageCount, latest };
  }, [backups]);

  const filteredResources = useMemo(() => {
    const q = resourceSearch.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter(item => [item.name, item.type, item.category, item.description, item.content].join(' ').toLowerCase().includes(q));
  }, [resourceSearch, resources]);

  const filteredRecords = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    if (!q) return records;
    return records.filter(item => [item.prompt, item.model, item.user_id, item.device_id].map(String).join(' ').toLowerCase().includes(q));
  }, [recordSearch, records]);

  const desktopEnvText = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://你的云端无界域名';
    return [
      'CLOUD_CONTROL_ENABLED=true',
      `CLOUD_MANAGEMENT_URL=${origin}`,
      'CLOUD_APP_ID=wujie-ai-desktop',
      'CLOUD_SYNC_ON_LOGIN=true',
      'CLOUD_SYNC_INTERVAL_SECONDS=0',
      'CLOUD_BACKUP_ENABLED=true',
      'CLOUD_BACKUP_TIMEOUT_MS=30000',
    ].join('\n');
  }, []);

  const resetResourceForm = useCallback((type = 'prompt-template') => {
    const meta = resourceMeta(type);
    const next = emptyResourceForm();
    next.type = type;
    next.category = meta.defaultCategory;
    next.payload = { ...meta.defaultPayload };
    setResourceForm(next);
    setResourcePayloadText(JSON.stringify(next.payload, null, 2));
  }, []);

  const setResourceType = useCallback((type: string) => {
    const meta = resourceMeta(type);
    const payload = { ...meta.defaultPayload };
    setResourceForm(prev => ({ ...prev, type, category: prev.category || meta.defaultCategory, payload }));
    setResourcePayloadText(JSON.stringify(payload, null, 2));
  }, []);

  const updatePayloadField = useCallback((key: string, value: unknown) => {
    setResourceForm(prev => {
      const payload = { ...(safeJsonParse(resourcePayloadText) || prev.payload || {}), [key]: value };
      setResourcePayloadText(JSON.stringify(payload, null, 2));
      return { ...prev, payload };
    });
  }, [resourcePayloadText]);

  const handleThumbFile = useCallback(async (file?: File | null) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setResourceForm(prev => ({ ...prev, thumbnailUrl: dataUrl }));
  }, []);

  const handleAssetFile = useCallback(async (file?: File | null) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const payload = { ...(safeJsonParse(resourcePayloadText) || {}), assetUrl: dataUrl, assetName: file.name, assetType: file.type || 'application/octet-stream' };
    setResourcePayloadText(JSON.stringify(payload, null, 2));
    setResourceForm(prev => ({ ...prev, content: dataUrl, payload }));
  }, [resourcePayloadText]);

  const saveResource = useCallback(async () => {
    const payload = safeJsonParse(resourcePayloadText);
    if (!payload) {
      toast.error('高级 JSON 参数格式不正确');
      return;
    }
    if (!resourceForm.name.trim()) {
      toast.error('请填写资源名称');
      return;
    }
    if (resourceMeta(resourceForm.type).thumbnailRequired && !resourceForm.thumbnailUrl.trim()) {
      toast.error('当前资源类型需要上传或填写缩略图');
      return;
    }
    setSavingResource(true);
    try {
      const response = await fetch('/api/admin/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...resourceForm, payload }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.success === false) throw new Error(String(json.error || '资源保存失败'));
      toast.success('资源已保存');
      resetResourceForm(resourceForm.type);
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '资源保存失败');
    } finally {
      setSavingResource(false);
    }
  }, [loadAll, resetResourceForm, resourceForm, resourcePayloadText]);

  const editResource = useCallback((item: CloudResource) => {
    const payload = { ...resourceMeta(item.type).defaultPayload, ...(item.payload || {}) };
    setResourceForm({ ...item, payload });
    setResourcePayloadText(JSON.stringify(payload, null, 2));
    setSection('resources');
  }, []);

  const deleteResource = useCallback(async (id: string) => {
    if (!id) return;
    const response = await fetch('/api/admin/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.success === false) {
      toast.error(String(json.error || '资源删除失败'));
      return;
    }
    toast.success('资源已删除');
    if (resourceForm.id === id) resetResourceForm();
    await loadAll();
  }, [loadAll, resetResourceForm, resourceForm.id]);

  const saveUpdate = useCallback(async () => {
    setSavingUpdate(true);
    try {
      let fileDataUrl = '';
      if (updateFile) fileDataUrl = await readFileAsDataUrl(updateFile);
      const response = await fetch('/api/admin/desktop-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...updateConfig,
          fileName: updateFile?.name,
          fileDataUrl,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.success === false) throw new Error(String(json.error || '保存桌面更新失败'));
      toast.success('桌面更新已保存');
      setUpdateFile(null);
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存桌面更新失败');
    } finally {
      setSavingUpdate(false);
    }
  }, [loadAll, updateConfig, updateFile]);

  const deleteBackup = useCallback(async (id: string) => {
    if (!id) return;
    const response = await fetch(`/api/admin/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.success === false) {
      toast.error(String(json.error || '备份删除失败'));
      return;
    }
    toast.success('备份已删除');
    await loadAll();
  }, [loadAll]);

  const confirmDelete = useCallback(async () => {
    const action = pendingDelete;
    if (!action) return;
    setPendingDelete(null);
    if (action.kind === 'resource') {
      await deleteResource(action.id);
      return;
    }
    await deleteBackup(action.id);
  }, [deleteBackup, deleteResource, pendingDelete]);

  const copyConnection = useCallback(async () => {
    await navigator.clipboard.writeText(desktopEnvText);
    toast.success('runtime.env 配置已复制');
  }, [desktopEnvText]);

  const Stat = ({ label, value, detail }: { label: string; value: string | number; detail?: string }) => (
    <div className={`${cardClass} p-4 min-h-[86px]`}>
      <div className={`text-xs ${textSecondary}`}>{label}</div>
      <div className={`mt-2 text-2xl font-bold ${textPrimary}`}>{value}</div>
      {detail && <div className={`mt-1 text-xs ${textSecondary}`}>{detail}</div>}
    </div>
  );

  const sections = [
    { key: 'overview' as const, label: '总览', icon: Server },
    { key: 'updates' as const, label: '桌面更新', icon: Megaphone },
    { key: 'backups' as const, label: '云端备份', icon: FileArchive },
    { key: 'connection' as const, label: '连接信息', icon: Link },
    { key: 'resources' as const, label: '资源中心', icon: Box },
    { key: 'records' as const, label: '生成记录', icon: Image },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className={`text-xl font-bold ${textPrimary}`}>本地无界管理</h1>
          <p className={`text-sm ${textSecondary}`}>把旧云端管理系统的桌面更新、备份、连接信息和资源中心合并到云端无界工作台。</p>
        </div>
        <button onClick={() => void loadAll()} className={buttonGhost}>
          <RefreshCw size={13} className={loading ? 'inline mr-1 animate-spin' : 'inline mr-1'} />
          刷新
        </button>
      </div>

      <div className={`mb-5 flex flex-wrap gap-2 rounded-xl p-2 ${isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-gray-100 border border-gray-200'}`}>
        {sections.map(item => (
          <button
            key={item.key}
            onClick={() => setSection(item.key)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${section === item.key ? `${accentBgClass} ${accentTextOnBgClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-white'}`}`}
          >
            <item.icon size={14} />
            {item.label}
          </button>
        ))}
      </div>

      {(section === 'overview' || section === 'backups') && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
          <Stat label="备份总数" value={backups.length} />
          <Stat label="总容量" value={formatBytes(totals.totalSize)} />
          <Stat label="图片备份" value={totals.imageCount} />
          <Stat label="最近备份" value={formatTime(totals.latest)} />
        </div>
      )}

      {section === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
          <Stat label="在线/注册设备" value={devices.length} />
          <Stat label="云端备份" value={backups.length} />
          <Stat label="资源中心" value={resources.length} />
          <Stat label="本地生成记录" value={records.length} />
          <Stat label="桌面更新" value={updateConfig.enabled ? updateConfig.version || '已启用' : '未启用'} />
        </div>
      )}

      {section === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className={`${cardClass} p-4`}>
            <h2 className={`font-semibold mb-3 ${textPrimary}`}>最近设备</h2>
            <ListEmpty show={devices.length === 0} text="暂无本地实例连接" textSecondary={textSecondary} />
            {devices.slice(0, 6).map((item, idx) => (
              <div key={String(item.id || idx)} className="flex items-center justify-between py-2 text-xs border-b border-white/5 last:border-0">
                <div className={textPrimary}>{String(item.device_id || item.deviceId || item.id || 'unknown')}</div>
                <div className={textSecondary}>{formatTime(item.last_seen_at)}</div>
              </div>
            ))}
          </div>
          <div className={`${cardClass} p-4`}>
            <h2 className={`font-semibold mb-3 ${textPrimary}`}>最近备份</h2>
            <ListEmpty show={backups.length === 0} text="暂无备份" textSecondary={textSecondary} />
            {backups.slice(0, 6).map(item => (
              <div key={item.id} className="flex items-center justify-between py-2 text-xs border-b border-white/5 last:border-0">
                <div className={`${textPrimary} truncate`}>{item.originalFilename || item.filename}</div>
                <div className={textSecondary}>{formatBytes(item.size)}</div>
              </div>
            ))}
          </div>
          <div className={`${cardClass} p-4`}>
            <h2 className={`font-semibold mb-3 ${textPrimary}`}>连接配置</h2>
            <pre className={`max-h-40 overflow-auto rounded-lg p-3 text-xs leading-6 ${isDark ? 'bg-black/40 text-white/80' : 'bg-white text-gray-700'}`}>{desktopEnvText}</pre>
          </div>
        </div>
      )}

      {section === 'updates' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Stat label="当前发布版本" value={updateConfig.version || '-'} />
            <Stat label="更新状态" value={updateConfig.enabled ? '已启用' : '未启用'} />
            <Stat label="更新包大小" value={updateConfig.size ? formatBytes(updateConfig.size) : '-'} />
            <Stat label="发布时间" value={formatTime(updateConfig.publishedAt)} />
          </div>

          <div className={`${cardClass} p-5`}>
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h2 className={`font-semibold ${textPrimary}`}>发布更新</h2>
                <p className={`text-xs mt-1 ${textSecondary}`}>支持填写 CDN 下载地址，也支持直接上传 exe/msi/zip 更新包并生成云端下载地址。</p>
              </div>
              <button onClick={() => void saveUpdate()} disabled={savingUpdate} className={buttonPrimary}>
                <Save size={13} className="inline mr-1" />
                {savingUpdate ? '保存中...' : '保存发布'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="版本号"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="例如 3.0.1" value={updateConfig.version} onChange={e => setUpdateConfig(prev => ({ ...prev, version: e.target.value }))} /></Field>
              <Field label="更新包大小（字节，可选）"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="自动上传时会自动填写" value={updateConfig.size ? String(updateConfig.size) : ''} onChange={e => setUpdateConfig(prev => ({ ...prev, size: Number(e.target.value || 0) }))} /></Field>
              <Field label="更新包下载地址" className="md:col-span-2"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="https://.../WujieAI-Setup-3.0.1.exe" value={updateConfig.packageUrl} onChange={e => setUpdateConfig(prev => ({ ...prev, packageUrl: e.target.value }))} /></Field>
              <Field label="直接上传更新包（可选）"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} type="file" accept=".exe,.msi,.zip,.7z,.tar,.gz" onChange={e => setUpdateFile(e.target.files?.[0] || null)} />{updateFile && <p className={`mt-2 text-xs ${textSecondary}`}>{updateFile.name} · {formatBytes(updateFile.size)}</p>}</Field>
              <Field label="SHA256 校验值（可选）"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="用于桌面端下载后校验" value={updateConfig.sha256 || ''} onChange={e => setUpdateConfig(prev => ({ ...prev, sha256: e.target.value }))} /></Field>
              <label className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm ${isDark ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-white'} ${textPrimary}`}><input type="checkbox" checked={updateConfig.enabled} onChange={e => setUpdateConfig(prev => ({ ...prev, enabled: e.target.checked }))} />启用更新提示</label>
              <label className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm ${isDark ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-white'} ${textPrimary}`}><input type="checkbox" checked={updateConfig.mandatory === true} onChange={e => setUpdateConfig(prev => ({ ...prev, mandatory: e.target.checked }))} />标记为重要更新</label>
              <Field label="更新说明" className="md:col-span-2"><textarea className={`w-full h-28 px-3 py-2 rounded-lg border text-sm ${inputClass} resize-y`} placeholder="填写本次修复内容、升级提示等" value={updateConfig.notes || ''} onChange={e => setUpdateConfig(prev => ({ ...prev, notes: e.target.value }))} /></Field>
            </div>
          </div>

          <DataCard title="已上传更新包" action={<button className={buttonGhost} onClick={() => void loadAll()}>刷新</button>} cardClass={cardClass} textPrimary={textPrimary}>
            <Table headers={['文件', '大小 / 时间', '下载地址']}>
              {updateFiles.map(file => (
                <tr key={file.id}>
                  <td><div className={textPrimary}>{file.originalFilename || file.filename}</div><div className={`text-[11px] ${textSecondary}`}>{file.id}</div></td>
                  <td><div>{formatBytes(file.size)}</div><div className={`text-[11px] ${textSecondary}`}>{formatTime(file.createdAt)}</div></td>
                  <td><code className={`text-xs ${textSecondary}`}>/api/desktop/update/download/{file.id}</code></td>
                </tr>
              ))}
              {updateFiles.length === 0 && <EmptyRow colSpan={3} text="暂无上传的更新包" textSecondary={textSecondary} />}
            </Table>
          </DataCard>
        </div>
      )}

      {section === 'backups' && (
        <DataCard
          title="备份列表"
          cardClass={cardClass}
          textPrimary={textPrimary}
          action={
            <div className="flex flex-wrap gap-2">
              <select className={`h-10 rounded-lg border px-3 text-sm ${inputClass}`} value={backupUserFilter} onChange={e => setBackupUserFilter(e.target.value)}>
                <option value="">全部用户</option>
                {users.map(user => <option key={user.id} value={user.id}>{user.username || user.name || user.id}</option>)}
              </select>
              <select className={`h-10 rounded-lg border px-3 text-sm ${inputClass}`} value={backupCategoryFilter} onChange={e => setBackupCategoryFilter(e.target.value)}>
                <option value="">全部类型</option>
                {BACKUP_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button className={buttonGhost} onClick={() => void loadAll()}>刷新</button>
            </div>
          }
        >
          <Table headers={['文件', '用户 / 类型', '大小 / 时间', '操作']}>
            {backups.map(item => (
              <tr key={item.id}>
                <td><div className={`font-medium ${textPrimary}`}>{item.originalFilename || item.filename}</div><div className={`text-[11px] ${textSecondary}`}>{item.id}</div></td>
                <td><div className={`inline-flex rounded-full border px-2 py-1 text-xs ${isDark ? 'border-white/10' : 'border-gray-200'}`}>{item.userId || '-'}</div><div className={`mt-1 text-xs ${textSecondary}`}>{item.category || '-'}</div></td>
                <td><div>{formatBytes(item.size)}</div><div className={`text-xs ${textSecondary}`}>{formatTime(item.createdAt)}</div></td>
                <td><div className="flex gap-2"><a className={buttonGhost} href={`/api/admin/backups/${encodeURIComponent(item.id)}/download`}><Download size={13} className="inline mr-1" />下载</a><button className="rounded-lg px-3 py-2 text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20" onClick={() => setPendingDelete({ kind: 'backup', id: item.id })}><Trash2 size={13} className="inline mr-1" />删除</button></div></td>
              </tr>
            ))}
            {backups.length === 0 && <EmptyRow colSpan={4} text="暂无备份。桌面端本地保存成功后会自动同步一份到这里。" textSecondary={textSecondary} />}
          </Table>
        </DataCard>
      )}

      {section === 'connection' && (
        <div className={`${cardClass} p-5`}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className={`font-semibold ${textPrimary}`}>runtime.env 配置</h2>
              <p className={`text-xs mt-1 ${textSecondary}`}>添加到桌面端 desktop/config/runtime.env 或安装后的配置文件即可连接云端。</p>
            </div>
            <button className={buttonGhost} onClick={() => void copyConnection()}><Clipboard size={13} className="inline mr-1" />复制</button>
          </div>
          <textarea className={`w-full min-h-44 rounded-xl border px-4 py-3 font-mono text-sm leading-7 ${inputClass}`} readOnly value={desktopEnvText} />
          <p className={`mt-4 text-sm leading-7 ${textSecondary}`}>桌面端登录用户账号后，会自动从云端拉取统一模型配置。云端修改后，桌面端重启或调用同步接口即可生效。</p>
        </div>
      )}

      {section === 'resources' && (
        <div className="space-y-5">
          <div className={`${cardClass} p-5`}>
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h2 className={`font-semibold ${textPrimary}`}>{resourceForm.id ? '编辑公共资源' : '新增公共资源'}</h2>
                <p className={`text-xs mt-1 ${textSecondary}`}>不同资源类型会显示不同录入字段；素材、模板、品牌和案例图库支持上传缩略图。</p>
              </div>
              <div className="flex gap-2">
                <button className={buttonGhost} onClick={() => resetResourceForm(resourceForm.type)}>清空</button>
                <button className={buttonPrimary} onClick={() => void saveResource()} disabled={savingResource}><Save size={13} className="inline mr-1" />{savingResource ? '保存中...' : '保存资源'}</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="资源类型"><select className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} value={resourceForm.type} onChange={e => setResourceType(e.target.value)}>{RESOURCE_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><p className={`mt-2 text-xs ${textSecondary}`}>{resourceMeta(resourceForm.type).desc}</p></Field>
              <Field label="资源名称"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} value={resourceForm.name} onChange={e => setResourceForm(prev => ({ ...prev, name: e.target.value }))} /></Field>
              <Field label="描述" className="md:col-span-2"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} value={resourceForm.description} onChange={e => setResourceForm(prev => ({ ...prev, description: e.target.value }))} /></Field>
              <Field label="分类"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} value={resourceForm.category} onChange={e => setResourceForm(prev => ({ ...prev, category: e.target.value }))} /></Field>
              <Field label="标签，逗号分隔"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} value={resourceForm.tags.join(', ')} onChange={e => setResourceForm(prev => ({ ...prev, tags: e.target.value.split(',').map(v => v.trim()).filter(Boolean) }))} /></Field>
              <Field label={resourceMeta(resourceForm.type).thumbnailLabel || '缩略图 URL（可选）'}><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} value={resourceForm.thumbnailUrl.startsWith('data:') ? '已上传本地文件' : resourceForm.thumbnailUrl} onChange={e => setResourceForm(prev => ({ ...prev, thumbnailUrl: e.target.value }))} /></Field>
              <Field label="上传缩略图"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} type="file" accept="image/*" onChange={e => void handleThumbFile(e.target.files?.[0])} /></Field>
              {resourceForm.thumbnailUrl && <div className="md:col-span-2 flex items-center gap-3"><img src={resourceForm.thumbnailUrl} alt="" className="h-20 w-28 rounded-lg object-cover border border-white/10" /><button className={buttonGhost} onClick={() => setResourceForm(prev => ({ ...prev, thumbnailUrl: '' }))}>移除缩略图</button></div>}
              {resourceForm.type === 'material' && <Field label="上传素材文件" className="md:col-span-2"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} type="file" onChange={e => void handleAssetFile(e.target.files?.[0])} /></Field>}
              <Field label={resourceMeta(resourceForm.type).contentLabel} className="md:col-span-2"><textarea className={`w-full h-28 px-3 py-2 rounded-lg border text-sm ${inputClass} resize-y`} value={resourceForm.content} onChange={e => setResourceForm(prev => ({ ...prev, content: e.target.value }))} placeholder={resourceMeta(resourceForm.type).contentPlaceholder} /></Field>
              {resourceForm.type === 'ecom-template' && <><Field label="模板 ID"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} onChange={e => updatePayloadField('id', e.target.value)} placeholder="white-bg-main" /></Field><Field label="画面比例"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} onChange={e => updatePayloadField('aspectRatio', e.target.value)} placeholder="1:1" /></Field></>}
              {resourceForm.type === 'brand-template' && <><Field label="主色"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} type="color" onChange={e => updatePayloadField('primaryColor', e.target.value)} defaultValue="#d4af37" /></Field><Field label="辅助色"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} type="color" onChange={e => updatePayloadField('secondaryColor', e.target.value)} defaultValue="#111111" /></Field></>}
              {resourceForm.type === 'agent-template' && <><Field label="最大轮次"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} type="number" min={1} max={10} onChange={e => updatePayloadField('maxRounds', Number(e.target.value || 5))} defaultValue={5} /></Field><Field label="默认工具，逗号分隔"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} onChange={e => updatePayloadField('tools', e.target.value.split(',').map(v => v.trim()).filter(Boolean))} /></Field></>}
              {(resourceForm.type === 'workflow-template' || resourceForm.type === 'favorite-preset' || resourceForm.type === 'font-gallery') && <div className={`md:col-span-2 rounded-lg border p-3 text-sm ${isDark ? 'border-white/10 bg-black/20 text-white/60' : 'border-gray-200 bg-white text-gray-500'}`}>{resourceForm.type === 'workflow-template' && '请在高级 JSON 中填写 nodes、edges、version 等工作流结构。'}{resourceForm.type === 'favorite-preset' && '请在高级 JSON 中填写 targetTool 与 settings，用户端会作为管理员预设调用。'}{resourceForm.type === 'font-gallery' && '请上传案例缩略图，并在高级 JSON 中填写 style、fontMood、referenceUrl 等字段。'}</div>}
              <Field label="高级 JSON 参数" className="md:col-span-2"><textarea className={`w-full h-32 px-3 py-2 rounded-lg border text-sm font-mono ${inputClass} resize-y`} value={resourcePayloadText} onChange={e => setResourcePayloadText(e.target.value)} /></Field>
              <label className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm ${isDark ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-white'} ${textPrimary}`}><input type="checkbox" checked={resourceForm.enabled} onChange={e => setResourceForm(prev => ({ ...prev, enabled: e.target.checked }))} />启用资源</label>
              <Field label="排序"><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} type="number" value={resourceForm.sortOrder} onChange={e => setResourceForm(prev => ({ ...prev, sortOrder: Number(e.target.value || 0) }))} /></Field>
            </div>
          </div>

          <DataCard title="公共资源列表" cardClass={cardClass} textPrimary={textPrimary} action={<div className="relative"><Search size={14} className={`absolute left-3 top-3 ${textSecondary}`} /><input className={`h-10 w-64 rounded-lg border pl-9 pr-3 text-sm ${inputClass}`} placeholder="搜索资源" value={resourceSearch} onChange={e => setResourceSearch(e.target.value)} /></div>}>
            <Table headers={['资源', '类型 / 分类', '状态', '操作']}>
              {filteredResources.map(item => (
                <tr key={item.id}>
                  <td><div className="flex items-center gap-3">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-11 w-14 rounded object-cover" /> : <div className="h-11 w-14 rounded bg-black/20" />}<div><div className={`font-medium ${textPrimary}`}>{item.name}</div><div className={`text-xs ${textSecondary}`}>{item.description || item.id}</div></div></div></td>
                  <td><div>{resourceMeta(item.type).label}</div><div className={`text-xs ${textSecondary}`}>{item.category || '-'}</div></td>
                  <td>{item.enabled ? <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 size={13} />启用</span> : <span className={textSecondary}>停用</span>}</td>
                  <td><div className="flex gap-2"><button className={buttonGhost} onClick={() => editResource(item)}>编辑</button><button className="rounded-lg px-3 py-2 text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20" onClick={() => setPendingDelete({ kind: 'resource', id: item.id })}>删除</button></div></td>
                </tr>
              ))}
              {filteredResources.length === 0 && <EmptyRow colSpan={4} text="暂无公共资源" textSecondary={textSecondary} />}
            </Table>
          </DataCard>
        </div>
      )}

      {section === 'records' && (
        <DataCard title="本地生成记录" cardClass={cardClass} textPrimary={textPrimary} action={<input className={`h-10 w-72 rounded-lg border px-3 text-sm ${inputClass}`} placeholder="搜索提示词、模型、用户或设备" value={recordSearch} onChange={e => setRecordSearch(e.target.value)} />}>
          <Table headers={['缩略图', '提示词 / 模型', '用户 / 设备', '时间']}>
            {filteredRecords.map((item, idx) => (
              <tr key={String(item.id || idx)}>
                <td>{item.thumbnail_url ? <img src={String(item.thumbnail_url)} alt="" className="h-16 w-16 rounded object-cover" /> : <div className="h-16 w-16 rounded bg-black/20" />}</td>
                <td><div className={`${textPrimary} max-w-xl truncate`}>{String(item.prompt || '无提示词')}</div><div className={`text-xs ${textSecondary}`}>{String(item.model || '-')}</div></td>
                <td><div>{String(item.user_id || '-')}</div><div className={`text-xs ${textSecondary}`}>{String(item.device_id || '-')}</div></td>
                <td>{formatTime(item.created_at || item.createdAt)}</td>
              </tr>
            ))}
            {filteredRecords.length === 0 && <EmptyRow colSpan={4} text="暂无本地生成记录。这里只展示缩略图和生成参数，不保存完整大图。" textSecondary={textSecondary} />}
          </Table>
        </DataCard>
      )}

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={open => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === 'resource' ? '删除后公共资源将无法恢复。' : '删除后云端备份将无法恢复。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-2 text-xs font-medium text-zinc-400">{label}</div>
      {children}
    </label>
  );
}

function DataCard({ title, action, children, cardClass, textPrimary }: { title: string; action?: React.ReactNode; children: React.ReactNode; cardClass: string; textPrimary: string }) {
  return (
    <div className={`${cardClass} p-5`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={`font-semibold ${textPrimary}`}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs text-zinc-500">
            {headers.map(header => <th key={header} className="px-3 py-3 font-medium">{header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 [&_td]:px-3 [&_td]:py-3">
          {children}
        </tbody>
      </table>
    </div>
  );
}

function EmptyRow({ colSpan, text, textSecondary }: { colSpan: number; text: string; textSecondary: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className={`py-8 text-center text-sm ${textSecondary}`}>{text}</div>
      </td>
    </tr>
  );
}

function ListEmpty({ show, text, textSecondary }: { show: boolean; text: string; textSecondary: string }) {
  if (!show) return null;
  return <div className={`py-6 text-sm ${textSecondary}`}>{text}</div>;
}
