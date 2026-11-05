// Only a local fixture seam. This does not authenticate or contact a real server.
export function acceptsEmptyOwnedProjectsSync(input){
 if(!input||input.url!=='https://canvas-shell-mobile.invalid/api/user-data/sync'||input.method!=='POST'||input.actorId!=='omp-mobile-user'||!Number.isSafeInteger(input.revision)||input.revision<0)return false;
 const h=input.headers;
 if(!h||h['content-type']!=='application/json'||['authorization','cookie','x-api-key','api-key','idempotency-key'].some(k=>Object.hasOwn(h,k)))return false;
 if(typeof input.body!=='string'||Buffer.byteLength(input.body)>128)return false;
 let value;try{value=JSON.parse(input.body);}catch{return false;}
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())==='["key","projectRevision","value"]'&&value.key==='projects'&&Array.isArray(value.value)&&value.value.length===0&&value.projectRevision===input.revision;
}
