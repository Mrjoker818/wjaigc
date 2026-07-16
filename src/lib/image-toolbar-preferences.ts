export const DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER = [
  '放大', '移除背景', 'SVG智能描摹', '美陈拆解', '擦除', '蒙版', '调色',
  '编辑元素', '多角度', '图转3D工厂', '扩展', '裁切', '全景生成', '精修引擎',
  '人物精修大师', '语言修图', 'Agent编排', '下载',
] as const;

export interface ImageToolbarPreferences {
  order: string[];
  hidden: string[];
}

export function normalizeImageToolbarPreferences(
  savedOrder: unknown,
  savedHidden: unknown
): ImageToolbarPreferences {
  const supportedItems = new Set<string>(DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER);
  const legacyOrder = Array.isArray(savedOrder)
    ? savedOrder.filter((item): item is string => typeof item === 'string' && supportedItems.has(item))
    : [];
  const orderedLegacyItems = [...new Set(legacyOrder)];
  const order = [...orderedLegacyItems];
  for (let index = 0; index < DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER.length; index += 1) {
    const item = DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER[index];
    if (order.includes(item)) continue;

    const nextKnownItem = DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER
      .slice(index + 1)
      .find(candidate => order.includes(candidate));
    if (nextKnownItem) {
      order.splice(order.indexOf(nextKnownItem), 0, item);
      continue;
    }

    const previousKnownItem = DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER
      .slice(0, index)
      .reverse()
      .find(candidate => order.includes(candidate));
    order.splice(previousKnownItem ? order.indexOf(previousKnownItem) + 1 : order.length, 0, item);
  }
  const legacyItems = new Set(orderedLegacyItems);
  const hidden = Array.isArray(savedHidden)
    ? [...new Set(savedHidden.filter((item): item is string => typeof item === 'string' && legacyItems.has(item)))]
    : [];

  return { order, hidden };
}
