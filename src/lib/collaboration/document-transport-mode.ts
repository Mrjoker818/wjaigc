import 'server-only';

/** Match the feature gates used by the HTTP document routes. */
export function documentTransportMode(): 'ws' | 'http' {
  return process.env.WUJIE_YJS_ENABLED === 'true' && process.env.WUJIE_YJS_HTTP_ENABLED === 'true' ? 'http' : 'ws';
}

export function documentWebSocketEnabled(): boolean {
  return process.env.WUJIE_YJS_ENABLED === 'true' && documentTransportMode() === 'ws';
}
