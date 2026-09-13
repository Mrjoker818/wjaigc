export type PostgresUtcDayReference = 'CURRENT_TIMESTAMP' | '$2::timestamptz';

export interface PostgresUtcDayWindow {
  startSql: string;
  endSql: string;
}

export function postgresUtcDayWindow(
  reference: PostgresUtcDayReference,
): PostgresUtcDayWindow {
  const utcLocalTimestamp = `${reference} AT TIME ZONE 'UTC'`;
  return {
    startSql: `(date_trunc('day', ${utcLocalTimestamp}) AT TIME ZONE 'UTC')`,
    endSql: `((date_trunc('day', ${utcLocalTimestamp}) + interval '1 day') AT TIME ZONE 'UTC')`,
  };
}
