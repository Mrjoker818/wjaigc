// @vitest-environment node
// All writes stay denied. Only real local drafts, native scrolling and cancellation.
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import {MATRIX,withSession,main,activate,reach,readable,reveal,settle,quiet,type Session,type ReadReply,type NativePlan} from '../helpers/desktop-resource-az-native-fixture';
const MATRICES=[...MATRIX,{theme:'gold',width:390,height:844},{theme:'mono',width:390,height:844}] as const;
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jivsAAAAASUVORK5CYII=';
const LONG='AZ资源ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
interface Spec {type:string;payload:Record<string,unknown>;contentLabel:string;checks:readonly (readonly [string,string])[]}
const SPECS:readonly Spec[]=[
 {type:'prompt-template',payload:{variables:['product','style'],usage:'prompt-library'},contentLabel:'提示词正文',checks:[]},
 {type:'material',payload:{assetUrl:PNG,assetType:'image',license:'admin-shared'},contentLabel:'素材说明或素材地址',checks:[]},
 {type:'favorite-preset',payload:{targetTool:'image-generate',settings:{quality:'high'}},contentLabel:'预设说明',checks:[]},
 {type:'ecom-template',payload:{id:'AZ-existing-ecom',icon:'box',aspectRatio:'9:16',promptTemplate:'AZ {product}',negativePrompt:'low quality'},contentLabel:'电商模板提示词',checks:[['模板 ID','AZ-existing-ecom'],['画面比例','9:16']]},
 {type:'workflow-template',payload:{nodes:[],edges:[],version:1},contentLabel:'工作流说明',checks:[]},
 {type:'agent-template',payload:{tools:['analyze_image','image_edit'],steps:[],maxRounds:2},contentLabel:'Agent 系统提示词',checks:[['最大轮次','2'],['默认工具，逗号分隔','analyze_image, image_edit']]},
 {type:'font-gallery',payload:{style:'AZ hand',fontMood:'calm',referenceUrl:''},contentLabel:'案例说明 / 字体提示词',checks:[]},
 {type:'brand-template',payload:{primaryColor:'#1265ab',secondaryColor:'#654321',fontFamily:'AZ Sans',visualTone:'precise',restrictions:''},contentLabel:'品牌模板说明',checks:[['主色','#1265ab'],['辅助色','#654321']]},
];
function resource(spec:Spec,suffix=''):Record<string,unknown>{return {id:'resource_az_'+spec.type+suffix,type:spec.type,name:LONG+'-'+spec.type+suffix,description:'AZ 描述'+suffix,category:'AZ 分类',tags:['AZ','local'],thumbnailUrl:PNG,content:'AZ stored content '+spec.type,payload:spec.payload,enabled:false,sortOrder:3,createdAt:1,updatedAt:1};}
const TEMPLATE={id:'tpl_az_cancel',name:'AZ电商模板',icon:'📄',description:'AZ readonly cancellation',prompt_template:'AZ {SUBJECT}',negative_prompt:'low quality',aspect_ratio:'1:1',category:'product',fidelity_anchor:'',sort_order:1,is_enabled:true,is_builtin:false,created_at:1,updated_at:1};
const BASE:Readonly<Record<string,unknown>>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},'/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:'',wechatPayLink:'',alipayPayLink:''}},
 '/api/admin/users':{success:true,users:[]},'/api/admin/apis':{success:true,providers:[]},'/api/admin/groups':{success:true,groups:[]},'/api/admin/api-balance':{success:true,balances:[]},'/api/ecom-templates':{success:true,templates:[TEMPLATE]},
};
function r(body:unknown,count=1):ReadReply{return {body,count};}
function plan(resources:readonly Record<string,unknown>[]=[],confirm=false,desktop=true):NativePlan{
 const base=Object.fromEntries(Object.entries(BASE).map(([k,b])=>[k,r(b)])),extra:Record<string,ReadReply>=desktop?{
  '/api/admin/users':r({success:true,users:[]},2),'/api/admin/desktop-devices':r({success:true,devices:[]},2),'/api/admin/backups?limit=50':r({success:true,backups:[]}),'/api/admin/backups?limit=300':r({success:true,backups:[]}),
  '/api/admin/resources':r({success:true,resources},2),'/api/admin/local-generation-records?limit=50':r({success:true,records:[]}),'/api/admin/local-generation-records?limit=200':r({success:true,records:[]}),'/api/admin/desktop-update':r({success:true,config:{enabled:false,version:'AZ',packageUrl:'',publishedAt:0},files:[]},2),
 }:{};
 const listed={...base,...extra};return {kind:'resources',steps:confirm?[base,listed,listed]:[base,listed],...(confirm?{confirmCounts:[0,0,1]}:{})};
}
function btn(s:Session,name:string):Locator{return main(s).getByRole('button',{name,exact:true});}
// These are fixed literal captions. A populated textarea's label may include
// its value/description; keep the real label association and strict geometry.
function namedField(s:Session,label:string):Locator{return main(s).getByLabel(new RegExp('^'+label));}
async function nav(s:Session,desktop=true):Promise<void>{
 const open=s.page.getByRole('button',{name:'展开导航',exact:true});if(await open.isVisible())await activate(s,open);
 const item=s.page.getByRole('navigation').getByRole('button',{name:new RegExp('^'+(desktop?'本地无界':'电商模板')+'(?:\\s*\\d+)?$')});await reveal(s,item);for(const span of await item.locator('span').all())await readable(s,span,true);
 s.step=1;await activate(s,item,false);await main(s).getByRole('heading',{name:desktop?'本地无界管理':'电商模板管理',exact:true}).waitFor();await settle(s);
 if(desktop){await activate(s,btn(s,'资源中心'));await settle(s);}await quiet(s);
}
async function fill(s:Session,field:Locator,value:string):Promise<void>{await reach(s,field);const b=await field.boundingBox();if(!b)throw Error('AZ_FIELD');await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await s.page.keyboard.press('Control+A');await s.page.keyboard.press('Backspace');await s.page.keyboard.type(value);await settle(s);expect(await field.inputValue()).toBe(value);}
async function layout(s:Session):Promise<void>{
 const bad=await s.page.evaluate(():string[]=>{
  const faults:string[]=[];for(const selector of ['html','body','.dashboard-root','main.dashboard-scrollable']){const e=document.querySelector(selector);if(!e||e.scrollWidth>e.clientWidth+1)faults.push(selector);}
  for(const e of document.querySelectorAll('#av-root *')){
   if(!(e instanceof HTMLElement)||e.matches('input,select,textarea'))continue;const b=e.getBoundingClientRect(),css=getComputedStyle(e);if(!b.width||!b.height||css.display==='none')continue;
   if(e.matches('.sr-only')&&css.position==='absolute'&&e.clientWidth<=1&&e.clientHeight<=1&&css.overflow==='hidden'&&css.clip!=='auto')continue;
   const region=e.closest('[role=region][aria-label="本地无界数据表，可横向滚动"]');
   if(region&&region!==e){
    if(!/auto|scroll/.test(getComputedStyle(region).overflowX))faults.push('false-scroll-region');const cell=e.closest('td,th');
    if(cell){if(e.scrollWidth>e.clientWidth+1&&!/auto|scroll/.test(css.overflowX))faults.push('table-cell-hidden-content');const c=cell.getBoundingClientRect();
     for(const node of e.childNodes){if(node.nodeType!==Node.TEXT_NODE||!node.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const g of range.getClientRects()){
      if(g.left<c.left-1||g.right>c.right+1||g.top<c.top-1||g.bottom>c.bottom+1)faults.push('table-cell-glyph-overlap');
      for(let p:Element|null=e;p&&p!==region;p=p.parentElement){const st=getComputedStyle(p),r=p.getBoundingClientRect();if(/hidden|clip/.test(st.overflowX)&&(g.left<r.left-1||g.right>r.right+1))faults.push('inner-horizontal-clip');if(/hidden|clip/.test(st.overflowY)&&(g.top<r.top-1||g.bottom>r.bottom+1))faults.push('inner-vertical-clip');}
     }}
    }continue;
   }
   if(b.left<-.5||b.right>innerWidth+.5)faults.push('outside '+e.tagName);if(e.scrollWidth>e.clientWidth+1&&!region)faults.push('clipped '+e.tagName);
  }return faults;
 });expect(bad,'page fits; only the explicit local table window may conceal offscreen columns').toEqual([]);
}
function row(s:Session,name:string):Locator{return main(s).getByRole('row').filter({has:s.page.getByText(name,{exact:true})});}
async function tableReach(s:Session,control:Locator):Promise<void>{
 expect(await control.count(),'one exact real table control before native traversal').toBe(1);
 await reveal(s,control);
 for(let step=0;step<3;step++){
  const move=await control.evaluate((e:Element):{delta:number;x:number;y:number}=>{
   const region=e.closest('[role=region][aria-label="本地无界数据表，可横向滚动"]');if(!(region instanceof HTMLElement)||!/auto|scroll/.test(getComputedStyle(region).overflowX))throw Error('AZ_REAL_TABLE_SCROLLER');
   const r=region.getBoundingClientRect(),b=e.getBoundingClientRect(),left=Math.max(0,r.left+region.clientLeft),right=Math.min(innerWidth,left+region.clientWidth),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
   const delta=b.left<left+2?b.left-left-8:b.right>right-2?b.right-right+8:0;return {delta,x:(left+right)/2,y:Math.max(top+2,Math.min(bottom-2,b.top+b.height/2))};
  });if(!move.delta)break;expect(step,'bounded native horizontal traversal').toBeLessThan(2);await s.page.mouse.move(move.x,move.y);await s.page.mouse.wheel(move.delta,0);s.wheels++;await settle(s);
 }await reach(s,control);
}
async function edit(s:Session,spec:Spec,suffix=''):Promise<void>{const target=row(s,LONG+'-'+spec.type+suffix).getByRole('button',{name:'编辑',exact:true});await tableReach(s,target);await activate(s,target);await settle(s);await readable(s,main(s).getByRole('heading',{name:'编辑公共资源',exact:true}));}

describe.each(MATRICES)('AZ resources $theme $width x $height',entry=>{
 for(const spec of SPECS)it('loads saved '+spec.type+' resource values in actual editable controls',async():Promise<void>=>{
  await withSession(entry,plan([resource(spec)]),async s=>{
   await nav(s);await edit(s,spec);expect(await main(s).getByRole('combobox',{name:/^资源类型/}).inputValue()).toBe(spec.type);
   for(const [label,want] of [['资源名称',LONG+'-'+spec.type],['描述','AZ 描述'],['分类','AZ 分类'],['标签，逗号分隔','AZ, local'],[spec.contentLabel,'AZ stored content '+spec.type]] as const){const field=namedField(s,label);await reach(s,field);expect(await field.inputValue()).toBe(want);}
   const json=namedField(s,'高级 JSON 参数');await reach(s,json);expect(JSON.parse(await json.inputValue())).toEqual(spec.payload);
   for(const [label,want] of spec.checks){const field=main(s).getByLabel(label,{exact:true});await reach(s,field);expect(await field.inputValue(),label+' displays the stored value, not blank/default/stale state').toBe(want);}
   if(spec.type==='agent-template'){const tools=main(s).getByLabel('默认工具，逗号分隔',{exact:true});await fill(s,tools,'analyze_image, image_edit, generate_image');expect(JSON.parse(await json.inputValue()).tools).toEqual(['analyze_image','image_edit','generate_image']);await fill(s,tools,'analyze_image, image_edit, ');await edit(s,spec);expect(await tools.inputValue(),'reopening restores the exact saved tools, not an unfinished local delimiter').toBe('analyze_image, image_edit');await activate(s,btn(s,'清空'));await fill(s,tools,', ');await activate(s,btn(s,'清空'));expect(await tools.inputValue(),'clearing a new Agent discards an unfinished empty delimiter').toBe('');await edit(s,spec);}
   expect(await main(s).getByLabel('启用资源',{exact:true}).isChecked()).toBe(false);await layout(s);await quiet(s);
  });
 },25000);
 it('valid advanced JSON and typed fields stay synchronized across clear and reopen without saving',async():Promise<void>=>{
  const spec=SPECS[3];await withSession(entry,plan([resource(spec)]),async s=>{
   await nav(s);await edit(s,spec);await fill(s,namedField(s,'高级 JSON 参数'),'{"id":"AZ-local-draft","aspectRatio":"4:3"}');
   const id=main(s).getByLabel('模板 ID',{exact:true}),ratio=main(s).getByLabel('画面比例',{exact:true});expect(await id.inputValue()).toBe('AZ-local-draft');expect(await ratio.inputValue()).toBe('4:3');
   await fill(s,ratio,'16:9');expect(JSON.parse(await namedField(s,'高级 JSON 参数').inputValue())).toEqual({id:'AZ-local-draft',aspectRatio:'16:9'});
   await activate(s,btn(s,'清空'));expect(await id.inputValue()).toBe('');expect(await ratio.inputValue()).toBe('1:1');await edit(s,spec);expect(await id.inputValue()).toBe('AZ-existing-ecom');expect(await ratio.inputValue()).toBe('9:16');await quiet(s);
  });
 },25000);
 it('searching and clearing a local resource query leaves existing drafts and server records separate',async():Promise<void>=>{
  const spec=SPECS[0];await withSession(entry,plan([resource(spec)]),async s=>{
   await nav(s);await fill(s,main(s).getByPlaceholder('搜索资源'),'AZ-no-match');expect(await main(s).getByText('暂无公共资源',{exact:true}).count()).toBe(1);
   await fill(s,main(s).getByPlaceholder('搜索资源'),'');await edit(s,spec);await fill(s,main(s).getByLabel('资源名称',{exact:true}),'AZ unsaved draft');await activate(s,btn(s,'清空'));expect(await main(s).getByLabel('资源名称',{exact:true}).inputValue()).toBe('');
   await edit(s,spec);expect(await main(s).getByLabel('资源名称',{exact:true}).inputValue()).toBe(LONG+'-prompt-template');await quiet(s);
  });
 },25000);
 it('resource cancel and escape restore focus to the actual deletion origin without a write',async():Promise<void>=>{
  const spec=SPECS[0];await withSession(entry,plan([resource(spec)]),async s=>{
   await nav(s);const origin=row(s,LONG+'-prompt-template').getByRole('button',{name:'删除',exact:true});
   for(const mode of ['cancel','escape']){await tableReach(s,origin);await activate(s,origin);const dialog=s.page.getByRole('alertdialog',{name:'确认删除',exact:true});await dialog.waitFor();await readable(s,dialog.getByText('删除后公共资源将无法恢复。',{exact:true}));await reach(s,dialog.getByRole('button',{name:'删除',exact:true}));
    if(mode==='cancel')await activate(s,dialog.getByRole('button',{name:'取消',exact:true}));else await s.page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await settle(s);expect(await origin.evaluate(e=>e===document.activeElement),'actual original row target owns returned focus').toBe(true);
   }await quiet(s);
  });
 },25000);
 it('ecommerce native deletion confirmation is dismissed and preserves the existing template',async():Promise<void>=>{
  await withSession(entry,plan([],true,false),async s=>{
   await nav(s,false);s.step=2;await activate(s,main(s).getByTitle('删除',{exact:true}));await settle(s);expect(s.nativeConfirmCount).toBe(1);await readable(s,main(s).getByText('AZ电商模板',{exact:true}));expect(await main(s).getByTitle('编辑',{exact:true}).count()).toBe(1);await quiet(s);
  });
 },25000);
});

for(const kind of ['wrong-message','extra-confirm'] as const)it('native confirmation boundary rejects '+kind+' through actual cleanup',async():Promise<void>=>{
 let held:Session|undefined,caught:unknown,rejected=false;
 try{await withSession({theme:'gold',width:320,height:640},plan([],true,false),async s=>{
  held=s;s.step=2;
  if(kind==='extra-confirm')await s.page.evaluate(():void=>{confirm('确定删除此模板？');});
  await s.page.evaluate((message:string):void=>{confirm(message);},kind==='wrong-message'?'AZ unapproved message':'确定删除此模板？');
  await expect.poll(()=>s.faults.includes('AV_UNEXPECTED_DIALOG')).toBe(true);expect(s.nativeConfirmCount).toBe(kind==='extra-confirm'?1:0);try{await quiet(s);}catch{rejected=true;}expect(rejected).toBe(true);
 });}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(AggregateError);expect(String(caught)).toContain('AV_DISPOSAL');expect(held?.pageClosed&&held.contextClosed&&held.page.isClosed()).toBe(true);
},25000);
