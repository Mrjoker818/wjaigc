import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);
const modelSelectorSource = source.slice(
  source.indexOf('{/* Model Selector */}'),
  source.indexOf('{/* Project tools */}'),
);

describe('simple-chat model selector contract', () => {
  it('uses click-controlled menus instead of hover-only selection', () => {
    expect(source).toContain("const [openModelMenu, setOpenModelMenu] = useState<'chat' | 'image' | null>(null);");
    expect(modelSelectorSource).toContain("onClick={() => setOpenModelMenu(openModelMenu === 'chat' ? null : 'chat')}");
    expect(modelSelectorSource).toContain("onClick={() => setOpenModelMenu(openModelMenu === 'image' ? null : 'image')}");
    expect(modelSelectorSource).not.toContain('group-hover:opacity-100');
  });

  it('uses the current task as the only chat model selection source', () => {
    expect(source).toContain('const chatModelSelection = readSimpleChatModelSelection(task);');
    expect(source).toContain('onUpdateTask(applySimpleChatModelSelection(task, selection));');
    expect(source).not.toContain('const [selectedModel, setSelectedModel]');
    expect(source).not.toContain('const [selectedProviderId, setSelectedProviderId]');
  });

  it('keeps both model menus above the scrolling conversation', () => {
    expect(source).toContain('<header className="relative z-50');
    expect(source.match(/role="listbox"/g)).toHaveLength(2);
    expect(modelSelectorSource.match(/w-\[min\(20rem,calc\(100vw-1\.5rem\)\)\]/g)).toHaveLength(2);
  });

  it('applies the image model and provider before closing the selected menu', () => {
    expect(source).toContain('setSelectedImageModel(m.modelId); setSelectedImageProviderId(m.providerId); setOpenModelMenu(null);');
  });
});
