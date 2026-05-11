'use client';

import { useState, useCallback } from 'react';
import { Upload, Loader2, Wand2, Sparkles, Package } from 'lucide-react';

interface ImageAnalyzerProps {
  onAnalyze: (imageUrl: string) => void;
  onPromptGenerated: (prompt: string) => void;
  productCategory?: string;
}

// 产品精修选项（与产品品类保持一致）
const PRODUCT_REFINE_OPTIONS = [
  { value: 'none', label: '选择产品类型' },
  { value: 'baijiu', label: '白酒' },
  { value: 'beer', label: '啤酒' },
  { value: 'foreign_wine', label: '洋酒' },
  { value: 'liquor', label: '威士忌' },
  { value: 'cocktail', label: '鸡尾酒' },
  { value: 'tea', label: '茶饮' },
  { value: 'coffee', label: '咖啡' },
  { value: 'food', label: '食品' },
  { value: 'cosmetics', label: '化妆品' },
  { value: 'electronics', label: '电子' },
  { value: 'fashion', label: '服装' },
];

// 产品精修提示词模板
const PRODUCT_REFINE_PROMPTS: Record<string, { title: string; description: string; keywords: string[] }> = {
  baijiu: {
    title: '白酒精修',
    description: '高端白酒产品精修',
    keywords: ['高端白酒', '年份老酒', '酱香型', '浓香型', '清香型', '瓶身质感', '液体通透感', '礼盒包装', '光影氛围', '商务风格'],
  },
  beer: {
    title: '啤酒精修',
    description: '啤酒产品精修',
    keywords: ['精酿啤酒', '拉格', '艾尔', '小麦啤酒', 'IPA', '泡沫质感', '冰镇效果', '清新感', '聚会场景', '活力氛围'],
  },
  foreign_wine: {
    title: '洋酒精修',
    description: '洋酒产品精修',
    keywords: ['干邑白兰地', '威士忌', '朗姆酒', '伏特加', '金酒', '酒瓶质感', '水晶杯', '绅士风格', '酒吧氛围', '高端调酒'],
  },
  liquor: {
    title: '威士忌精修',
    description: '威士忌产品精修',
    keywords: ['单一麦芽', '调和威士忌', '泥煤味', '橡木桶陈酿', '琥珀色酒液', '古典酒杯', '雪茄氛围', '绅士格调', '英伦风格', '收藏级'],
  },
  cocktail: {
    title: '鸡尾酒精修',
    description: '鸡尾酒产品精修',
    keywords: ['创意鸡尾酒', '经典鸡尾酒', '莫吉托', '马天尼', '彩虹层', '水果装饰', '冰块质感', '吧台氛围', '霓虹灯光', '派对风格'],
  },
  tea: {
    title: '茶饮精修',
    description: '茶饮产品精修',
    keywords: ['新式茶饮', '传统茶', '奶茶', '果茶', '茶汤色泽', '茶具搭配', '中式风格', '日式茶道', '清新自然', '慢生活氛围'],
  },
  coffee: {
    title: '咖啡精修',
    description: '咖啡产品精修',
    keywords: ['精品咖啡', '拿铁艺术', '冷萃', '浓缩', '拉花图案', '咖啡豆', '复古咖啡馆', '文艺氛围', '暖色调', '下午茶场景'],
  },
  food: {
    title: '食品精修',
    description: '食品产品精修',
    keywords: ['美食摄影', '甜点', '烘焙', '中餐', '西餐', '新鲜食材', '食欲感', '暖色光影', '精致摆盘', '高级餐厅风格'],
  },
  cosmetics: {
    title: '化妆品精修',
    description: '化妆品产品精修',
    keywords: ['美妆产品', '护肤品', '口红', '香水', '玻璃瓶质感', '光泽感', '高级感', '女性化', '时尚风格', '杂志封面质感'],
  },
  electronics: {
    title: '电子产品精修',
    description: '电子产品精修',
    keywords: ['科技产品', '手机', '电脑', '耳机', '智能手表', '金属质感', '极简风格', '科技感', '蓝色光效', '未来感'],
  },
  fashion: {
    title: '服装精修',
    description: '服装产品精修',
    keywords: ['时尚服装', '运动装', '正装', '休闲装', '面料质感', '模特展示', '街拍风格', '杂志大片', '潮流感', '高级时装'],
  },
};

export function ImageAnalyzer({ onAnalyze, onPromptGenerated, productCategory }: ImageAnalyzerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [mode, setMode] = useState<'analyze' | 'refine'>('analyze');
  const [selectedProduct, setSelectedProduct] = useState<string>('none');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleImageUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请上传图片文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setPreviewUrl(result);
      onAnalyze(result);
    };
    reader.readAsDataURL(file);
  }, [onAnalyze]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleImageUpload(file);
    }
  }, [handleImageUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
  }, [handleImageUpload]);

  const handleAnalyze = async () => {
    if (!previewUrl) return;
    
    setIsAnalyzing(true);
    
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: previewUrl,
          category: productCategory || 'general',
        }),
      });
      
      const data = await response.json();
      
      if (data.success && data.prompt) {
        onPromptGenerated(data.prompt);
      } else {
        onPromptGenerated('分析失败，请重试');
      }
    } catch (error) {
      console.error('分析失败:', error);
      onPromptGenerated('分析失败，请重试');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRefine = () => {
    if (selectedProduct === 'none' || !previewUrl) return;
    
    const productData = PRODUCT_REFINE_PROMPTS[selectedProduct];
    if (productData) {
      const prompt = `产品精修 - ${productData.title}\n\n${productData.keywords.join(', ')}`;
      onPromptGenerated(prompt);
    }
  };

  const isRefineMode = mode === 'refine';

  return (
    <div className="space-y-3">
      {/* 模式切换 */}
      <div className="flex items-center gap-2 p-1 bg-[#1a1a1a] rounded-lg">
        <button
          onClick={() => setMode('analyze')}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
            !isRefineMode
              ? 'bg-[#d4af37] text-black shadow-md'
              : 'text-[#888] hover:text-white'
          }`}
        >
          <Wand2 className="h-3 w-3 inline mr-1" />
          以图生词
        </button>
        <button
          onClick={() => setMode('refine')}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
            isRefineMode
              ? 'bg-[#d4af37] text-black shadow-md'
              : 'text-[#888] hover:text-white'
          }`}
        >
          <Sparkles className="h-3 w-3 inline mr-1" />
          产品精修
        </button>
      </div>

      {/* 上传区域 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer ${
          isDragging
            ? 'border-[#d4af37] bg-[#d4af37]/10'
            : 'border-[#2a2a2a] hover:border-[#3a3a3a]'
        }`}
      >
        <input
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        
        {previewUrl ? (
          <div className="space-y-2">
            <img
              src={previewUrl}
              alt="预览"
              className="max-h-24 mx-auto rounded-lg object-contain"
            />
            <p className="text-xs text-[#888]">点击或拖拽更换图片</p>
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 mx-auto mb-2 text-[#555]" />
            <p className="text-xs text-[#888]">
              拖拽图片到这里，或<span className="text-[#d4af37]">点击上传</span>
            </p>
            <p className="text-xs text-[#555] mt-1">支持 JPG、PNG、WebP</p>
          </>
        )}
      </div>

      {/* 产品精修选项 */}
      {isRefineMode && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs font-medium text-[#666] uppercase tracking-wider">
            <Package className="h-3 w-3 text-[#d4af37]" />
            选择产品类型
          </label>
          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="w-full h-9 px-3 bg-[#141414] border border-[#2a2a2a] rounded-lg text-xs text-[#ddd] focus:outline-none focus:border-[#d4af37]"
          >
            {PRODUCT_REFINE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          
          {/* 产品预览 */}
          {selectedProduct !== 'none' && PRODUCT_REFINE_PROMPTS[selectedProduct] && (
            <div className="p-3 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a]">
              <h4 className="text-xs font-medium text-[#d4af37] mb-2">
                {PRODUCT_REFINE_PROMPTS[selectedProduct].title}
              </h4>
              <div className="flex flex-wrap gap-1">
                {PRODUCT_REFINE_PROMPTS[selectedProduct].keywords.map((keyword, index) => (
                  <span
                    key={index}
                    className="px-2 py-0.5 bg-[#2a2a2a] rounded text-xs text-[#999]"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <button
        onClick={isRefineMode ? handleRefine : handleAnalyze}
        disabled={!previewUrl || (isRefineMode && selectedProduct === 'none') || isAnalyzing}
        className={`w-full h-9 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
          previewUrl && (!isRefineMode || selectedProduct !== 'none')
            ? 'bg-[#d4af37] text-black hover:bg-[#c9a436] shadow-md'
            : 'bg-[#2a2a2a] text-[#555] cursor-not-allowed'
        }`}
      >
        {isAnalyzing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            分析中...
          </>
        ) : isRefineMode ? (
          <>
            <Sparkles className="h-4 w-4" />
            {selectedProduct !== 'none' ? '应用精修' : '请选择产品类型'}
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4" />
            一键分析
          </>
        )}
      </button>
    </div>
  );
}
