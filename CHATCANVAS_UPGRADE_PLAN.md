# ChatCanvas 升级详细计划

## 一、功能定义

ChatCanvas 是画布级 AI 交互系统：用户在画布上直接标注修改意见，AI 理解并执行，结果实时回画布。不离开画布完成全流程。

**核心交互：**
```
C键/Ctrl+C → 进入批注模式 → 点击图片打Pin → 输入修改意见 → 提交 → AI执行 → 结果替换原图 → Pin显示AI回复 → 可继续追问
```

**与现有功能的关系：**
| 现有功能 | 场景 | ChatCanvas 场景 |
|---------|------|----------------|
| 语言修图 | 精细控制（选模型/画蒙版/调参数） | 快速修改，不离开画布 |
| 聊天面板 | 长对话/多轮分析/知识问答 | 画布内短对话，聚焦当前图片 |
| Agent编排 | 多工具复杂任务 | 单图快速批注修改 |

---

## 二、数据结构

### 2.1 CanvasAnnotation（画布批注）

```typescript
// 新增类型定义 → src/lib/canvas-annotation.ts

export interface CanvasAnnotation {
  id: string;                           // ann-{timestamp}-{random}
  x: number;                            // 画布坐标X
  y: number;                            // 画布坐标Y
  text: string;                         // 用户修改意见
  targetImageId: string;                // 关联的图片ID
  region?: {                            // 可选：框选区域（Phase 4）
    x: number;                          // 相对图片左上角的偏移X
    y: number;                          // 相对图片左上角的偏移Y
    w: number;                          // 区域宽度
    h: number;                          // 区域高度
  };
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  aiReply?: string;                     // AI回复摘要
  resultImageId?: string;               // 修改后的图片ID
  error?: string;                       // 错误信息
  createdAt: number;                    // 创建时间戳
  completedAt?: number;                 // 完成时间戳
  // 对话气泡（Phase 3）
  conversation?: AnnotationMessage[];   // 批注对话历史
  isBubbleExpanded?: boolean;           // 气泡是否展开
}

export interface AnnotationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export type AnnotationMode = 'none' | 'pin' | 'region';  // 批注模式状态
```

### 2.2 状态管理

```typescript
// 在 infinite-canvas.tsx 中新增状态
const [annotations, setAnnotations] = useState<CanvasAnnotation[]>([]);
const [annotationMode, setAnnotationMode] = useState<AnnotationMode>('none');
const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
const [showAnnotationPanel, setShowAnnotationPanel] = useState(false);  // 底部批注面板
const [annotationRegionStart, setAnnotationRegionStart] = useState<{x:number,y:number}|null>(null);  // 框选起点
```

---

## 三、Phase 详细设计

---

### Phase 1：画布批注 + 单条执行（2周）

#### 1.1 新建文件

**`src/lib/canvas-annotation.ts`** — 批注数据类型 + 工具函数

```typescript
// 核心函数：
export function createAnnotation(x: number, y: number, text: string, targetImageId: string): CanvasAnnotation
export function findTargetImage(x: number, y: number, images: CanvasImage[]): CanvasImage | null
export function screenToCanvas(screenX: number, screenY: number, offset: {x:number,y:number}, zoom: number): {x: number, y: number}
export function canvasToScreen(canvasX: number, canvasY: number, offset: {x:number,y:number}, zoom: number): {x: number, y: number}
export function isPointInImage(cx: number, cy: number, img: CanvasImage): boolean
```

**空间碰撞检测逻辑（findTargetImage）：**
```
1. 将鼠标点击的屏幕坐标 → 转换为画布坐标
   canvasX = (screenX - viewportWidth/2) / zoom + offsetX
   canvasY = (screenY - viewportHeight/2) / zoom + offsetY

2. 遍历 images（从上层到下层，即数组倒序）
   如果 canvasX ∈ [img.x, img.x + img.width] 且 canvasY ∈ [img.y, img.y + img.height]
   → 命中该图片

3. 未命中 → 提示"请点击图片进行批注"
```

#### 1.2 infinite-canvas.tsx 改动

**A. 底部工具栏新增"批注"按钮**

位置：在"Agent编排"按钮之后，"品牌电商"按钮之前

```tsx
{/* ChatCanvas 批注模式 */}
<button
  onClick={() => setAnnotationMode(annotationMode === 'none' ? 'pin' : 'none')}
  className={`${toolBtnCls} ${annotationMode !== 'none' ? toolBtnActiveCls : ''}`}
  title="画布批注 (C)"
>
  <MessageCircle className={`h-4 w-4 ${mIcon.messageCircle}`} />
  <span className="...tooltip...">批注 (C)</span>
</button>
```

**B. 快捷键 C 切换批注模式**

在 `useEffect` 键盘监听中新增：
```typescript
if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !isEditing && editMode === 'none') {
  setAnnotationMode(prev => prev === 'none' ? 'pin' : 'none');
}
```

**C. 批注模式下的点击处理**

在 `handleCanvasMouseDown` 中新增批注分支：
```typescript
if (annotationMode === 'pin') {
  // 1. 屏幕坐标 → 画布坐标
  const cx = (e.clientX - viewportWidth/2) / zoom + offsetX;
  const cy = (e.clientY - viewportHeight/2) / zoom + offsetY;
  
  // 2. 碰撞检测找目标图片
  const targetImage = findTargetImage(cx, cy, imagesRef.current);
  if (!targetImage) {
    // 闪烁提示"请点击图片"
    return;
  }
  
  // 3. 创建批注Pin（pending状态）
  const annotation = createAnnotation(cx, cy, '', targetImage.id);
  setAnnotations(prev => [...prev, annotation]);
  setActiveAnnotationId(annotation.id);
  // 不执行，等用户输入文字
}
```

**D. 批注输入框**

在批注Pin位置渲染输入框：
```tsx
{annotationMode !== 'none' && annotations.filter(a => a.status === 'pending' && !a.text).map(ann => (
  <div
    key={ann.id}
    style={{
      position: 'absolute',
      left: canvasToScreen(ann.x, ann.y, viewOffset, zoom).x,
      top: canvasToScreen(ann.x, ann.y, viewOffset, zoom).y - 40,
      transform: 'translate(-50%, -100%)',
      zIndex: 60,
    }}
  >
    <input
      autoFocus
      placeholder="输入修改意见..."
      className="w-64 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-gold/40 text-sm text-white placeholder:text-gray-500 focus:ring-2 focus:ring-gold/50 focus:outline-none"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
          handleAnnotationSubmit(ann.id, e.currentTarget.value.trim());
        }
        if (e.key === 'Escape') {
          // 取消此批注
          setAnnotations(prev => prev.filter(a => a.id !== ann.id));
        }
      }}
    />
  </div>
))}
```

**E. 批注Pin渲染**

在图片层上方渲染SVG叠加层：
```tsx
{/* 批注Pin层 */}
<svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 45 }}>
  {annotations.map(ann => {
    const screenPos = canvasToScreen(ann.x, ann.y, viewOffset, zoom);
    const statusColor = {
      pending: '#d4af37',    // 金色
      running: '#3b82f6',    // 蓝色
      done: '#22c55e',       // 绿色
      failed: '#ef4444',     // 红色
      cancelled: '#6b7280',  // 灰色
    }[ann.status];
    
    return (
      <g key={ann.id} className="pointer-events-auto cursor-pointer" onClick={() => handleAnnotationClick(ann.id)}>
        {/* Pin圆点 */}
        <circle cx={screenPos.x} cy={screenPos.y} r={8} fill={statusColor} stroke="white" strokeWidth={2} />
        {/* 编号 */}
        <text x={screenPos.x} y={screenPos.y + 4} textAnchor="middle" fill="white" fontSize={10} fontWeight="bold">
          {annotations.indexOf(ann) + 1}
        </text>
        {/* AI回复摘要（折叠态） */}
        {ann.aiReply && !ann.isBubbleExpanded && (
          <g>
            <rect x={screenPos.x + 12} y={screenPos.y - 12} width={Math.min(ann.aiReply.length * 7, 200)} height={24} rx={6} fill="rgba(0,0,0,0.8)" />
            <text x={screenPos.x + 16} y={screenPos.y + 4} fill="white" fontSize={11}>
              {ann.aiReply.slice(0, 20)}...
            </text>
          </g>
        )}
      </g>
    );
  })}
</svg>
```

**F. 批注提交 → 调用 /api/edit**

```typescript
const handleAnnotationSubmit = async (annotationId: string, text: string) => {
  const ann = annotations.find(a => a.id === annotationId);
  if (!ann) return;
  
  const targetImage = imagesRef.current.find(img => img.id === ann.targetImageId);
  if (!targetImage) return;
  
  // 更新批注状态
  setAnnotations(prev => prev.map(a => 
    a.id === annotationId ? { ...a, text, status: 'running' as const } : a
  ));
  
  try {
    // 调用语言修图API
    const res = await fetch('/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: targetImage.url,
        prompt: text,
        model: getCurrentModel(),
        providerId: getCurrentProviderId(),
        quality: 'high',
        count: 1,
      }),
    });
    
    const data = await res.json();
    
    if (data.success && data.imageUrl) {
      // 替换原图
      onImagesChange(imagesRef.current.map(img => 
        img.id === targetImage.id ? { ...img, url: data.imageUrl } : img
      ));
      
      // 更新批注为完成
      setAnnotations(prev => prev.map(a => 
        a.id === annotationId ? { ...a, status: 'done', aiReply: '修改完成', resultImageId: targetImage.id } : a
      ));
    } else {
      setAnnotations(prev => prev.map(a => 
        a.id === annotationId ? { ...a, status: 'failed', error: data.error || '修改失败' } : a
      ));
    }
  } catch (err) {
    setAnnotations(prev => prev.map(a => 
      a.id === annotationId ? { ...a, status: 'failed', error: '网络错误' } : a
    ));
  }
};
```

**G. 批注模式顶部提示**

```tsx
{annotationMode !== 'none' && (
  <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#1a1a1a]/95 border border-gold/30 text-sm text-gold backdrop-blur-sm">
    批注模式 — 点击图片添加修改意见 · ESC 退出
  </div>
)}
```

#### 1.3 需要导入的新图标

```typescript
// lucide-react 新增导入
import { MessageCircle, MessageSquare } from 'lucide-react';
```

#### 1.4 Phase 1 交付标准

- [ ] C键 或 底部工具栏按钮 切换批注模式
- [ ] 批注模式下点击图片出现Pin + 输入框
- [ ] 输入修改意见回车后调用 /api/edit 执行
- [ ] 执行中Pin显示蓝色加载动画
- [ ] 完成后Pin变绿色，原图被替换
- [ ] 失败Pin变红色，hover显示错误
- [ ] ESC退出批注模式
- [ ] 批注跟随画布缩放/平移
- [ ] 点击空白区域提示"请点击图片"

---

### Phase 2：批量批注 + 执行队列（1周）

#### 2.1 批量执行逻辑

**核心策略：同一图片的多条批注合并执行，不同图片可并行**

```typescript
const executeAllAnnotations = async () => {
  const pendingAnnotations = annotations.filter(a => a.status === 'pending' && a.text);
  if (pendingAnnotations.length === 0) return;
  
  // 按 targetImageId 分组
  const grouped = new Map<string, CanvasAnnotation[]>();
  for (const ann of pendingAnnotations) {
    const list = grouped.get(ann.targetImageId) || [];
    list.push(ann);
    grouped.set(ann.targetImageId, list);
  }
  
  // 逐组执行（同组批注合并为一次API调用）
  for (const [imageId, groupAnns] of grouped) {
    const targetImage = imagesRef.current.find(img => img.id === imageId);
    if (!targetImage) continue;
    
    // 合并所有批注意见为一条prompt
    const combinedPrompt = groupAnns.map((ann, i) => `${i + 1}. ${ann.text}`).join('\n');
    
    // 标记所有相关批注为 running
    setAnnotations(prev => prev.map(a => 
      groupAnns.some(ga => ga.id === a.id) ? { ...a, status: 'running' as const } : a
    ));
    
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: targetImage.url,
          prompt: `请按顺序执行以下修改：\n${combinedPrompt}`,
          model: getCurrentModel(),
          providerId: getCurrentProviderId(),
          quality: 'high',
          count: 1,
        }),
      });
      
      const data = await res.json();
      
      if (data.success && data.imageUrl) {
        onImagesChange(imagesRef.current.map(img => 
          img.id === imageId ? { ...img, url: data.imageUrl } : img
        ));
        setAnnotations(prev => prev.map(a => 
          groupAnns.some(ga => ga.id === a.id) ? { ...a, status: 'done', aiReply: '修改完成' } : a
        ));
      } else {
        setAnnotations(prev => prev.map(a => 
          groupAnns.some(ga => ga.id === a.id) ? { ...a, status: 'failed', error: data.error || '修改失败' } : a
        ));
      }
    } catch (err) {
      setAnnotations(prev => prev.map(a => 
        groupAnns.some(ga => ga.id === a.id) ? { ...a, status: 'failed', error: '网络错误' } : a
      ));
    }
  }
};
```

#### 2.2 底部批注面板

在底部工具栏上方，当有pending批注时浮出：

```tsx
{annotations.some(a => a.status === 'pending' && a.text) && (
  <div className={`absolute bottom-16 left-1/2 -translate-x-1/2 z-50 rounded-xl px-4 py-3 min-w-[320px] max-w-[600px] ${isMonochrome ? 'bg-white border border-gray-200 shadow-lg' : 'bg-[#1a1a1a] border border-white/[0.12] shadow-2xl'}`}>
    {/* 批注列表 */}
    <div className="space-y-1.5 max-h-40 overflow-y-auto mb-3">
      {annotations.filter(a => a.text).map((ann, i) => (
        <div key={ann.id} className="flex items-center gap-2 text-sm">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${statusBadgeClass[ann.status]}`}>
            {i + 1}
          </span>
          <span className="truncate flex-1">{ann.text}</span>
          {ann.status === 'pending' && (
            <button onClick={() => removeAnnotation(ann.id)} className="text-gray-500 hover:text-red-400">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
    {/* 执行按钮 */}
    <button
      onClick={executeAllAnnotations}
      className="w-full py-2 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-black font-semibold text-sm"
    >
      全部执行 ({annotations.filter(a => a.status === 'pending' && a.text).length})
    </button>
  </div>
)}
```

#### 2.3 Phase 2 交付标准

- [ ] 可连续打多个批注Pin
- [ ] 底部浮出批注面板，列出所有批注及状态
- [ ] 同一图片的多条批注合并为一次API调用
- [ ] 不同图片的批注可依次执行
- [ ] 单条批注可删除/跳过
- [ ] "全部执行"按钮 + 进度展示
- [ ] 执行完成后Pin变色，面板更新状态

---

### Phase 3：画布内对话气泡（1.5周）

#### 3.1 气泡数据结构

在 CanvasAnnotation 中新增：
```typescript
conversation?: AnnotationMessage[];
isBubbleExpanded?: boolean;
```

#### 3.2 气泡渲染

```tsx
{annotations.filter(a => a.isBubbleExpanded).map(ann => {
  const screenPos = canvasToScreen(ann.x, ann.y, viewOffset, zoom);
  return (
    <div
      key={`bubble-${ann.id}`}
      className="absolute z-[55] w-72"
      style={{
        left: screenPos.x + 16,
        top: screenPos.y - 100,
      }}
    >
      {/* 气泡头部 */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1a1a1a] border border-gold/30 rounded-t-lg">
        <span className="text-xs text-gold font-semibold">AI 对话</span>
        <button onClick={() => toggleBubble(ann.id)} className="text-gray-500 hover:text-white">
          <Minimize2 className="h-3 w-3" />
        </button>
      </div>
      {/* 对话历史 */}
      <div className="bg-[#0d0d0d] border-x border-gold/30 max-h-48 overflow-y-auto p-3 space-y-2">
        {ann.conversation?.map((msg, i) => (
          <div key={i} className={`text-xs ${msg.role === 'user' ? 'text-right text-gray-300' : 'text-left text-gold/80'}`}>
            <span className={`inline-block px-2 py-1 rounded-lg ${msg.role === 'user' ? 'bg-white/10' : 'bg-gold/10'}`}>
              {msg.content}
            </span>
          </div>
        ))}
      </div>
      {/* 追问输入框 */}
      <div className="bg-[#1a1a1a] border border-gold/30 rounded-b-lg p-2">
        <input
          placeholder="继续追问..."
          className="w-full bg-transparent text-xs text-white placeholder:text-gray-600 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              handleAnnotationFollowUp(ann.id, e.currentTarget.value.trim());
              e.currentTarget.value = '';
            }
          }}
        />
      </div>
    </div>
  );
})}
```

#### 3.3 追问逻辑

```typescript
const handleAnnotationFollowUp = async (annotationId: string, followUpText: string) => {
  const ann = annotations.find(a => a.id === annotationId);
  if (!ann) return;
  
  const targetImage = imagesRef.current.find(img => img.id === ann.targetImageId);
  if (!targetImage) return;
  
  // 追加用户消息到对话历史
  const userMsg: AnnotationMessage = { role: 'user', content: followUpText, timestamp: Date.now() };
  setAnnotations(prev => prev.map(a => 
    a.id === annotationId ? { 
      ...a, 
      conversation: [...(a.conversation || []), userMsg],
      status: 'running'
    } : a
  ));
  
  try {
    // 构建上下文：原始批注 + 追问 + 当前图片
    const contextPrompt = `原始修改请求：${ann.text}\n\n用户追问：${followUpText}`;
    
    const res = await fetch('/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: targetImage.url,
        prompt: contextPrompt,
        model: getCurrentModel(),
        providerId: getCurrentProviderId(),
        quality: 'high',
        count: 1,
      }),
    });
    
    const data = await res.json();
    
    const aiMsg: AnnotationMessage = { 
      role: 'assistant', 
      content: data.success ? '已修改完成' : (data.error || '修改失败'),
      timestamp: Date.now() 
    };
    
    if (data.success && data.imageUrl) {
      onImagesChange(imagesRef.current.map(img => 
        img.id === targetImage.id ? { ...img, url: data.imageUrl } : img
      ));
    }
    
    setAnnotations(prev => prev.map(a => 
      a.id === annotationId ? { 
        ...a, 
        conversation: [...(a.conversation || []), userMsg, aiMsg],
        status: data.success ? 'done' : 'failed',
        aiReply: aiMsg.content,
      } : a
    ));
  } catch (err) {
    const aiMsg: AnnotationMessage = { role: 'assistant', content: '网络错误', timestamp: Date.now() };
    setAnnotations(prev => prev.map(a => 
      a.id === annotationId ? { 
        ...a, 
        conversation: [...(a.conversation || []), userMsg, aiMsg],
        status: 'failed',
      } : a
    ));
  }
};
```

#### 3.4 点击Pin展开/折叠气泡

```typescript
const handleAnnotationClick = (annotationId: string) => {
  const ann = annotations.find(a => a.id === annotationId);
  if (!ann) return;
  
  // 只有 done/failed 状态的批注才可展开对话
  if (ann.status === 'done' || ann.status === 'failed') {
    setAnnotations(prev => prev.map(a => 
      a.id === annotationId ? { ...a, isBubbleExpanded: !a.isBubbleExpanded } : a
    ));
  }
};
```

#### 3.5 Phase 3 交付标准

- [ ] 点击已完成Pin展开对话气泡
- [ ] 气泡内显示对话历史
- [ ] 气泡底部输入框可继续追问
- [ ] 追问调用 /api/edit 执行修改
- [ ] 修改结果替换原图
- [ ] 气泡可折叠/展开
- [ ] 点击其他区域自动折叠
- [ ] 气泡跟随画布缩放/平移

---

### Phase 4：框选区域批注（1周）

#### 4.1 框选交互

```typescript
// annotationMode 扩展为 'none' | 'pin' | 'region'

// 在批注模式下，长按拖拽 → 画矩形选区
const handleAnnotationMouseDown = (e: React.MouseEvent) => {
  if (annotationMode !== 'pin') return;
  
  const cx = screenToCanvasX(e.clientX);
  const cy = screenToCanvasY(e.clientY);
  const targetImage = findTargetImage(cx, cy, imagesRef.current);
  if (!targetImage) return;
  
  // 记录拖拽起点
  setAnnotationRegionStart({ x: cx, y: cy });
  setAnnotationDragTarget(targetImage);
};

const handleAnnotationMouseMove = (e: React.MouseEvent) => {
  if (!annotationRegionStart || !annotationDragTarget) return;
  
  const cx = screenToCanvasX(e.clientX);
  const cy = screenToCanvasY(e.clientY);
  
  // 更新选区矩形（实时预览）
  setAnnotationRegionCurrent({
    x: Math.min(annotationRegionStart.x, cx),
    y: Math.min(annotationRegionStart.y, cy),
    w: Math.abs(cx - annotationRegionStart.x),
    h: Math.abs(cy - annotationRegionStart.y),
  });
};

const handleAnnotationMouseUp = (e: React.MouseEvent) => {
  if (!annotationRegionStart || !annotationDragTarget) return;
  
  const region = annotationRegionCurrent;
  if (!region || region.w < 10 || region.h < 10) {
    // 太小视为点击 → 创建Pin批注
    createPinAnnotation(annotationRegionStart.x, annotationRegionStart.y, annotationDragTarget.id);
  } else {
    // 创建区域批注
    createRegionAnnotation(region, annotationDragTarget);
  }
  
  setAnnotationRegionStart(null);
  setAnnotationRegionCurrent(null);
  setAnnotationDragTarget(null);
};
```

#### 4.2 选区预览渲染

```tsx
{/* 批注选区预览 */}
{annotationRegionCurrent && (
  <div
    className="absolute border-2 border-gold/60 bg-gold/10 pointer-events-none rounded"
    style={{
      left: canvasToScreenX(annotationRegionCurrent.x),
      top: canvasToScreenY(annotationRegionCurrent.y),
      width: annotationRegionCurrent.w * zoom,
      height: annotationRegionCurrent.h * zoom,
      zIndex: 46,
    }}
  />
)}
```

#### 4.3 区域批注 → 蒙版修图

```typescript
const executeRegionAnnotation = async (annotation: CanvasAnnotation) => {
  const targetImage = imagesRef.current.find(img => img.id === annotation.targetImageId);
  if (!targetImage || !annotation.region) return;
  
  // 构建蒙版：region 区域为白色（修改区），其余为黑色（保留区）
  const mask = await generateRegionMask(
    targetImage.originalWidth || targetImage.width,
    targetImage.originalHeight || targetImage.height,
    annotation.region
  );
  
  // 调用 /api/edit，带蒙版
  const res = await fetch('/api/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: targetImage.url,
      prompt: annotation.text,
      mask: mask,                  // base64 蒙版
      model: getCurrentModel(),
      providerId: getCurrentProviderId(),
      quality: 'high',
      count: 1,
    }),
  });
  // ... 同Phase 1的处理逻辑
};

/** 生成区域蒙版（Canvas API） */
const generateRegionMask = async (
  imgW: number, imgH: number, 
  region: { x: number; y: number; w: number; h: number }
): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext('2d')!;
  
  // 黑色背景（保留区）
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, imgW, imgH);
  
  // 白色区域（修改区）— 需要将画布坐标转换为图片坐标
  const scaleX = imgW / (targetImage.width);
  const scaleY = imgH / (targetImage.height);
  const rx = (region.x - targetImage.x) * scaleX;
  const ry = (region.y - targetImage.y) * scaleY;
  const rw = region.w * scaleX;
  const rh = region.h * scaleY;
  
  ctx.fillStyle = 'white';
  ctx.fillRect(rx, ry, rw, rh);
  
  return canvas.toDataURL('image/png');
};
```

#### 4.4 Phase 4 交付标准

- [ ] 批注模式下拖拽画出矩形选区
- [ ] 选区实时预览（金色虚线框）
- [ ] 拖拽太小（<10px）自动降级为Pin批注
- [ ] 选区关联目标图片
- [ ] 区域批注提交时生成蒙版
- [ ] 带蒙版调用 /api/edit 精确修改
- [ ] 修改结果仅替换选区内容

---

### Phase 5：持久化 + 细节打磨（0.5周）

#### 5.1 批注持久化

```typescript
// 批注数据随项目保存
// 在 onGroupsChange 或 beforeunload 时，将 annotations 序列化到 localStorage
const saveAnnotations = () => {
  if (!currentProject) return;
  const key = `wujie_annotations_${currentProject.id}`;
  localStorage.setItem(key, JSON.stringify(annotations));
};

const loadAnnotations = () => {
  if (!currentProject) return;
  const key = `wujie_annotations_${currentProject.id}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      setAnnotations(JSON.parse(saved));
    } catch {}
  }
};
```

#### 5.2 细节打磨

| 项目 | 说明 |
|------|------|
| Pin加载动画 | running状态Pin显示脉冲动画（CSS animation: pulse） |
| 批注编号 | 按创建顺序显示1/2/3...编号 |
| 批注删除 | 右键Pin → "删除批注"，或面板中点× |
| 批注清空 | 面板底部"清除已完成"按钮 |
| 空状态引导 | 首次进入批注模式显示3秒引导气泡 |
| 主题适配 | 批注UI同时支持黑金主题和单色主题 |
| 响应式 | 气泡宽度不超过屏幕40%，自动调整位置避免超出视口 |

---

## 四、文件改动清单

| 文件 | 改动类型 | Phase | 说明 |
|------|---------|-------|------|
| `src/lib/canvas-annotation.ts` | **新建** | 1 | 批注数据类型 + 工具函数 |
| `src/components/infinite-canvas.tsx` | **修改** | 1-5 | 批注模式、Pin渲染、气泡、框选、面板 |
| `src/app/api/edit/route.ts` | 微调 | 4 | 确认 mask 参数已支持（已支持，无需改动） |
| 无新API路由 | - | - | 全部复用现有 /api/edit + /api/chat |

---

## 五、风险与注意事项

| 风险 | 影响 | 应对 |
|------|------|------|
| /api/edit 响应慢（5-30秒） | 批注长时间显示running | 添加超时提示 + 取消按钮 |
| 多条批注同图合并后prompt过长 | AI理解偏差 | 最多合并5条，超出拆分多次调用 |
| 气泡渲染影响画布性能 | 缩放/平移卡顿 | 气泡使用React Portal渲染，不参与Canvas重绘 |
| 框选蒙版精度不足 | 修改溢出选区 | 蒙版边缘8px羽化过渡 |
| 批注坐标在图片移动后失效 | Pin指向空白 | 图片移动时同步更新关联批注坐标 |

---

## 六、里程碑与交付

| 里程碑 | 内容 | 工期 |
|--------|------|------|
| **M1** | Phase 1 — 画布批注 + 单条执行 | 2周 |
| **M2** | Phase 2 — 批量批注 + 执行队列 | 1周 |
| **M3** | Phase 3 — 画布内对话气泡 | 1.5周 |
| **M4** | Phase 4 — 框选区域批注 | 1周 |
| **M5** | Phase 5 — 持久化 + 打磨 | 0.5周 |
| **总计** | | **6周** |

每个里程碑完成后独立可用，M1即可交付用户使用。
