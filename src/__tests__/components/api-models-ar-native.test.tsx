// @vitest-environment node
// AR: real full Dashboard and capability editor; draft-only operations with exact synthetic reads.
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import type {ApiProvider,ModelInfo} from '@/lib/universal-api-types';
import {MATRIX,withSession,main,reach,readable,reveal,activate,settle,quiet,capture,geometry,noHorizontalOverflow,type Session,type NativePlan,type ReadReply,type MatrixEntry} from '../helpers/admin-dashboard-native-fixture';

const IMAGE_NAME='AR图像模型_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const VIDEO_NAME='AR 视频模型';
const CHAT_NAME='AR 视觉对话模型';
const MODELS:ModelInfo[]=[
 {id:'ar-image',name:IMAGE_NAME,providerId:'ar-provider',type:'image',supportedAspectRatios:['5:4']},
 {id:'ar-video',name:VIDEO_NAME,providerId:'ar-provider',type:'video',allowedDurationsSeconds:[7],supportedOperations:['multi-reference']},
 {id:'ar-chat',name:CHAT_NAME,providerId:'ar-provider',type:'chat'},
];
const PROVIDER:ApiProvider={id:'ar-provider',name:'AR 合成供应商',displayName:'AR 合成供应商',baseUrl:'https://ar-provider.invalid/v1',apiKey:'',isEnabled:true,type:'universal',modelType:'universal',createdAt:1,updatedAt:1,selectedModels:['ar-image','ar-video','ar-chat'],discoveredModels:MODELS,advancedParams:{taskModelCapabilities:JSON.stringify({version:1,models:{'ar-image':{allowedRatios:['1:1'],maxOutputs:1},'ar-video':{allowedDurationsSeconds:[5],maxDurationSeconds:10},'ar-chat':{supportsVision:false}}})}};
const BASE:Record<string,unknown>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},
 '/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:''}},
 '/api/admin/users':{success:true,users:[]},
 '/api/admin/apis':{success:true,providers:[PROVIDER]},
 '/api/admin/groups':{success:true,groups:[]},
 '/api/admin/api-balance':{success:true,balances:[]},
 '/api/ecom-templates':{success:true,templates:[]},
};
const EXTRA:Record<string,unknown>={
 '/api/admin/production-readiness':{database:{status:'pass'},summary:{total:1,enabled:1,ready:1,warnings:0,failures:0},providers:[{id:'ar-provider',name:'AR 合成供应商',status:'pass',issues:[]}]},
 '/api/admin/cloud-tasks?limit=20':{success:true,tasks:[{id:'ar-task',label:'AR 合成只读任务',type:'image',status:'completed',progress:100,handlerVersion:'ar',requestedProviderId:'ar-provider',requestedModelId:'ar-image',actualProviderId:'ar-provider',actualModelId:'ar-image',providerName:'AR 合成供应商',durationMs:1000,billing:{status:'settled',cost:0},requestId:'ar-request',updatedAt:1792368000000}]},
 '/api/admin/cloud-tasks?view=provider-summary':{success:true,providers:[{providerId:'ar-provider',total:1,processing:0,failed:0}]},
};
function plan():NativePlan{
 const reads=(b:Record<string,unknown>):Readonly<Record<string,ReadReply>>=>Object.fromEntries(Object.entries(b).map(([url,body]:[string,unknown]):[string,ReadReply]=>[url,{count:1,body}]));
 return {kind:'api-form',steps:[reads(BASE),reads({...BASE,...EXTRA})]};
}
function drawer(s:Session):Locator{return s.page.getByRole('dialog',{name:'编辑 API 配置',exact:true});}
function caps(s:Session):Locator{return drawer(s).getByRole('region',{name:'模型能力配置',exact:true});}
function list(s:Session):Locator{return drawer(s).getByRole('group',{name:'已发现模型',exact:true});}
async function openApi(s:Session):Promise<void>{
 await s.page.getByRole('button',{name:'展开导航',exact:true}).click();
 const destination=s.page.getByRole('navigation').getByRole('button',{name:/API 管理/});await reveal(s,destination);
 s.step=1;await destination.click();await settle(s);await main(s).hover();await settle(s);await quiet(s);
 await activate(s,main(s).getByRole('button',{name:'编辑',exact:true}));expect(await drawer(s).count()).toBe(1);
}
async function fill(s:Session,field:Locator,value:string):Promise<void>{
 await reach(s,field);await field.click();await s.page.keyboard.press('ControlOrMeta+A');
 if(value)await s.page.keyboard.insertText(value);else await s.page.keyboard.press('Backspace');
 await settle(s);expect(await field.inputValue()).toBe(value);
}
async function toggle(s:Session,checkbox:Locator,want:boolean):Promise<void>{
 expect(await checkbox.count()).toBe(1);const label=checkbox.locator('..');
 expect(await label.evaluate((e:Element):string=>e.tagName)).toBe('LABEL');
 await reach(s,label);await label.click();await settle(s);expect(await checkbox.isChecked()).toBe(want);await quiet(s);
}
async function selectModel(s:Session,name:string):Promise<void>{
 const button=caps(s).getByRole('button',{name,exact:true});await activate(s,button,false);
 expect(await button.getAttribute('aria-pressed')).toBe('true');
}
async function cancelAndReopen(s:Session):Promise<void>{
 await activate(s,drawer(s).getByRole('button',{name:'取消',exact:true}));expect(await drawer(s).count()).toBe(0);
 await activate(s,main(s).getByRole('button',{name:'编辑',exact:true}));await quiet(s);
}
async function allCheckboxTargets(s:Session,region:Locator):Promise<void>{
 const labels=region.locator('label').filter({has:s.page.getByRole('checkbox')});
 expect(await labels.count()).toBeGreaterThan(0);
 for(const label of await labels.all())await reach(s,label);
}
async function probe(s:Session,label:string,locators:Readonly<Record<string,Locator>>):Promise<void>{
 const rows:Record<string,unknown>={};
 for(const [name,target] of Object.entries(locators))rows[name]=await target.count()===1?await geometry(target):{count:await target.count()};
 console.log('AR_READ_ONLY_PROBE',JSON.stringify({label,rows}));
}

describe.each(MATRIX)('AR API model drafts $theme $width x $height',(entry:MatrixEntry):void=>{
 it('manual model dialog fits, labels and validates ID, updates only the draft, and parent cancellation restores originals',async():Promise<void>=>{
  // Breaks caught: fixed-width/offscreen nested modal, unlabelled small fields, empty-ID no-op, local add/edit or cancel/reset lost.
  await withSession(entry,plan(),async(s:Session):Promise<void>=>{
   await openApi(s);await activate(s,drawer(s).getByRole('button',{name:'手动添加',exact:true}));
   await probe(s,'nested-model-modal',{id:s.page.getByPlaceholder('模型标识，如：gpt-4o-2024-08-06'),name:s.page.getByPlaceholder('模型显示名称，如：GPT-4o'),context:s.page.getByPlaceholder('例如：128000')});
   const dialog=s.page.getByRole('dialog',{name:'添加新模型',exact:true});expect(await dialog.count()).toBe(1);
   expect(await dialog.getByRole('button',{name:'确认添加',exact:true}).isDisabled()).toBe(true);
   await fill(s,dialog.getByRole('textbox',{name:'显示名称',exact:true}),'AR 临时模型');
   await fill(s,dialog.getByRole('textbox',{name:'模型 ID',exact:true}),'ar-draft-new');
   await fill(s,dialog.getByRole('spinbutton',{name:'上下文窗口 (tokens)',exact:true}),'8000');
   await capture(s,'manual-model-form');await activate(s,dialog.getByRole('button',{name:'确认添加',exact:true}));expect(await dialog.count()).toBe(0);
   const added=list(s).getByText('AR 临时模型',{exact:true});await readable(s,added,true);
   await activate(s,list(s).getByRole('button',{name:'编辑模型 AR 临时模型',exact:true}));
   const editing=s.page.getByRole('dialog',{name:'编辑模型',exact:true});expect(await editing.count()).toBe(1);
   expect(await editing.getByRole('textbox',{name:'模型 ID',exact:true}).inputValue()).toBe('ar-draft-new');
   expect(await editing.getByRole('spinbutton',{name:'上下文窗口 (tokens)',exact:true}).inputValue()).toBe('8000');
   await fill(s,editing.getByRole('textbox',{name:'显示名称',exact:true}),'AR 临时模型改名');
   await capture(s,'manual-model-edit');await activate(s,editing.getByRole('button',{name:'保存',exact:true}));await readable(s,list(s).getByText('AR 临时模型改名',{exact:true}),true);
   await cancelAndReopen(s);expect(await list(s).getByText('ar-draft-new',{exact:true}).count()).toBe(0);
   await activate(s,drawer(s).getByRole('button',{name:'手动添加',exact:true}));
   const reopened=s.page.getByRole('dialog',{name:'添加新模型',exact:true});expect(await reopened.getByRole('textbox',{name:'模型 ID',exact:true}).inputValue()).toBe('');
   await activate(s,reopened.getByRole('button',{name:'关闭模型窗口',exact:true}));await capture(s,'manual-draft-reset');
   await activate(s,drawer(s).getByRole('button',{name:'关闭API配置',exact:true}));await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('discovered model selection has named 44px tap areas, fully readable identities and edit controls visible without hover',async():Promise<void>=>{
  // Breaks caught: a tiny unlabeled checkbox, truncated model identity, hover-only edit or draft selection leaking after cancel.
  await withSession(entry,plan(),async(s:Session):Promise<void>=>{
   await openApi(s);await probe(s,'model-controls',{checkbox:drawer(s).locator('input[type=checkbox]').first(),choice:caps(s).getByRole('button',{name:IMAGE_NAME,exact:true})});
   const region=list(s);expect(await region.count()).toBe(1);await readable(s,region.getByText(IMAGE_NAME,{exact:true}));
   const selected=region.getByRole('checkbox',{name:'选择模型 '+IMAGE_NAME,exact:true});expect(await selected.isChecked()).toBe(true);
   await toggle(s,selected,false);await toggle(s,selected,true);
   const edit=region.getByRole('button',{name:'编辑模型 '+IMAGE_NAME,exact:true});await reveal(s,edit);await s.page.mouse.move(5,5);await reach(s,edit);
   await activate(s,edit);const nested=s.page.getByRole('dialog',{name:'编辑模型',exact:true});expect(await nested.count()).toBe(1);
   expect(await nested.getByRole('textbox',{name:'模型 ID',exact:true}).inputValue()).toBe('ar-image');
   await activate(s,nested.getByRole('button',{name:'取消',exact:true}));
   await activate(s,drawer(s).getByRole('button',{name:'清空',exact:true}));expect(await caps(s).count()).toBe(0);
   await activate(s,drawer(s).getByRole('button',{name:'全选',exact:true}));expect(await caps(s).count()).toBe(1);
   await toggle(s,selected,false);
   await cancelAndReopen(s);
   expect(await list(s).getByRole('checkbox').count()).toBe(3);
   for(const originalName of [IMAGE_NAME,VIDEO_NAME,CHAT_NAME])expect(await list(s).getByRole('checkbox',{name:'选择模型 '+originalName,exact:true}).isChecked()).toBe(true);
   await readable(s,list(s).getByText(IMAGE_NAME,{exact:true}));await capture(s,'model-selection-draft-only');await activate(s,drawer(s).getByRole('button',{name:'关闭API配置',exact:true}));await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('image capability targets, numeric inputs and per-model feedback work without persisting changes',async():Promise<void>=>{
  // Breaks caught: short labels cannot be tapped, small numeric inputs, long model choices overflow, wrong selected feedback or cross-model overwrite.
  await withSession(entry,plan(),async(s:Session):Promise<void>=>{
   await openApi(s);await probe(s,'image-capability',{choice:caps(s).getByRole('button',{name:IMAGE_NAME,exact:true}),ratio:caps(s).getByRole('checkbox',{name:'16:9',exact:true}).locator('..'),outputs:caps(s).getByRole('spinbutton',{name:'最大生成数量',exact:true})});
   await selectModel(s,IMAGE_NAME);await allCheckboxTargets(s,caps(s));
   expect(await caps(s).getByRole('checkbox',{name:'1:1',exact:true}).isChecked()).toBe(true);
   await toggle(s,caps(s).getByRole('checkbox',{name:'16:9',exact:true}),true);
   await toggle(s,caps(s).getByRole('checkbox',{name:'2K',exact:true}),true);
   await toggle(s,caps(s).getByRole('checkbox',{name:'high',exact:true}),true);
   await toggle(s,caps(s).getByRole('checkbox',{name:'支持参考图',exact:true}),true);
   await toggle(s,caps(s).getByRole('checkbox',{name:'支持蒙版',exact:true}),true);
   await toggle(s,caps(s).getByRole('checkbox',{name:'webp',exact:true}),true);
   await fill(s,caps(s).getByRole('spinbutton',{name:'最大生成数量',exact:true}),'4');
   await fill(s,caps(s).getByRole('spinbutton',{name:'最大参考图数量',exact:true}),'8');await capture(s,'image-capability-inputs');
   await selectModel(s,VIDEO_NAME);expect(await caps(s).getByRole('spinbutton',{name:'最大时长（秒）',exact:true}).inputValue()).toBe('10');
   await selectModel(s,IMAGE_NAME);expect(await caps(s).getByRole('checkbox',{name:'16:9',exact:true}).isChecked()).toBe(true);expect(await caps(s).getByRole('spinbutton',{name:'最大生成数量',exact:true}).inputValue()).toBe('4');
   await activate(s,caps(s).getByRole('button',{name:'删除 '+IMAGE_NAME+' 的能力配置',exact:true}));expect(await caps(s).getByRole('spinbutton',{name:'最大生成数量',exact:true}).inputValue()).toBe('');
   await selectModel(s,VIDEO_NAME);expect(await caps(s).getByRole('spinbutton',{name:'最大时长（秒）',exact:true}).inputValue()).toBe('10');
   await capture(s,'image-capability-draft');await cancelAndReopen(s);expect(await caps(s).getByRole('spinbutton',{name:'最大生成数量',exact:true}).inputValue()).toBe('1');
   await activate(s,drawer(s).getByRole('button',{name:'关闭API配置',exact:true}));await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('video duration and operation controls remain reachable and independent of image capability drafts',async():Promise<void>=>{
  // Breaks caught: short target duration labels, inaccessible max-duration, absent selected feedback or state crossing models.
  await withSession(entry,plan(),async(s:Session):Promise<void>=>{
   await openApi(s);await selectModel(s,VIDEO_NAME);await allCheckboxTargets(s,caps(s));
   expect(await caps(s).getByRole('checkbox',{name:'5',exact:true}).isChecked()).toBe(true);
   await toggle(s,caps(s).getByRole('checkbox',{name:'7',exact:true}),true);
   await toggle(s,caps(s).getByRole('checkbox',{name:'多参考图',exact:true}),true);
   await fill(s,caps(s).getByRole('spinbutton',{name:'最大时长（秒）',exact:true}),'15');
   await selectModel(s,IMAGE_NAME);expect(await caps(s).getByRole('spinbutton',{name:'最大生成数量',exact:true}).inputValue()).toBe('1');
   await selectModel(s,VIDEO_NAME);expect(await caps(s).getByRole('spinbutton',{name:'最大时长（秒）',exact:true}).inputValue()).toBe('15');expect(await caps(s).getByRole('checkbox',{name:'7',exact:true}).isChecked()).toBe(true);
   await capture(s,'video-capability-draft');await cancelAndReopen(s);await selectModel(s,VIDEO_NAME);expect(await caps(s).getByRole('spinbutton',{name:'最大时长（秒）',exact:true}).inputValue()).toBe('10');
   await activate(s,drawer(s).getByRole('button',{name:'关闭API配置',exact:true}));await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('chat vision capability has an operable labelled toggle, visible choice state and original value after cancel',async():Promise<void>=>{
  // Breaks caught: vision label too small to tap, missing model selected state, switch losing the draft or cancellation keeping it.
  await withSession(entry,plan(),async(s:Session):Promise<void>=>{
   await openApi(s);await selectModel(s,CHAT_NAME);const vision=caps(s).getByRole('checkbox',{name:'支持视觉理解',exact:true});
   expect(await vision.isChecked()).toBe(false);await toggle(s,vision,true);
   await selectModel(s,VIDEO_NAME);await selectModel(s,CHAT_NAME);expect(await vision.isChecked()).toBe(true);
   await reach(s,vision.locator('..'));await capture(s,'chat-vision-draft');await cancelAndReopen(s);await selectModel(s,CHAT_NAME);expect(await vision.isChecked()).toBe(false);
   await activate(s,drawer(s).getByRole('button',{name:'关闭API配置',exact:true}));await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
});
