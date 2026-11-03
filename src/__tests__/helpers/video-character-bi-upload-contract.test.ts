// Test-only exact-byte transport boundary, not a PNG decoder or real upload API.
import { expect, it } from 'vitest';
import { validateBIUpload, type BIUploadInput } from './video-character-bi-upload-contract';
const ORIGIN='https://canvas-shell-mobile.invalid';
const front=Uint8Array.of(1,2,3),side=Uint8Array.of(4,5);
interface Options {slot?:number;field?:string;name?:string;mime?:string;bytes?:Uint8Array;extra?:boolean}
async function input(options:Options={}):Promise<BIUploadInput>{
  const slot=options.slot??0,data=options.bytes??(slot===1?side:front),form=new FormData();
  form.append(options.field??'file',new Blob([Uint8Array.from(data).buffer],{type:options.mime??'image/png'}),options.name??(slot===1?'bi-side.png':'bi-front.png'));
  if(options.extra)form.append('unexpected','not allowed');
  const request=new globalThis.Request(ORIGIN+'/api/save-image',{method:'POST',body:form});
  return {url:request.url,method:request.method,headers:Object.fromEntries(request.headers.entries()),body:new Uint8Array(await request.arrayBuffer()),slot,front,side};
}
it('BI contract accepts only exact front slot and bytes',async()=>{expect(await validateBIUpload(await input())).toEqual({slot:0,role:'front',name:'bi-front.png',bytes:3});});
it('BI contract accepts only exact side slot and bytes',async()=>{expect(await validateBIUpload(await input({slot:1}))).toEqual({slot:1,role:'side',name:'bi-side.png',bytes:2});});
for(const [name,url] of [['origin','https://outside.invalid/api/save-image'],['query',ORIGIN+'/api/save-image?x=1'],['userinfo','https://user:pass@canvas-shell-mobile.invalid/api/save-image']] as const){it('BI contract refuses '+name,async()=>{await expect(validateBIUpload({...await input(),url})).rejects.toThrow('BI_UPLOAD_URL');});}
it('BI contract refuses non POST',async()=>{await expect(validateBIUpload({...await input(),method:'GET'})).rejects.toThrow('BI_UPLOAD_METHOD');});
for(const header of ['Authorization','cookie','x-api-key','api-key','idempotency-key']){it('BI contract refuses credential header '+header,async()=>{const v=await input();v.headers[header]='synthetic-only';await expect(validateBIUpload(v)).rejects.toThrow('BI_UPLOAD_CREDENTIALS');});}
it('BI contract refuses wrong file field',async()=>{await expect(validateBIUpload(await input({field:'image'}))).rejects.toThrow('BI_UPLOAD_FIELD');});
it('BI contract refuses non image PNG MIME',async()=>{await expect(validateBIUpload(await input({mime:'text/plain'}))).rejects.toThrow('BI_UPLOAD_MIME');});
it('BI contract refuses swapped slot filename',async()=>{await expect(validateBIUpload(await input({name:'bi-side.png'}))).rejects.toThrow('BI_UPLOAD_NAME');});
it('BI contract refuses changed bytes',async()=>{await expect(validateBIUpload(await input({bytes:Uint8Array.of(9,9,9)}))).rejects.toThrow('BI_UPLOAD_BYTES');});
it('BI contract refuses extra form fields',async()=>{await expect(validateBIUpload(await input({extra:true}))).rejects.toThrow('BI_UPLOAD_FIELD');});
it('BI contract refuses body above owned synthetic budget',async()=>{await expect(validateBIUpload({...await input(),body:new Uint8Array(4097)})).rejects.toThrow('BI_UPLOAD_BODY_LIMIT');});
it('BI contract refuses third slot',async()=>{await expect(validateBIUpload(await input({slot:2}))).rejects.toThrow('BI_UPLOAD_COUNT');});
it('BI contract refuses malformed multipart',async()=>{await expect(validateBIUpload({...await input(),body:new TextEncoder().encode('not multipart')})).rejects.toThrow('BI_UPLOAD_MULTIPART');});
