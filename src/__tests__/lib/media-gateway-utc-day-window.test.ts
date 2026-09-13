import { describe, expect, it } from 'vitest';

import { postgresUtcDayWindow } from '@/lib/media-gateway/utc-day-window';

describe('PostgreSQL UTC day window', () => {
  it.each(['CURRENT_TIMESTAMP', '$2::timestamptz'] as const)(
    'builds an explicit UTC half-open day around %s',
    (reference) => {
      const window = postgresUtcDayWindow(reference);

      expect(window.startSql).toBe(
        `(date_trunc('day', ${reference} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
      );
      expect(window.endSql).toBe(
        `((date_trunc('day', ${reference} AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC')`,
      );
    },
  );
});
