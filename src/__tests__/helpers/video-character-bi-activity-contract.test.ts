import {expect,it} from 'vitest';
import {validateBIActivity,type BIActivityInput} from './video-character-bi-upload-contract';
function input(value:Record<string,unknown>={action:'post_api_request',method:'POST',path:'/api/save-image',status:200,durationMs:7}):BIActivityInput{return {url:'https://canvas-shell-mobile.invalid/api/activity',method:'POST',headers:{'content-type':'application/json'},body:new TextEncoder().encode(JSON.stringify(value)),slot:0,statuses:[200]};}
it('BI activity accepts only linked successful upload',async()=>{expect(await validateBIActivity(input())).toEqual({slot:0,status:200,durationMs:7});});
it('BI activity accepts only linked rejected upload',async()=>{const v=input({action:'post_api_request',method:'POST',path:'/api/save-image',status:500,durationMs:9});v.statuses=[500];expect(await validateBIActivity(v)).toEqual({slot:0,status:500,durationMs:9});});
it('BI activity refuses credentials',async()=>{const v=input();v.headers.Authorization='synthetic-only';await expect(validateBIActivity(v)).rejects.toThrow('BI_ACTIVITY_CREDENTIALS');});
it('BI activity refuses another endpoint',async()=>{await expect(validateBIActivity({...input(),url:'https://canvas-shell-mobile.invalid/api/other'})).rejects.toThrow('BI_ACTIVITY_URL');});
it('BI activity refuses unrelated status',async()=>{await expect(validateBIActivity(input({action:'post_api_request',method:'POST',path:'/api/save-image',status:500,durationMs:1}))).rejects.toThrow('BI_ACTIVITY_STATUS');});
it('BI activity refuses another action',async()=>{await expect(validateBIActivity(input({action:'image_generate',method:'POST',path:'/api/save-image',status:200,durationMs:1}))).rejects.toThrow('BI_ACTIVITY_FIELDS');});
it('BI activity refuses another audited path',async()=>{await expect(validateBIActivity(input({action:'post_api_request',method:'POST',path:'/api/delete',status:200,durationMs:1}))).rejects.toThrow('BI_ACTIVITY_FIELDS');});
it('BI activity refuses malformed JSON',async()=>{await expect(validateBIActivity({...input(),body:Uint8Array.of(123)})).rejects.toThrow('BI_ACTIVITY_JSON');});
it('BI activity refuses extra fields',async()=>{await expect(validateBIActivity(input({action:'post_api_request',method:'POST',path:'/api/save-image',status:200,durationMs:1,secret:'not allowed'}))).rejects.toThrow('BI_ACTIVITY_FIELDS');});
it('BI activity refuses invalid duration',async()=>{await expect(validateBIActivity(input({action:'post_api_request',method:'POST',path:'/api/save-image',status:200,durationMs:-1}))).rejects.toThrow('BI_ACTIVITY_DURATION');});
it('BI activity refuses unsolicited slot',async()=>{await expect(validateBIActivity({...input(),slot:2})).rejects.toThrow('BI_ACTIVITY_COUNT');});
it('BI activity refuses another method',async()=>{await expect(validateBIActivity({...input(),method:'GET'})).rejects.toThrow('BI_ACTIVITY_METHOD');});
it('BI activity refuses excessive body',async()=>{await expect(validateBIActivity({...input(),body:new Uint8Array(513)})).rejects.toThrow('BI_ACTIVITY_BODY_LIMIT');});
