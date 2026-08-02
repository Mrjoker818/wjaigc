import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/node-editor.tsx'),
  'utf8',
);

describe('node editor history baseline', () => {
  it('seeds the initial workflow as history entry zero so the first node addition can be undone', () => {
    expect(source).toContain("const [historyStack, setHistoryStack] = useState<HistoryEntry[]>(() => [{");
    expect(source).toContain("label: '初始状态'");
    expect(source).toContain('const [historyIndex, setHistoryIndex] = useState(0);');
    expect(source).toContain('const historyIndexRef = useRef(0);');
  });
});
