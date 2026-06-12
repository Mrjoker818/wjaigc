/**
 * 导出扩展模板
 * Logo 生成结果的多格式导出能力
 */

export interface ExportOption {
  id: string;
  label: string;
  format: string;
  description: string;
  icon: string;
}

/**
 * 可用的 Logo 导出格式
 */
export const LOGO_EXPORT_OPTIONS: ExportOption[] = [
  { id: 'png', label: 'PNG', format: 'png', description: '标准位图，适合屏幕显示', icon: '🖼️' },
  { id: 'svg', label: 'SVG', format: 'svg', description: '矢量格式，无限缩放不失真', icon: '📐' },
  { id: 'psd', label: 'PSD', format: 'psd', description: 'Photoshop 源文件，分层编辑', icon: '🎨' },
  { id: 'pdf', label: 'PDF', format: 'pdf', description: '印刷标准，支持矢量', icon: '📄' },
  { id: 'eps', label: 'EPS', format: 'eps', description: '专业矢量，兼容印刷流程', icon: '✏️' },
];

/**
 * 导出尺寸预设
 */
export const LOGO_EXPORT_SIZES = [
  { id: 'small', label: '小 (256px)', width: 256, height: 256 },
  { id: 'medium', label: '中 (512px)', width: 512, height: 512 },
  { id: 'large', label: '大 (1024px)', width: 1024, height: 1024 },
  { id: 'xlarge', label: '超大 (2048px)', width: 2048, height: 2048 },
  { id: 'original', label: '原始尺寸', width: 0, height: 0 },
];

/**
 * 构建导出文件名
 */
export function buildExportFileName(brandName: string, format: string, size?: string): string {
  const safeName = brandName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
  const sizeSuffix = size && size !== 'original' ? `_${size}` : '';
  return `${safeName}_logo${sizeSuffix}.${format}`;
}
