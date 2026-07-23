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

  it('applies both model and provider before closing the selected menu', () => {
    expect(source).toContain('setSelectedModel(m.modelId); setSelectedProviderId(m.providerId); setOpenModelMenu(null);');
    expect(source).toContain('setSelectedImageModel(m.modelId); setSelectedImageProviderId(m.providerId); setOpenModelMenu(null);');
  });
});
