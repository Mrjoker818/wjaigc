export function parseStrictCliOptions<const Names extends readonly string[]>(
  argv: readonly string[],
  requiredNames: Names,
): Record<Names[number], string> {
  const allowed = new Set<string>(requiredNames);
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--')) throw new Error(`Unexpected positional argument: ${option ?? '<missing>'}`);
    if (!allowed.has(option)) throw new Error(`Unknown option: ${option}`);
    if (parsed.has(option)) throw new Error(`Duplicate option: ${option}`);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for option: ${option}`);
    parsed.set(option, value);
  }
  for (const name of requiredNames) {
    if (!parsed.has(name)) throw new Error(`Missing required option: ${name}`);
  }
  return Object.fromEntries(parsed) as Record<Names[number], string>;
}
