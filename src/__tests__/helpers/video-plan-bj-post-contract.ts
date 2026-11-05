export interface BJPostInput {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
  count: number;
  prior: ReadonlyArray<{ path: string; status: number }>;
}
export interface BJPostReceipt { path: string; body: Record<string, unknown> }
function exact(record: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(expected).sort())
    && Object.entries(expected).every(([key, value]) => Object.is(record[key], value));
}
export function validateBJPost(input: BJPostInput): BJPostReceipt {
  const origin = 'https://canvas-shell-mobile.invalid';
  const paths = ['/api/video/director/prompt', '/api/video/director/shot-plan', '/api/video/tools'];
  const url = new URL(input.url);
  if (input.method !== 'POST' || url.origin !== origin || url.username || url.password
    || url.search || url.hash || ![...paths, '/api/activity'].includes(url.pathname)) throw Error('BJ_POST_BOUNDARY');
  const headers = Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (['authorization', 'cookie', 'x-api-key', 'api-key', 'idempotency-key'].some(key => key in headers)
    || headers['content-type'] !== 'application/json') throw Error('BJ_POST_HEADERS');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > (url.pathname === '/api/activity' ? 3 : 1)) throw Error('BJ_POST_COUNT');
  if (!input.body || input.body.byteLength > 2048) throw Error('BJ_POST_BODY_LIMIT');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(input.body)); } catch { throw Error('BJ_POST_JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('BJ_POST_OBJECT');
  const body = parsed as Record<string, unknown>, pathname = url.pathname;
  if (pathname === '/api/video/director/prompt') {
    if (!exact(body, {userIdea:'BJ故事：海边骑行。',mode:'text2video',modelId:'bg-offline::kling-v3-video-generation',aspectRatio:'16:9',duration:10,style:'cinematic',verbosity:'standard'})) throw Error('BJ_POST_DIRECTOR');
  } else if (pathname === '/api/video/director/shot-plan') {
    if (!exact(body, {storyIdea:'BJ导演：海边骑行，镜头跟随。',duration:10,aspectRatio:'16:9',model:'bg-offline::kling-v3-video-generation',style:'cinematic',shotCount:3})) throw Error('BJ_POST_PLAN');
  } else if (pathname === '/api/video/tools') {
    const videos = body.videoUrls;
    if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(['action','videoUrls'])
      || body.action !== 'concat-videos' || !Array.isArray(videos) || videos.length !== 2 || new Set(videos).size !== 2
      || videos.some(value => ![origin+'/bj-video/A.mp4',origin+'/bj-video/B.mp4'].includes(value))) throw Error('BJ_POST_TOOLS');
  } else {
    const previous = input.prior[input.count - 1], duration = body.durationMs;
    if (!previous || !paths.includes(previous.path) || previous.status !== 200
      || typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0 || duration > 25000
      || !exact(body, {action:'post_api_request',method:'POST',path:previous.path,status:previous.status,durationMs:duration})) throw Error('BJ_POST_ACTIVITY');
  }
  return {path:pathname,body};
}
