import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loginPanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/login-panel.tsx'),
  'utf8'
);
const homePageSource = readFileSync(
  resolve(process.cwd(), 'src/app/page.tsx'),
  'utf8'
);

describe('login panel native form contract', () => {
  it('keeps both product entries as same-page mode buttons', () => {
    expect(loginPanelSource).not.toContain('isHydrated');
    expect(loginPanelSource).not.toContain('disabled={!isHydrated}');
    expect(loginPanelSource).not.toContain('entry=canvas');
    expect(loginPanelSource).not.toContain('entry=chat');
    expect(loginPanelSource).not.toContain("entry === 'canvas' || entry === 'chat'");
    expect(loginPanelSource).toMatch(/<button[\s\S]*?type="button"[\s\S]*?onClick=\{\(\) => selectMode\('canvas'\)\}/);
    expect(loginPanelSource).toMatch(/<button[\s\S]*?type="button"[\s\S]*?onClick=\{\(\) => selectMode\('chat'\)\}/);
  });

  it('submits the selected product and routes chat only after login succeeds', () => {
    expect(loginPanelSource).toContain('body: JSON.stringify({ name, password, productType })');
    expect(loginPanelSource).toContain('onLogin(loggedIn, productType);');
    expect(loginPanelSource).toContain("submitLogin(loginName.trim(), loginPassword, selectedMode)");
    expect(homePageSource).toContain("if (productType === 'chat')");
    expect(homePageSource).toContain("window.location.href = '/simple-chat';");
    expect(homePageSource).toContain('setCurrentUser(user);');
    expect(homePageSource).toContain(
      'return <CanvasWorkspace initialUser={currentUser} />;'
    );
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
