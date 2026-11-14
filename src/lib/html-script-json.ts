/** Encodes JSON for insertion in an HTML script element. */
export function encodeHtmlScriptJson(value: string | object): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}
