/**
 * A provider selected by the user is a routing contract, not a preference.
 * Cross-provider fallback is only allowed when the request did not name one.
 */
export function canFallbackToAnotherProvider(providerId?: string): boolean {
  return !providerId?.trim();
}
