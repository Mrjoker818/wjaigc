/**
 * 品牌包装系统 Pro - Prompt 模板
 */

interface PackagingInput {
  brandName: string;
  productName: string;
  category: string;
  structure: {
    type: string;
    length?: number;
    width?: number;
    height?: number;
    capacity?: string;
    netContent?: string;
  };
  materialCraft: {
    materials: string[];
    crafts: string[];
    costLevel?: string;
  };
  outputModes: string[];
  brandAssets?: {
    logoUrl?: string;
    brandColors?: string[];
    fontStyle?: string;
    patterns?: string[];
  };
  skuMatrix?: Array<{ name: string; spec: string; isHero: boolean }>;
  extendScenes?: string[];
  uploads?: Array<{ url: string; type: string }>;
}

/** 根据品类获取场景关键词 */
function getCategorySceneHint(category: string): string {
  const map: Record<string, string> = {
    '美妆 / 护肤': '梳妆台、美妆店柜台、高端商场化妆品专柜',
    '美妆护肤': '梳妆台、美妆店柜台、高端商场化妆品专柜',
    '食品': '超市货架、美食展台、厨房料理台',
    '食品零食': '超市货架、美食展台、厨房料理台',
    '零食 / 糖果': '零食货架、甜品展台、便利店',
    '饮品': '便利店冰柜、饮品展区、家庭餐桌',
    '茶叶': '茶室、茶席、中式书房、禅意空间',
    '咖啡': '咖啡馆、精品咖啡展台、办公休闲区',
    '酒水': '酒吧台、餐厅、酒窖、便利店冰柜',
    '酒水饮料': '酒吧台、餐厅、酒窖、便利店冰柜',
    '调味品': '厨房料理台、超市调味品区、美食烹饪台',
    '日化': '浴室、洗衣区、超市日化区、家庭清洁空间',
    '礼盒': '节日氛围、高奢展厅、礼品专柜',
    '宠物': '宠物店、温馨家庭、户外公园',
    '保健': '药房柜台、健康生活馆、中式滋补展示柜',
    '保健滋补': '药房柜台、健康生活馆、中式滋补展示柜',
    '电子 / 数码': '科技展厅、办公桌面、极简生活空间',
    '数码3C': '科技展厅、办公桌面、极简生活空间',
    '家居': '家居场景、浴室、客厅、厨房',
    '家居日用': '家居场景、浴室、客厅、厨房',
    '母婴': '母婴店、婴儿房、亲子空间',
    '母婴用品': '母婴店、婴儿房、亲子空间',
    '文具': '办公桌面、文具店、创意工作台',
    '文具办公': '办公桌面、文具店、创意工作台',
    '服装': '时装店、衣帽间、精品店橱窗',
    '服装配饰': '时装店、衣帽间、精品店橱窗',
    '玩具': '玩具店、儿童房、游戏空间',
    '珠宝首饰': '珠宝专柜、高奢展厅、婚庆场景',
    '汽车用品': '汽车内饰、4S店展示、车载场景',
    '农副产品': '有机农场、市集摊位、田园场景',
    '运动户外': '运动场馆、户外营地、健身房',
    '文创礼品': '文创市集、博物馆商店、节日氛围',
  };
  return map[category] || '高端零售环境';
}

/** 根据品类获取包装文案调性关键词 */
function getCategoryToneHint(category: string): string {
  const map: Record<string, string> = {
    '美妆 / 护肤': '优雅、精致、高端、科学感、女性气质',
    '美妆护肤': '优雅、精致、高端、科学感、女性气质',
    '食品': '诱人、新鲜、活力、温暖、食欲感',
    '食品零食': '诱人、新鲜、活力、温暖、食欲感',
    '零食 / 糖果': '活力、甜蜜、趣味、色彩丰富',
    '饮品': '清爽、畅快、自然、活力',
    '茶叶': '雅致、禅意、文化、古典、静谧',
    '咖啡': '醇厚、文艺、温暖、品质',
    '酒水': '豪迈、品质、社交、节庆、欢聚',
    '酒水饮料': '豪迈、品质、社交、节庆、欢聚',
    '调味品': '美味、地道、鲜香、传统',
    '日化': '清新、专业、高效、安心',
    '礼盒': '精致、仪式感、高雅、尊贵',
    '宠物': '可爱、温馨、活力、关爱',
    '保健': '专业、信赖、传统、珍稀、养生',
    '保健滋补': '专业、信赖、传统、珍稀、养生',
    '电子 / 数码': '科技、简约、未来感、专业、高效',
    '数码3C': '科技、简约、未来感、专业、高效',
    '家居': '舒适、实用、温馨、品质生活',
    '家居日用': '舒适、实用、温馨、品质生活',
    '母婴': '温暖、安心、柔和、呵护、可爱',
    '母婴用品': '温暖、安心、柔和、呵护、可爱',
    '文具': '清新、创意、专业、文艺',
    '文具办公': '清新、创意、专业、文艺',
    '服装': '时尚、个性、潮流、质感',
    '服装配饰': '时尚、个性、潮流、质感',
    '玩具': '趣味、创意、安全、色彩明快',
    '珠宝首饰': '奢华、璀璨、永恒、浪漫',
    '汽车用品': '科技、安全、高端、实用',
    '农副产品': '自然、有机、朴实、地道',
    '运动户外': '动感、挑战、自由、能量',
    '文创礼品': '创意、文化、艺术、仪式感',
  };
  return map[category] || '专业、高端、精致';
}

/** 根据材质获取质感描述 */
function getMaterialTextureHint(materials: string[]): string {
  const hints: string[] = [];
  for (const m of materials) {
    const map: Record<string, string> = {
      '白卡纸': '表面光滑细腻的白色纸质感',
      '铜版纸': '光亮平滑的铜版印刷质感',
      '牛皮纸': '自然质朴的棕色牛皮纸纹理',
      '特种纸': '有独特触感和纹理的特种纸张',
      '瓦楞纸': '有瓦楞波纹的结构纸板质感',
      '灰板纸': '坚实厚重的灰色纸板',
      '珠光纸': '闪烁珠光光泽的纸面效果',
      '黑卡纸': '沉稳高级的黑色卡纸质感',
      'PET': '透明或半透明的塑料光泽感',
      'PP': '柔韧半透明的塑料质感',
      'PE': '柔软有弹性的塑料触感',
      '磨砂亚克力': '高级磨砂质感的半透明效果',
      '马口铁': '金属光泽的镀锡铁质感',
      '铝合金': '轻质银白色金属光泽',
      '玻璃': '通透清亮的玻璃折射效果',
      '陶瓷': '温润细腻的陶瓷釉面质感',
      '甘蔗渣': '自然纤维纹理的环保材质',
      '竹纤维': '天然竹纹肌理的环保质感',
      '可降解PLA': '柔和哑光的环保塑料质感',
    };
    if (map[m]) hints.push(map[m]);
  }
  return hints.join('；') || '真实材质质感';
}

export function buildPackagingRenderPrompt(input: PackagingInput): string {
  const dimParts: string[] = [];
  if (input.structure.length) dimParts.push(`长${input.structure.length}`);
  if (input.structure.width) dimParts.push(`宽${input.structure.width}`);
  if (input.structure.height) dimParts.push(`高${input.structure.height}`);
  const dimStr = dimParts.length > 0 ? dimParts.join('×') + 'mm' : '';
  const capacityStr = input.structure.capacity ? `，容量：${input.structure.capacity}` : '';
  const netContentStr = input.structure.netContent ? `，净含量：${input.structure.netContent}` : '';

  const skuInfo = input.skuMatrix?.length
    ? `系列SKU: ${input.skuMatrix.map(s => `${s.name}(${s.spec})`).join('、')}`
    : '';

  const colorInfo = input.brandAssets?.brandColors?.length
    ? `品牌色: ${input.brandAssets.brandColors.join('、')}`
    : '';

  const fontInfo = input.brandAssets?.fontStyle
    ? `字体风格: ${input.brandAssets.fontStyle}`
    : '';

  const patternInfo = input.brandAssets?.patterns?.length
    ? `品牌图案元素: ${input.brandAssets.patterns.join('、')}`
    : '';

  const extendInfo = input.extendScenes?.length
    ? `延展场景: ${input.extendScenes.join('、')}`
    : '';

  const toneHint = getCategoryToneHint(input.category);
  const textureHint = getMaterialTextureHint(input.materialCraft?.materials || []);

  return `为品牌「${input.brandName}」设计一套商业级包装效果图。
产品名称：${input.productName}
品类：${input.category}
包装结构：${input.structure.type}${dimStr ? '，规格：' + dimStr : ''}${capacityStr}${netContentStr}
材质：${input.materialCraft?.materials?.join('、') || '未指定'}
工艺：${input.materialCraft?.crafts?.join('、') || '未指定'}
材质质感要求：${textureHint}
${skuInfo ? skuInfo + '\n' : ''}${colorInfo ? colorInfo + '\n' : ''}${fontInfo ? fontInfo + '\n' : ''}${patternInfo ? patternInfo + '\n' : ''}${extendInfo ? extendInfo + '\n' : ''}
设计要求：
1. 包装需要具有真实商业落地感，专业摄影级效果图。
2. 保持品牌名「${input.brandName}」清晰可见，文字排版工整。
3. 视觉风格：${toneHint}。
4. 材质表现真实，包括${textureHint}，以及${input.materialCraft?.crafts?.join('、') || '印刷'}等工艺细节。
5. 光影效果自然，高光和阴影层次丰富，突出包装立体感。
6. 输出适合品牌提案、电商展示和线下货架展示。
7. 不要生成乱码文字，不要出现错误品牌名，不要出现无关品牌。
8. 所有文字内容必须可辨识，不允许模糊、变形或无法阅读的文字。
输出方向：${input.outputModes.join('、')}`;
}

export function buildPackagingFlatPrompt(input: PackagingInput): string {
  const dimStr = [input.structure.length, input.structure.width, input.structure.height]
    .filter(Boolean).join('×') + 'mm';

  return `为品牌「${input.brandName}」的「${input.productName}」生成包装展开图。
包装结构：${input.structure.type}${dimStr ? '，规格：' + dimStr : ''}
材质工艺：${input.materialCraft?.materials?.join('、') || '未指定'} / ${input.materialCraft?.crafts?.join('、') || '未指定'}
品类调性：${getCategoryToneHint(input.category)}

画面要求：
1. 以包装平面展开图形式呈现，包含正面、背面、侧面、顶部、底部。
2. 需要有品牌Logo区、产品名称区、卖点区、成分区、条码区、信息区。
3. 展开图需要具备真实包装设计逻辑，各面之间有合理的折痕线。
4. 这是视觉展开图/结构参考展开图，不是最终印刷刀版。
5. 文字排版工整清晰，品牌名「${input.brandName}」醒目。
6. 视觉风格：${getCategoryToneHint(input.category)}。
7. 尽量减少复杂小字，避免乱码。`;
}

export function buildPackagingCopywritingPrompt(input: PackagingInput): string {
  const toneHint = getCategoryToneHint(input.category);

  let categorySpecific = '';
  // 使用 category 匹配（支持新旧两种标签格式）
  const cat = input.category;
  if (cat === '美妆 / 护肤' || cat === '美妆护肤') {
    categorySpecific = '6. 功效宣称文案（符合化妆品法规）\n7. 适合肤质说明';
  } else if (cat === '食品' || cat === '食品零食') {
    categorySpecific = '6. 营养成分描述\n7. 保质期与储存说明';
  } else if (cat === '零食 / 糖果') {
    categorySpecific = '6. 营养成分与热量\n7. 口味特点描述';
  } else if (cat === '饮品') {
    categorySpecific = '6. 原料产地与纯净度\n7. 饮用场景推荐';
  } else if (cat === '茶叶') {
    categorySpecific = '6. 产地与品种描述\n7. 冲泡方式说明';
  } else if (cat === '咖啡') {
    categorySpecific = '6. 咖啡豆产地与烘焙度\n7. 冲煮方式推荐';
  } else if (cat === '酒水' || cat === '酒水饮料') {
    categorySpecific = '6. 酒精度/原麦汁浓度\n7. 饮用场景推荐';
  } else if (cat === '调味品') {
    categorySpecific = '6. 配料表与营养成分\n7. 烹饪搭配建议';
  } else if (cat === '日化') {
    categorySpecific = '6. 活性成分与功效\n7. 使用方法与注意事项';
  } else if (cat === '礼盒') {
    categorySpecific = '6. 礼盒场景文案（节日/商务/婚庆）\n7. 开箱体验描述';
  } else if (cat === '宠物') {
    categorySpecific = '6. 适用宠物类型\n7. 成分与喂食说明';
  } else if (cat === '保健' || cat === '保健滋补') {
    categorySpecific = '6. 适宜人群与功效\n7. 食用方法与剂量';
  } else if (cat === '电子 / 数码' || cat === '数码3C') {
    categorySpecific = '6. 技术参数亮点\n7. 兼容性与规格';
  } else if (cat === '家居' || cat === '家居日用') {
    categorySpecific = '6. 材质与尺寸说明\n7. 使用与保养建议';
  } else if (cat === '母婴' || cat === '母婴用品') {
    categorySpecific = '6. 适用年龄/阶段\n7. 安全认证说明';
  } else if (cat === '文具' || cat === '文具办公') {
    categorySpecific = '6. 书写性能与材质\n7. 适用场景说明';
  } else if (cat === '服装' || cat === '服装配饰') {
    categorySpecific = '6. 材质与尺码说明\n7. 洗护建议';
  } else if (cat === '玩具') {
    categorySpecific = '6. 适用年龄与安全认证\n7. 玩法说明与注意事项';
  } else if (cat === '珠宝首饰') {
    categorySpecific = '6. 材质与镶嵌说明\n7. 保养建议';
  } else if (cat === '汽车用品') {
    categorySpecific = '6. 适用车型与安装说明\n7. 安全认证与质保';
  } else if (cat === '农副产品') {
    categorySpecific = '6. 产地与种植方式\n7. 烹饪/食用建议';
  } else if (cat === '运动户外') {
    categorySpecific = '6. 功能科技说明\n7. 使用场景推荐';
  } else {
    categorySpecific = '6. 产品核心参数\n7. 使用/食用说明';
  }

  return `为品牌「${input.brandName}」的「${input.productName}」生成包装文案。
品类：${input.category}
包装结构：${input.structure.type}
文案调性：${toneHint}

请生成以下内容：
1. 产品卖点文案（3-5个，每句8字以内）
2. 成分/材质说明文案
3. 使用方法文案
4. 品牌Slogan
5. 注意事项文案
${categorySpecific}

要求：
- 文案需要符合${input.category}品类调性（${toneHint}）
- 语言简洁有力，适合包装排版
- 不要过于夸张，保持商业落地感
- 符合相关品类的法规要求`;
}

export function buildPackagingScenePrompt(input: PackagingInput): string {
  const sceneHint = getCategorySceneHint(input.category);
  const toneHint = getCategoryToneHint(input.category);
  const textureHint = getMaterialTextureHint(input.materialCraft?.materials || []);

  return `为品牌「${input.brandName}」的「${input.productName}」生成包装场景展示图。
包装结构：${input.structure.type}
材质：${input.materialCraft?.materials?.join('、') || '未指定'}
质感：${textureHint}
品类：${input.category}

场景要求：
1. 产品在${sceneHint}中的场景展示。
2. 光线柔和高级，产品质感清晰，突出${textureHint}。
3. 视觉风格：${toneHint}。
4. 可包含货架陈列、橱窗展示、电商主图风格。
5. 保持品牌名「${input.brandName}」清晰可见。
6. 不要出现乱码文字，所有文字内容可辨识。`;
}

export function buildPackagingShelfPrompt(input: PackagingInput): string {
  const sceneHint = getCategorySceneHint(input.category);
  const toneHint = getCategoryToneHint(input.category);

  return `为品牌「${input.brandName}」的「${input.productName}」生成货架陈列效果图。
品类：${input.category}
包装结构：${input.structure.type}
陈列场景：${sceneHint}

陈列要求：
1. 多款产品整齐排列在${sceneHint}货架上。
2. 货架环境真实，有同类竞品对比效果更佳。
3. 主推产品位于视线最佳位置，视觉焦点突出。
4. 品牌识别度高，系列感强，色调统一。
5. 视觉风格：${toneHint}。
6. 不要出现乱码文字。`;
}

export function buildPackagingSeriesPrompt(input: PackagingInput): string {
  const skuInfo = input.skuMatrix?.length
    ? `系列包含: ${input.skuMatrix.map(s => s.name).join('、')}`
    : '系列包含多个SKU';
  const toneHint = getCategoryToneHint(input.category);
  const textureHint = getMaterialTextureHint(input.materialCraft.materials);

  return `为品牌「${input.brandName}」生成系列包装全家福图。
${skuInfo}
包装结构：${input.structure.type}
材质：${input.materialCraft.materials.join('、')}
质感：${textureHint}
品类：${input.category}

画面要求：
1. 全系列产品统一排列展示，系列感强，视觉统一但有区分。
2. 摆放美观，适合品牌画册和电商Banner。
3. 品牌名「${input.brandName}」清晰可见，不要出现乱码文字。
4. 视觉风格：${toneHint}。
5. 材质质感真实：${textureHint}。`;
}

/** 品牌DNA提示词 — 用于整体品牌包装调性指导 */
export function buildBrandDnaPrompt(input: PackagingInput): string {
  const toneHint = getCategoryToneHint(input.category);
  const colorInfo = input.brandAssets?.brandColors?.length
    ? `品牌色: ${input.brandAssets.brandColors.join('、')}`
    : '';

  return `品牌「${input.brandName}」包装设计DNA：
品类：${input.category}
调性关键词：${toneHint}
${colorInfo ? colorInfo + '\n' : ''}
设计原则：
1. 所有包装输出必须保持品牌视觉一致性。
2. 色彩以品牌色为主调，辅以品类适配的搭配色。
3. 字体排版层级清晰：品牌名>产品名>卖点>说明文字。
4. 材质与工艺选择体现品牌定位和价格带。
5. 系列产品保持统一的视觉框架，通过色彩/图案区分SKU。`;
}
