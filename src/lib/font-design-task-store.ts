export interface FontDesignTaskResult {
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
  updatedAt: number;
}

const fontDesignResults = new Map<string, FontDesignTaskResult>();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of fontDesignResults) {
    if (now - value.updatedAt > 10 * 60 * 1000) {
      fontDesignResults.delete(key);
    }
  }
}, 60 * 1000);

cleanupTimer.unref?.();

export function getFontDesignResult(taskId: string): FontDesignTaskResult | null {
  return fontDesignResults.get(taskId) ?? null;
}

export function setFontDesignResult(taskId: string, result: FontDesignTaskResult): void {
  fontDesignResults.set(taskId, result);
}
