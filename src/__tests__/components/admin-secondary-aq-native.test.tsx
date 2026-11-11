// @vitest-environment node
// AQ: actual Dashboard/AdminTabs; exact synthetic reads and clipboard sink only.
import {describe,it,expect} from 'vitest';
import {MATRIX,ORIGIN,withSession,withGeometryCalibration,geometry,main,reach,readable,reveal,activate,settle,quiet,ui,capture,noHorizontalOverflow,type Session,type NativePlan,type ReadReply} from '../helpers/admin-dashboard-native-fixture';
import type {Locator} from '@playwright/test';
import type {ApiProvider} from '@/lib/universal-api-types';
const BASE_BODIES={
  "/api/credits/payment-status": {
    "success": true,
    "status": {
      "wechat": false,
      "alipay": false
    },
    "canRecharge": false,
    "methods": []
  },
  "/api/credits/payment-config": {
    "success": true,
    "config": {
      "wechatQrUrl": "",
      "alipayQrUrl": ""
    }
  },
  "/api/admin/users": {
    "success": true,
    "users": []
  },
  "/api/admin/apis": {
    "success": true,
    "providers": [
      {
        "id": "aq-provider",
        "name": "AQ图像供应商",
        "displayName": "AQ图像供应商",
        "baseUrl": "https://aq-provider.invalid/public/compatible/v1",
        "modelType": "image",
        "type": "image",
        "createdAt": 1,
        "updatedAt": 1,
        "isEnabled": true,
        "apiKey": "",
        "selectedModels": [
          "aq-image-model"
        ],
        "discoveredModels": [
          {
            "id": "aq-image-model",
            "name": "AQ图像模型",
            "providerId": "aq-provider",
            "type": "image"
          }
        ]
      } satisfies ApiProvider
    ]
  },
  "/api/admin/groups": {
    "success": true,
    "groups": []
  },
  "/api/admin/api-balance": {
    "success": true,
    "balances": []
  },
  "/api/ecom-templates": {
    "success": true,
    "templates": []
  }
};
const API_BODIES={
  "/api/admin/production-readiness": {
    "database": {
      "status": "pass"
    },
    "summary": {
      "total": 1,
      "enabled": 1,
      "ready": 1,
      "warnings": 0,
      "failures": 0
    },
    "providers": [
      {
        "id": "aq-provider",
        "name": "AQ图像供应商",
        "status": "pass",
        "issues": []
      }
    ]
  },
  "/api/admin/cloud-tasks?limit=20": {
    "success": true,
    "tasks": [
      {
        "id": "aq-task",
        "label": "AQ合成只读任务",
        "type": "image",
        "status": "completed",
        "progress": 100,
        "handlerVersion": "aq",
        "requestedProviderId": "aq-provider",
        "requestedModelId": "aq-image-model",
        "actualProviderId": "aq-provider",
        "actualModelId": "aq-image-model",
        "providerName": "AQ图像供应商",
        "durationMs": 1000,
        "billing": {
          "status": "settled",
          "cost": 0
        },
        "requestId": "aq-request",
        "updatedAt": 1792368000000
      }
    ]
  },
  "/api/admin/cloud-tasks?view=provider-summary": {
    "success": true,
    "providers": [
      {
        "providerId": "aq-provider",
        "total": 1,
        "processing": 0,
        "failed": 0
      }
    ]
  }
};
const CONNECTOR_BODIES={
  "/api/dcc/health": {
    "success": true,
    "name": "AQ DCC",
    "version": "1.0"
  },
  "/api/dcc/preflight": {
    "success": true,
    "recommended": {
      "defaultRenderMode": "remote"
    }
  },
  "/api/dcc/templates": {
    "templates": [
      {
        "id": "aq-dcc-template",
        "name": "AQ DCC 模板",
        "category": "AQ",
        "content": "合成只读模板"
      }
    ]
  },
  "/api/creative/health": {
    "success": true,
    "name": "AQ Creative",
    "version": "1.0",
    "authRequired": false,
    "hosts": {
      "photoshopCep": true,
      "illustratorCep": true
    },
    "capabilities": {
      "photoshop_generate_with_reference_image_and_preserve_original_layers": true
    }
  },
  "/api/creative/templates?host=photoshop": {
    "templates": [
      {
        "id": "aq-ps",
        "name": "AQ Photoshop 模板",
        "prompt": "合成只读提示"
      }
    ]
  },
  "/api/creative/templates?host=illustrator": {
    "templates": [
      {
        "id": "aq-ai",
        "name": "AQ Illustrator 模板",
        "prompt": "合成只读提示"
      }
    ]
  }
};
const AUDIT_LOG={
  "id": "aq-log-one",
  "created_at": 1792368000000,
  "user_id": "aq-actor",
  "user_name": "AQ合成操作者",
  "action": "image_generate",
  "level": "error",
  "resolution_status": "none",
  "detail": "AQ合成长详情_ABCDEFGHIJKLMNOPQRSTUVWXYZ_只用于移动排版",
  "error_message": "AQ合成任务错误",
  "target_type": "image",
  "target_id": "aq-image",
  "provider_id": "aq-provider",
  "model": "aq-image-model",
  "duration_ms": 1000,
  "stack_trace": "AQ synthetic trace",
  "request_data": {
    "prompt": "AQ synthetic only"
  }
};
const STATS={todayActions:3,totalActions:21,errorCount:1,levelBreakdown:{warn:1},unresolvedErrorCount:1};
function base():Record<string,ReadReply>{return Object.fromEntries(Object.entries(BASE_BODIES).map(([url,body])=>[url,{count:1,body}]));}
function extend(previous:Readonly<Record<string,ReadReply>>,url:string,count:number,body:unknown):Record<string,ReadReply>{return {...previous,[url]:{count,body}};}
function auditPlan():NativePlan{
 const steps=[base()];let reads=steps[0];
 reads=extend(reads,'/api/admin/audit?limit=50&offset=0',1,{success:true,logs:[],total:0});
 reads=extend(reads,'/api/admin/audit?stats=true',1,{success:true,stats:STATS});
 const data={success:true,logs:[AUDIT_LOG],total:21};
 reads=extend(reads,'/api/admin/op-log?page=1&limit=20',1,data);steps.push(reads);
 for(const [url,count,body] of [
 ['/api/admin/op-log?page=1&limit=20',2,data],
 ['/api/admin/op-log?page=1&limit=20&action=image_generate',1,data],
 ['/api/admin/op-log?page=1&limit=20&action=image_generate&level=error',1,data],
 ['/api/admin/op-log?page=1&limit=20&action=image_generate&level=error&userId=aq-actor',1,data],
 ['/api/admin/op-log?page=1&limit=20',3,data],
 ['/api/admin/op-log?page=2&limit=20',1,{success:true,logs:[{...AUDIT_LOG,id:'aq-log-two',error_message:'AQ第二页错误'}],total:21}],
 ['/api/admin/op-log?page=1&limit=20',4,data],
 ] as const){
  reads=extend(reads,url,count,body);
  reads=extend(reads,'/api/admin/audit?stats=true',steps.length,{success:true,stats:STATS});
  steps.push(reads);
 }
 return {kind:'audit',steps};
}
function apiPlan(kind:'api-list'|'api-form'):NativePlan{
 const steps=[base()];let reads=steps[0];for(const [url,body] of Object.entries(API_BODIES))reads=extend(reads,url,1,body);steps.push(reads);
 if(kind==='api-list'){
  reads=extend(reads,'/api/admin/api-balance',2,BASE_BODIES['/api/admin/api-balance']);steps.push(reads);
  reads=extend(reads,'/api/admin/production-readiness',2,API_BODIES['/api/admin/production-readiness']);steps.push(reads);
 }
 return {kind,steps};
}
const LONG_PROVIDER_NAME='AQProviderABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(6);
function longApiPlan():NativePlan{
 const plan=apiPlan('api-list');
 return {...plan,steps:plan.steps.map(reads=>({...reads,'/api/admin/apis':{count:1,body:{success:true,providers:[{...BASE_BODIES['/api/admin/apis'].providers[0],name:LONG_PROVIDER_NAME,displayName:LONG_PROVIDER_NAME}]}}}))};
}
function connectorPlan():NativePlan{
 const steps=[base()];let reads=steps[0];for(const [url,body] of Object.entries(CONNECTOR_BODIES))reads=extend(reads,url,1,body);steps.push(reads);
 for(const [url,body] of Object.entries(CONNECTOR_BODIES))reads=extend(reads,url,2,body);steps.push(reads);
 return {kind:'connector',steps};
}
async function navigate(s:Session,label:string,title:string):Promise<void>{
 const trigger=s.page.getByRole('button',{name:'展开导航',exact:true});await trigger.click();
 const destination=s.page.getByRole('navigation').getByRole('button',{name:new RegExp(label)});await reveal(s,destination);
 s.step=1;await destination.click();await settle(s);
 if(s.kind==='api-list'||s.kind==='api-form'){await main(s).hover();await settle(s);}
 expect(await main(s).getByRole('heading',{name:title,exact:true}).count()).toBe(1);await quiet(s);
}
async function fill(s:Session,input:Locator,value:string):Promise<void>{
 await reach(s,input);await input.click();await s.page.keyboard.press('ControlOrMeta+A');
 if(value)await s.page.keyboard.insertText(value);else await s.page.keyboard.press('Backspace');
 await settle(s);expect(await input.inputValue()).toBe(value);
}
async function choose(s:Session,control:Locator,value:string):Promise<void>{
 await reach(s,control);await control.selectOption(value);await settle(s);expect(await control.inputValue()).toBe(value);
}
async function step(s:Session,index:number,control:Locator):Promise<void>{s.step=index;await activate(s,control);await settle(s);await quiet(s);}
describe.each(MATRIX)('AQ secondary admin $theme $width x $height',entry=>{
 it('geometry calibration distinguishes viewport-fixed, genuinely clipped and occluded controls',async():Promise<void>=>{
  await withGeometryCalibration(entry,async page=>{
   const fixed=await geometry(page.locator('#viewport-fixed'));
   expect(fixed.clear).toBe(true);expect(fixed.glyphs).toBe(true);expect(fixed.iconsFit).toBe(true);expect(fixed.fiveHits).toBe(true);
   expect((await geometry(page.locator('#normal-clipped'))).clear).toBe(false);
   expect((await geometry(page.locator('#fixed-clipped'))).clear).toBe(false);
   const covered=await geometry(page.locator('#occluded'));expect(covered.clear).toBe(true);expect(covered.fiveHits).toBe(false);
  });
 },25000);
 it('audit filters, read-only detail and pagination remain touch-sized and locally scrollable',async():Promise<void>=>{
  // Breaks caught: vertical/small filters, unreachable table actions, clipped expanded text, wrong query or page state.
  await withSession(entry,auditPlan(),async(s:Session):Promise<void>=>{
   await navigate(s,'操作日志','操作日志');
   const summary=main(s).locator('div.grid').filter({has:s.page.getByText('今日操作',{exact:true})});expect(await summary.count()).toBe(1);
   for(const label of ['今日操作','本周操作','总记录','累计错误','累计警告','未处理错误'])await readable(s,summary.getByText(label,{exact:true}),true);
   await reach(s,main(s).getByRole('button',{name:'刷新',exact:true}));
   const action=main(s).getByRole('combobox',{name:'操作类型筛选',exact:true});const level=main(s).getByRole('combobox',{name:'日志级别筛选',exact:true});
   const user=main(s).getByRole('textbox',{name:'用户ID筛选',exact:true});
   await reach(s,action);await reach(s,level);await reach(s,user);
   await step(s,2,main(s).getByRole('button',{name:'刷新',exact:true}));
   s.step=3;await choose(s,action,'image_generate');await quiet(s);
   s.step=4;await choose(s,level,'error');await quiet(s);
   await fill(s,user,'aq-actor');s.step=5;await s.page.keyboard.press('Enter');await settle(s);await quiet(s);
   await step(s,6,main(s).getByRole('button',{name:'重置筛选',exact:true}));
   expect(await action.inputValue()).toBe('all');expect(await level.inputValue()).toBe('all');expect(await user.inputValue()).toBe('');
   const region=main(s).getByRole('region',{name:'操作日志列表，可横向滚动',exact:true});expect(await region.count()).toBe(1);expect(await region.getAttribute('tabindex')).toBe('0');
   // Native horizontal traversal is checked independently; intentional local table scrolling is not page overflow.
   await reveal(s,region);const r=await region.boundingBox();if(!r)throw Error('AQ_TABLE_BOX');
   await s.page.mouse.move(r.x+r.width/2,r.y+r.height/2);await s.page.mouse.wheel(1200,0);await settle(s);
   expect(await region.evaluate(e=>e.scrollLeft),'local horizontal wheel exposes the final table column').toBeGreaterThan(0);
   const expand=region.getByRole('button',{name:'展开详情',exact:true});await activate(s,expand);await settle(s);
   const rr=await region.boundingBox();if(!rr)throw Error('AQ_TABLE_BOX');await s.page.mouse.move(rr.x+rr.width/2,rr.y+Math.min(20,rr.height/2));await s.page.mouse.wheel(-1200,0);await settle(s);
   const detail=region.locator('pre').filter({hasText:'AQ合成长详情_ABCDEFGHIJKLMNOPQRSTUVWXYZ_只用于移动排版'});expect(await detail.count()).toBe(1);await readable(s,detail);
   await step(s,7,main(s).getByRole('button',{name:'下一页',exact:true}));expect(await main(s).getByText('AQ第二页错误',{exact:true}).count()).toBe(1);
   await step(s,8,main(s).getByRole('button',{name:'上一页',exact:true}));expect(await region.locator('tbody > tr').first().getByText('AQ合成任务错误',{exact:true}).count()).toBe(1);
   await noHorizontalOverflow(s);await capture(s,'audit-read-only-controls');
  });
 },25000);
 it('API status, filtering and refresh controls stay readable without vendor or paid calls',async():Promise<void>=>{
  // Breaks caught: undersized API tools/selects, clipped service identity or filters losing usable results.
  await withSession(entry,apiPlan('api-list'),async(s:Session):Promise<void>=>{
   await navigate(s,'API 管理','API 管理');
   for(const name of ['发布自检','刷新余额','刷新列表','添加 API'])await reach(s,main(s).getByRole('button',{name,exact:true}));
   const type=main(s).getByRole('combobox',{name:'API类型筛选',exact:true});const status=main(s).getByRole('combobox',{name:'API状态筛选',exact:true});
   await reach(s,type);await reach(s,status);const search=main(s).getByPlaceholder('搜索 API 名称或 URL...');await fill(s,search,'AQ图像供应商');
   expect(await main(s).getByText('AQ图像供应商',{exact:true}).count()).toBe(1);await readable(s,main(s).getByText('https://aq-provider.invalid/public/compatible/v1',{exact:true}));
   await choose(s,status,'disabled');expect(await main(s).getByText('AQ图像供应商',{exact:true}).count()).toBe(0);
   await choose(s,status,'enabled');expect(await main(s).getByText('AQ图像供应商',{exact:true}).count()).toBe(1);
   await step(s,2,main(s).getByRole('button',{name:'刷新余额',exact:true}));await step(s,3,main(s).getByRole('button',{name:'发布自检',exact:true}));
   await noHorizontalOverflow(s);await capture(s,'api-filters-read-only');
  });
 },25000);
 it('API add drawer supports native labelled input, visibility toggle and cancellation/reset without save',async():Promise<void>=>{
  // Breaks caught: clipped two-column narrow form, unlabeled/undersized fields, missing close or stale canceled draft.
  await withSession(entry,apiPlan('api-form'),async(s:Session):Promise<void>=>{
   await navigate(s,'API 管理','API 管理');await activate(s,main(s).getByRole('button',{name:'添加 API',exact:true}));
   const dialog=s.page.getByRole('dialog',{name:'添加新 API 配置',exact:true});expect(await dialog.count()).toBe(1);
   const name=dialog.getByRole('textbox',{name:/配置名称/});const display=dialog.getByRole('textbox',{name:'显示名称',exact:true});
   await fill(s,name,'AQ临时配置');await fill(s,display,'AQ临时显示');await reach(s,dialog.getByRole('combobox',{name:/API 类型/}));
   await reach(s,dialog.getByRole('textbox',{name:/API Base URL/}));await reach(s,dialog.getByRole('button',{name:'显示密钥',exact:true}));
   await activate(s,dialog.getByRole('button',{name:'显示密钥',exact:true}));expect(await dialog.getByRole('button',{name:'隐藏密钥',exact:true}).count()).toBe(1);
   await activate(s,dialog.getByRole('button',{name:'隐藏密钥',exact:true}));
   await reach(s,dialog.getByRole('button',{name:'关闭API配置',exact:true}));await capture(s,'api-drawer-input-and-key-toggle');await activate(s,dialog.getByRole('button',{name:'取消',exact:true}));
   expect(await s.page.getByRole('dialog',{name:'添加新 API 配置',exact:true}).count()).toBe(0);
   await activate(s,main(s).getByRole('button',{name:'添加 API',exact:true}));expect(await s.page.getByRole('dialog').getByRole('textbox',{name:/配置名称/}).inputValue()).toBe('');
   await activate(s,s.page.getByRole('dialog').getByRole('button',{name:'关闭API配置',exact:true}));
   await activate(s,main(s).getByRole('button',{name:'编辑',exact:true}));
   const editing=s.page.getByRole('dialog',{name:'编辑 API 配置',exact:true});expect(await editing.count()).toBe(1);
   await readable(s,editing.getByText('模型管理',{exact:true}),true);
   const modelSearch=editing.getByPlaceholder('搜索模型名称或ID...');await fill(s,modelSearch,'AQ');
   await activate(s,editing.getByRole('button',{name:'清空模型搜索',exact:true}));expect(await modelSearch.inputValue()).toBe('');
   await capture(s,'api-existing-model-search');await activate(s,editing.getByRole('button',{name:'关闭API配置',exact:true}));
   await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('long provider names remain fully readable without card or page overflow',async():Promise<void>=>{
  await withSession(entry,longApiPlan(),async(s:Session):Promise<void>=>{
   await navigate(s,'API 管理','API 管理');const name=main(s).getByText(LONG_PROVIDER_NAME,{exact:true});
   expect(await name.count()).toBe(1);await readable(s,name);await noHorizontalOverflow(s);await capture(s,'api-long-provider-name');await quiet(s);
  });
 },25000);
 it('connector status and address copying have usable controls and actual feedback with no OS clipboard write',async():Promise<void>=>{
  // Breaks caught: small controls, clipped URLs/capability strings, wrong copied origin or missing visible success feedback.
  await withSession(entry,connectorPlan(),async(s:Session):Promise<void>=>{
   await navigate(s,'插件连接器','插件连接器管理');await noHorizontalOverflow(s);
   await reach(s,main(s).getByRole('button',{name:'复制云端地址',exact:true}));await step(s,2,main(s).getByRole('button',{name:'刷新检测',exact:true}));
   await readable(s,main(s).getByText(ORIGIN,{exact:true}));await readable(s,main(s).getByText('AQ DCC',{exact:true}),true);
   await activate(s,main(s).getByRole('button',{name:'复制云端地址',exact:true}));await settle(s);
   expect((await ui(s)).clipboardWrites).toEqual([ORIGIN]);const feedback=s.page.getByText('云端地址已复制',{exact:true});expect(await feedback.count()).toBe(1);await readable(s,feedback);
   await capture(s,'connector-copy-virtual-clipboard');await quiet(s);
  });
 },25000);
});
