type TestCredential = 'E2E_TEST_USERNAME' | 'E2E_TEST_PASSWORD';

export function requireTestCredential(name: TestCredential): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} must be set for the test account`);
  return value;
}
