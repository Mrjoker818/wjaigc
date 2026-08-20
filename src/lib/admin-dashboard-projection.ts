interface RawDashboardMetrics {
  modelRank?: unknown;
  providerStatus?: unknown;
}

export interface DashboardModelMetric {
  name: string;
  calls: number;
  successRate: number | null;
}

export interface DashboardProviderMetric {
  name: string;
  calls24h: number;
  failRate: number | null;
  status: string;
}

export interface DashboardMetricsProjection {
  modelRank: DashboardModelMetric[];
  providerStatus: DashboardProviderMetric[];
  metricsCoverage: {
    modelCalls: 'available' | 'unavailable';
    providerCalls: 'available' | 'unavailable';
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 ? name : null;
}

export function projectDashboardMetrics(stats: RawDashboardMetrics): DashboardMetricsProjection {
  const rawModels = Array.isArray(stats.modelRank) ? stats.modelRank : [];
  const modelRank = rawModels.flatMap((value): DashboardModelMetric[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const name = metricName(row.name);
    const calls = finiteNumber(row.calls);
    if (!name || calls === null || calls <= 0) return [];
    return [{
      name,
      calls,
      successRate: finiteNumber(row.successRate),
    }];
  }).slice(0, 10);

  const rawProviders = Array.isArray(stats.providerStatus) ? stats.providerStatus : [];
  const providerStatus = rawProviders.flatMap((value): DashboardProviderMetric[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const name = metricName(row.name);
    const calls24h = finiteNumber(row.calls24h);
    if (!name || calls24h === null || calls24h <= 0) return [];
    return [{
      name,
      calls24h,
      failRate: finiteNumber(row.failRate),
      status: metricName(row.status) || '未知',
    }];
  });

  return {
    modelRank,
    providerStatus,
    metricsCoverage: {
      modelCalls: modelRank.length > 0 ? 'available' : 'unavailable',
      providerCalls: providerStatus.length > 0 ? 'available' : 'unavailable',
    },
  };
}
