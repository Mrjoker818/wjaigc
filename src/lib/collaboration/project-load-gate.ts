export interface LatestProjectLoadGate {
  resolve<T>(load: () => Promise<T>): Promise<{ value: T; isCurrent: () => boolean }>;
}

export function createLatestProjectLoadGate(): LatestProjectLoadGate {
  let latest = 0;
  return {
    async resolve<T>(load: () => Promise<T>): Promise<{ value: T; isCurrent: () => boolean }> {
      const request = ++latest;
      return { value: await load(), isCurrent: () => request === latest };
    },
  };
}
