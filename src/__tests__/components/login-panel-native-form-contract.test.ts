import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loginPanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/login-panel.tsx'),
  'utf8'
);

describe('login panel native form contract', () => {
  it('keeps both product entries usable before and after hydration', () => {
    expect(loginPanelSource).not.toContain('isHydrated');
    expect(loginPanelSource).not.toContain('disabled={!isHydrated}');
    expect(loginPanelSource).toContain('href="/?entry=canvas"');
    expect(loginPanelSource).toContain('href="/?entry=chat"');
    expect(loginPanelSource.match(/event\.preventDefault\(\);/g)).toHaveLength(2);
    expect(loginPanelSource).toContain("entry === 'canvas' || entry === 'chat'");
  });

  it('toggles password visibility without submitting the login form', () => {
    expect(loginPanelSource).toContain('const [showLoginPassword, setShowLoginPassword] = useState(false);');
    expect(loginPanelSource).toContain("type={showLoginPassword ? 'text' : 'password'}");
    expect(loginPanelSource).toContain("aria-label={showLoginPassword ? '隐藏密码' : '显示密码'}");
    expect(loginPanelSource).toContain('aria-pressed={showLoginPassword}');
    expect(loginPanelSource).toContain("setShowLoginPassword((value) => !value)");
    expect(loginPanelSource).toMatch(/type="button"[\s\S]*?aria-label=\{showLoginPassword \? '隐藏密码' : '显示密码'\}/);
    expect(loginPanelSource).toContain('{showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}');
  });
});
