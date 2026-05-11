/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const patchRoot = path.join(__dirname, 'patch-files');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function patchPage() {
  const file = path.join(root, 'src/app/page.tsx');
  if (!fs.existsSync(file)) {
    console.warn('未找到 src/app/page.tsx，请手动集成 LayerGraphStudio。');
    return;
  }
  let code = fs.readFileSync(file, 'utf8');

  if (!code.includes("@/components/design-studio/LayerGraphStudio")) {
    code = code.replace(
      "import { ChatPanel } from '@/components/chat-panel';",
      "import { ChatPanel } from '@/components/chat-panel';\nimport { LayerGraphStudio } from '@/components/design-studio/LayerGraphStudio';"
    );
  }

  if (!code.includes('showLayerGraphStudio')) {
    code = code.replace(
      "const [ctrlRefSelections, setCtrlRefSelections] = useState<CtrlRefSelection[]>([]);",
      "const [ctrlRefSelections, setCtrlRefSelections] = useState<CtrlRefSelection[]>([]);\n  const [showLayerGraphStudio, setShowLayerGraphStudio] = useState(false);"
    );
  }

  if (!code.includes('<LayerGraphStudio')) {
    const insertion = `
      {/* Lovart Layer Graph Studio */}
      <button
        onClick={() => setShowLayerGraphStudio(true)}
        className="fixed right-5 bottom-5 z-50 rounded-full border border-[#d4af37]/50 bg-[#111]/95 px-4 py-3 text-xs font-semibold text-[#d4af37] shadow-2xl hover:bg-[#d4af37] hover:text-black transition"
        title="打开 Lovart Layer Graph 设计工程"
      >
        Layer Graph
      </button>
      <LayerGraphStudio
        open={showLayerGraphStudio}
        images={images}
        onClose={() => setShowLayerGraphStudio(false)}
      />
`;
    code = code.replace('      {/* Preview */}', insertion + '\n      {/* Preview */}');
  }

  fs.writeFileSync(file, code, 'utf8');
}

copyDir(patchRoot, root);
patchPage();
console.log('✅ Wujie Lovart Layer Graph 补丁已应用。');
console.log('下一步：pnpm install && pnpm ts-check && pnpm build');
