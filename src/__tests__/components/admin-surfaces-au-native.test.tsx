// @vitest-environment node
// AU reuses the unchanged AT real-Dashboard host. All plans are GET-only;
// local draft/cancel actions cannot mutate a server, storage or production DB.
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import {MATRIX,withSession,withGeometryCalibration,main,activate,reach,readable,reveal,settle,quiet,ui,capture,geometry,type Session,type ReadReply,type NativePlan} from '../helpers/gateway-at-native-fixture';

const LONG='AU合成名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jivsAAAAASUVORK5CYII=';
const USER='au-user';
const AU_MATRIX=[...MATRIX,{theme:'gold',width:390,height:844},{theme:'mono',width:390,height:844}] as const;
const BACKUP={id:'au-backup',userId:USER,category:'image',filename:'au.png',originalFilename:LONG+'.png',contentType:'image/png',size:1024,createdAt:1,updatedAt:1,metadata:{}};
const TEMPLATE={id:'au-template',name:LONG,icon:'📄',description:LONG,prompt_template:'AU {SUBJECT}',negative_prompt:'low quality',aspect_ratio:'16:9',category:'product',fidelity_anchor:'',sort_order:1,is_enabled:true};
const RECORD={id:'au-image',url:IMAGE,prompt:LONG,model:LONG,quality:'standard',aspectRatio:'1:1',createdAt:1,projectId:'au-project',projectName:LONG,originalWidth:1,originalHeight:1,source:'generated',apiProvider:LONG,userId:USER,userName:LONG};
const STATS={totalUsers:1,filteredUsers:1,totalImages:1,generated:1,uploaded:0,edited:0,userStats:[{userId:USER,userName:LONG,totalImages:1,generated:1,uploaded:0,edited:0,projectCount:1}]};
const BASE:Readonly<Record<string,unknown>>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},
 '/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:'',wechatPayLink:'',alipayPayLink:''}},
 '/api/admin/users':{success:true,users:[]},'/api/admin/apis':{success:true,providers:[]},'/api/admin/groups':{success:true,groups:[]},'/api/admin/api-balance':{success:true,balances:[]},
 '/api/ecom-templates':{success:true,templates:[TEMPLATE]},
};
function plan(extra:Record<string,ReadReply>={},overrides:Record<string,unknown>={}):NativePlan{
 const first=Object.fromEntries(Object.entries({...BASE,...overrides}).map(([p,body])=>[p,{count:1,body}]));
 return {kind:'gateway',steps:[first,{...first,...extra}]};
}
function read(body:unknown,count=1):ReadReply{return {count,body};}
function desktopPlan():NativePlan{return plan({
 '/api/admin/users':read({success:true,users:[]},2),
 '/api/admin/desktop-devices':read({success:true,devices:[{id:'au-device',device_id:LONG,last_seen_at:1}]},2),
 '/api/admin/backups?limit=50':read({success:true,backups:[BACKUP]}),
 '/api/admin/backups?limit=300':read({success:true,backups:[BACKUP]}),
 '/api/admin/resources':read({success:true,resources:[]},2),
 '/api/admin/local-generation-records?limit=50':read({success:true,records:[]}),
 '/api/admin/local-generation-records?limit=200':read({success:true,records:[]}),
 '/api/admin/desktop-update':read({success:true,config:{enabled:false,version:'AU',packageUrl:'',publishedAt:0},files:[]},2),
 });}
async function nav(s:Session,label:string,heading:string):Promise<void>{
 const opener=s.page.getByRole('button',{name:'展开导航',exact:true});if(await opener.isVisible())await activate(s,opener);
 const target=s.page.getByRole('navigation').getByRole('button',{name:new RegExp('^'+label+'(?:\\s*\\d+)?$')});await reveal(s,target);
 // Label and count intentionally use different font sizes. Check each actual
 // text fragment on one line, then keep the full 44px/five-hit target check.
 for(const fragment of await target.locator('span').all())await readable(s,fragment,true);
 s.step=1;await activate(s,target,false);
 await main(s).getByRole('heading',{name:heading,exact:true}).waitFor();await settle(s);await quiet(s);
}
function btn(s:Session,name:string):Locator{return main(s).getByRole('button',{name,exact:true});}
async function fill(s:Session,el:Locator,value:string):Promise<void>{
 await reach(s,el);const b=await el.boundingBox();if(!b)throw Error('AU_FIELD_BOX');
 await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await s.page.keyboard.press('Control+A');
 await s.page.keyboard.type(value);await settle(s);expect(await el.inputValue()).toBe(value);
}
async function choose(s:Session,el:Locator,index:number):Promise<void>{
 await reach(s,el);const b=await el.boundingBox();if(!b)throw Error('AU_SELECT_BOX');
 await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await s.page.keyboard.press('Home');
 for(let i=0;i<index;i++)await s.page.keyboard.press('ArrowDown');
 await s.page.keyboard.press('Enter');await settle(s);
}
async function layout(s:Pick<Session,'page'>):Promise<void>{
 // Local wide data tables are permitted only inside an explicitly labelled,
 // bounded native horizontal scroller. All other clipping stays a failure.
 const bad=await s.page.evaluate(():string[]=>{
  const faults:string[]=[];
  for(const selector of ['html','body','.dashboard-root','main.dashboard-scrollable']){
   const e=document.querySelector(selector);if(!e||e.scrollWidth>e.clientWidth+1)faults.push(selector);
  }
  for(const e of document.querySelectorAll('#at-root *')){
   if(!(e instanceof HTMLElement)||e.matches('input,select,textarea'))continue;
   const b=e.getBoundingClientRect(),css=getComputedStyle(e);if(!b.width||!b.height||css.display==='none')continue;
   if(e.matches('.sr-only')&&css.position==='absolute'&&e.clientWidth<=1&&e.clientHeight<=1&&css.overflow==='hidden'&&css.clip!=='auto')continue;
   const region=e.closest('[role=region][aria-label="本地无界数据表，可横向滚动"],[role=region][aria-label="用户数据表，可横向滚动"]');
   if(region&&region!==e){
    const style=getComputedStyle(region);if(!/auto|scroll/.test(style.overflowX))faults.push('false-scroll-region');
    // Only clipping at the named outer scroller is legitimate. Inspect each
    // text node against its cell and every inner clipping ancestor even when
    // that cell currently lies beyond the viewport's horizontal window.
    const cell=e.closest('td,th');
    if(cell){
     if(e.scrollWidth>e.clientWidth+1&&!/auto|scroll/.test(css.overflowX))faults.push('table-cell-hidden-content '+e.tagName);
     const cellBox=cell.getBoundingClientRect();
     for(const node of e.childNodes){
      if(node.nodeType!==Node.TEXT_NODE||!node.textContent?.trim())continue;
      const range=document.createRange();range.selectNodeContents(node);
      for(const glyph of range.getClientRects()){
       if(glyph.left<cellBox.left-1||glyph.right>cellBox.right+1||glyph.top<cellBox.top-1||glyph.bottom>cellBox.bottom+1)faults.push('table-cell-glyph-overlap');
       for(let clip:Element|null=e;clip&&clip!==region;clip=clip.parentElement){
        const c=getComputedStyle(clip),r=clip.getBoundingClientRect();
        if(/hidden|clip/.test(c.overflowX)&&(glyph.left<r.left-1||glyph.right>r.right+1))faults.push('table-inner-horizontal-clip');
        if(/hidden|clip/.test(c.overflowY)&&(glyph.top<r.top-1||glyph.bottom>r.bottom+1))faults.push('table-inner-vertical-clip');
       }
      }
     }
    }
    continue;
   }
   if(b.left<-.5||b.right>innerWidth+.5)faults.push('outside '+e.tagName+' '+e.className);
   if(e.scrollWidth>e.clientWidth+1&&!region)faults.push('clipped '+e.tagName+' '+e.className);
  }
  return faults;
 });expect(bad,'AU no page overflow or concealed glyphs; only named local tables may scroll').toEqual([]);
}
async function tableEnd(s:Session,region:Locator):Promise<void>{
 await reveal(s,region);const b=await region.boundingBox();if(!b)throw Error('AU_TABLE_BOX');
 const before=await region.evaluate(e=>e.scrollLeft);
 await s.page.mouse.move(b.x+b.width/2,Math.max(2,Math.min(s.page.viewportSize()!.height-2,b.y+b.height/2)));
 await s.page.mouse.wheel(2000,0);await settle(s);
 expect(await region.evaluate(e=>e.scrollLeft),'native horizontal wheel traverses local table').toBeGreaterThan(before);
}
async function tableLabel(s:Session,region:Locator,label:Locator,text:string):Promise<void>{
 // A legitimate local-table cell can be wider than the viewport. Prove its
 // complete glyphs are not internally clipped (layout) and expose both ends
 // using actual horizontal wheel input, not an impossible whole-box fit.
 expect(await label.textContent()).toBe(text);await reveal(s,label);await layout(s);
 for(const end of [false,true]){
  for(let step=0;step<3;step++){
   const sample=await label.evaluate((element:Element,last:boolean):{delta:number;x:number;y:number;inside:boolean}=>{
    const region=element.closest('[role=region]'),node=element.firstChild;
    if(!(region instanceof HTMLElement)||!node||node.nodeType!==Node.TEXT_NODE||!node.textContent)throw Error('AU_TABLE_TEXT_NODE');
    const length=node.textContent.length,range=document.createRange();
    range.setStart(node,last?Math.max(0,length-6):0);range.setEnd(node,last?length:Math.min(6,length));
    const glyph=range.getBoundingClientRect(),box=region.getBoundingClientRect(),left=box.left+region.clientLeft,right=left+region.clientWidth;
    const delta=glyph.left<left+2?glyph.left-left-8:glyph.right>right-2?glyph.right-right+8:0;
    return {delta,x:(left+right)/2,y:Math.max(box.top+2,Math.min(box.bottom-2,(glyph.top+glyph.bottom)/2)),inside:glyph.left>=left-.5&&glyph.right<=right+.5&&glyph.top>=0&&glyph.bottom<=innerHeight};
   },end);
   if(!sample.delta){expect(sample.inside,'actual first/last text glyph ranges exposed by native table scrolling').toBe(true);break;}
   expect(step,'bounded native glyph exposure completes').toBeLessThan(2);
   await s.page.mouse.move(sample.x,sample.y);await s.page.mouse.wheel(sample.delta,0);await settle(s);
  }
 }
 await layout(s);
}

describe.each(AU_MATRIX)('AU remaining admin $theme $width x $height',entry=>{
 it('desktop update fields and publication controls are usable without submitting',async():Promise<void>=>{
  // Catches shrunken header, tiny section/submit controls and 40px inputs.
  await withSession(entry,desktopPlan(),async s=>{
   await nav(s,'本地无界','本地无界管理');await readable(s,main(s).getByText(LONG,{exact:true}));
   await activate(s,btn(s,'桌面更新'));await readable(s,main(s).getByRole('heading',{name:'发布更新',exact:true}));
   await fill(s,main(s).getByPlaceholder('例如 3.0.1'),'AU draft');
   await reach(s,btn(s,'保存发布'));await reach(s,main(s).getByLabel('更新说明',{exact:true}));
   const label=main(s).getByLabel('启用更新提示',{exact:true}).locator('..');await readable(s,label,true);
   expect((await geometry(label)).rect.height).toBeGreaterThanOrEqual(44);
   await layout(s);await quiet(s);
  });
 },25000);
 it('desktop resource fields reflow across every resource type and reset drafts',async():Promise<void>=>{
  // Catches desktop-only fixed search width/header and lost type-specific inputs.
  await withSession(entry,desktopPlan(),async s=>{
   await nav(s,'本地无界','本地无界管理');await activate(s,btn(s,'资源中心'));
   const type=main(s).getByLabel('资源类型',{exact:true});const values=await type.locator('option').evaluateAll(es=>es.map(e=>(e as HTMLOptionElement).value));
   for(let i=0;i<values.length;i++){
    await choose(s,type,i);expect(await type.inputValue()).toBe(values[i]);
    await reach(s,main(s).getByLabel('资源名称',{exact:true}));await reach(s,main(s).getByLabel('高级 JSON 参数',{exact:true}));await layout(s);
   }
   await fill(s,main(s).getByLabel('资源名称',{exact:true}),'AU unsaved');await activate(s,btn(s,'清空'));
   expect(await main(s).getByLabel('资源名称',{exact:true}).inputValue()).toBe('');await reach(s,btn(s,'保存资源'));
   await reach(s,main(s).getByPlaceholder('搜索资源'));await quiet(s);
  });
 },25000);
 it('desktop backup table scrolls locally and deletion cancels; connection and record views remain reachable',async():Promise<void>=>{
  // Catches hidden table actions and confirm-cancel accidentally deleting a backup.
  await withSession(entry,desktopPlan(),async s=>{
   await nav(s,'本地无界','本地无界管理');await activate(s,btn(s,'云端备份'));
   const region=main(s).getByRole('region',{name:'本地无界数据表，可横向滚动',exact:true});await tableLabel(s,region,region.getByText(LONG+'.png',{exact:true}),LONG+'.png');await tableEnd(s,region);
   await activate(s,region.getByRole('button',{name:'删除',exact:true}));
   const dialog=s.page.getByRole('alertdialog',{name:'确认删除',exact:true});await dialog.waitFor();
   await readable(s,dialog.getByText('删除后云端备份将无法恢复。',{exact:true}));await reach(s,dialog.getByRole('button',{name:'删除',exact:true}));
   await activate(s,dialog.getByRole('button',{name:'取消',exact:true}));await dialog.waitFor({state:'hidden'});await quiet(s);
   await activate(s,btn(s,'连接信息'));await activate(s,btn(s,'复制'));expect((await ui(s)).clipboardWrites[0]).toContain('https://admin-secondary-at-fixture.invalid');
   await activate(s,btn(s,'生成记录'));await reach(s,main(s).getByPlaceholder('搜索提示词、模型、用户或设备'));await layout(s);
  });
 },25000);
 it('data overview and user table preserve readable identities and reachable view controls',async():Promise<void>=>{
  // Catches squeezed headings/nav, tiny overview link and inaccessible table action.
  await withSession(entry,plan({'/api/admin/user-images?page=1&pageSize=24':read({images:[RECORD],total:1,stats:STATS})}),async s=>{
   await nav(s,'数据管理','数据管理');await reach(s,btn(s,'查看全部 →'));await layout(s);
   await activate(s,btn(s,'用户数据'));const region=main(s).getByRole('region',{name:'用户数据表，可横向滚动',exact:true});await tableLabel(s,region,region.getByText(LONG,{exact:true}),LONG);
   await tableEnd(s,region);await reach(s,region.getByRole('button',{name:'查看内容',exact:true}));await layout(s);await quiet(s);
  });
 },25000);
 it('data gallery layout and image detail close without clipping long metadata',async():Promise<void>=>{
  // Catches unlabelled tiny view/close controls, long-metadata overflow and narrow detail columns.
  await withSession(entry,plan({'/api/admin/user-images?page=1&pageSize=24':read({images:[RECORD],total:1,stats:STATS})}),async s=>{
   await nav(s,'数据管理','数据管理');await activate(s,btn(s,'内容库'));await reach(s,main(s).getByPlaceholder('搜索提示词、模型...'));
   await activate(s,btn(s,'列表视图'));await layout(s);await activate(s,btn(s,'网格视图'));
   const tile=main(s).locator('img').filter({hasNot:s.page.locator('[aria-hidden]')}).first().locator('..').locator('..');
   await reveal(s,tile);const b=await tile.boundingBox();if(!b)throw Error('AU_IMAGE_TILE');await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await settle(s);
   const modal=s.page.getByRole('dialog',{name:'图片详情',exact:true});await modal.waitFor();
   // A declared modal must at least own entry focus; otherwise the new ARIA
   // claim conceals the existing non-modal keyboard behavior from AT users.
   expect(await modal.evaluate(e=>e.getAttribute('aria-modal')!=='true'||e.contains(document.activeElement)),'declared modal owns entry focus').toBe(true);
   await readable(s,modal.getByText(LONG,{exact:true}).first());await layout(s);await capture(s,'au-image-detail');
   await activate(s,modal.getByRole('button',{name:'关闭图片详情',exact:true}));await modal.waitFor({state:'hidden'});await quiet(s);
  });
 },25000);
 it('ecommerce list actions and new edit cancellation keep local drafts separate',async():Promise<void>=>{
  // Catches 20px icon actions, narrow two-column form and hidden/cropped long template names.
  await withSession(entry,plan(),async s=>{
   await nav(s,'电商模板','电商模板管理');await readable(s,main(s).getByText(LONG,{exact:true}).first());
   const edit=main(s).getByTitle('编辑',{exact:true});await activate(s,edit);await reach(s,main(s).getByPlaceholder('如：白底主图'));
   await fill(s,main(s).getByPlaceholder('如：白底主图'),'AU discard');await activate(s,btn(s,'取消'));
   await activate(s,edit);expect(await main(s).getByPlaceholder('如：白底主图').inputValue()).toBe(LONG);await activate(s,btn(s,'取消'));
   await activate(s,btn(s,'新增模板'));expect(await btn(s,'保存模板').isDisabled()).toBe(true);await layout(s);await capture(s,'au-ecommerce-new');await activate(s,btn(s,'取消'));
   // This branch uses native window.confirm, not the custom DOM dialog. Its
   // cancellation is deliberately not claimed through the DOM-only AT guard.
   await reach(s,main(s).getByTitle('删除',{exact:true}));await quiet(s);
  });
 },25000);
 for(const configured of [false,true])it('payment '+(configured?'configured QR previews and read-only audit':'missing configuration')+' fit without payment or save',async():Promise<void>=>{
  // Catches squeezed payment header, 36px input/file targets, and crowded audit row.
  const overrides=configured?{
   '/api/credits/payment-status':{success:true,status:{wechat:true,alipay:true},canRecharge:true,methods:['wechat','alipay']},
   '/api/credits/payment-config':{success:true,config:{wechatQrUrl:IMAGE,alipayQrUrl:IMAGE,wechatPayLink:'',alipayPayLink:''}},
  }:{};
  const orders=configured?[{id:'au-order',userId:LONG,amount:100,priceCny:1,paymentMethod:'wechat',status:'paid',createdAt:1}]:[];
  await withSession(entry,plan({'/api/credits?action=audit-orders':read({success:true,orders})},overrides),async s=>{
   await nav(s,'支付配置','人工收款审核');await layout(s);
   const field=main(s).getByPlaceholder('wxp://xxxxx 微信收款链接，用户点击后直接跳转付款');await fill(s,field,'AU draft only');
   await reach(s,btn(s,'保存收款码配置'));for(const file of await main(s).locator('input[type=file]').all())await reach(s,file);
   if(configured){expect(await main(s).getByAltText('微信收款码预览').count()).toBe(1);expect(await main(s).getByAltText('支付宝收款码预览').count()).toBe(1);await readable(s,main(s).getByText('最近订单 (1)',{exact:true}));}
   await layout(s);await quiet(s);await capture(s,configured?'payment-configured':'payment-missing');
  });
 },25000);
});

it('review table calibration rejects internal cell clipping but permits a genuine local wide table',async():Promise<void>=>{
 await withGeometryCalibration({theme:'gold',width:320,height:640},async page=>{
  const markup=(clipped:boolean):string=>`<!doctype html><style>body{margin:0}</style><div id="at-root"><div class="dashboard-root"><main class="dashboard-scrollable"><div role="region" aria-label="用户数据表，可横向滚动" style="width:200px;overflow-x:auto"><table style="width:760px;table-layout:fixed"><tbody><tr><td><div style="${clipped?'width:20px;white-space:nowrap;overflow:hidden':''}">Visible identity in wide table</div></td><td>Last column</td></tr></tbody></table></div></main></div></div>`;
  await page.setContent(markup(false));await layout({page});
  await page.setContent(markup(true));await expect(layout({page}),'named scroller never exempts clipped cell prose').rejects.toThrow();
 });
},25000);

async function pointer(s:Session,control:Locator):Promise<void>{
 // Desktop pointer regression keeps its existing density; the strict44/16
 // mobile checks above remain unchanged. No force-click or DOM scrolling.
 await readable(s,control,false);const g=await geometry(control);expect(g.fiveHits).toBe(true);
 expect(g.rect.width).toBeGreaterThan(0);expect(g.rect.height).toBeGreaterThan(0);
 await s.page.mouse.click(g.rect.x+g.rect.width/2,g.rect.y+g.rect.height/2);await settle(s);
}
async function desktopFrame(s:Session):Promise<void>{
 const width=await main(s).evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));expect(width.scroll).toBeLessThanOrEqual(width.client+1);
 await readable(s,main(s).getByRole('heading',{level:1}),true);await quiet(s);
}
describe.each([{theme:'gold',width:1280,height:900},{theme:'mono',width:1280,height:900}] as const)('AU desktop regression $theme',entry=>{
 it('desktop local management keeps sections update form and resource form usable',async():Promise<void>=>{
  await withSession(entry,desktopPlan(),async s=>{
   await nav(s,'本地无界','本地无界管理');await pointer(s,btn(s,'桌面更新'));await pointer(s,main(s).getByPlaceholder('例如 3.0.1'));
   await s.page.keyboard.press('Control+A');await s.page.keyboard.type('AU desktop draft');expect(await main(s).getByPlaceholder('例如 3.0.1').inputValue()).toBe('AU desktop draft');
   await readable(s,btn(s,'保存发布'),true);await pointer(s,btn(s,'资源中心'));await readable(s,main(s).getByLabel('资源名称',{exact:true}));await readable(s,btn(s,'保存资源'),true);await desktopFrame(s);
  });
 },25000);
 it('desktop data gallery opens reads and closes the actual detail view',async():Promise<void>=>{
  await withSession(entry,plan({'/api/admin/user-images?page=1&pageSize=24':read({images:[RECORD],total:1,stats:STATS})}),async s=>{
   await nav(s,'数据管理','数据管理');await pointer(s,btn(s,'内容库'));
   // Desktop keeps the established ellipsized thumbnail summary. Check the
   // card's real visible hit area, then read the full metadata in its detail.
   const tile=main(s).locator('img').first().locator('..').locator('..');await reveal(s,tile);const g=await geometry(tile);expect(g.clear).toBe(true);expect(g.fiveHits).toBe(true);await s.page.mouse.click(g.rect.x+g.rect.width/2,g.rect.y+g.rect.height/2);await settle(s);
   const dialog=s.page.getByRole('dialog',{name:'图片详情',exact:true});await dialog.waitFor();
   await readable(s,dialog.getByText(LONG,{exact:true}).first());await pointer(s,dialog.getByRole('button',{name:'关闭图片详情',exact:true}));await dialog.waitFor({state:'hidden'});await desktopFrame(s);
  });
 },25000);
 it('desktop ecommerce editor preserves existing fields and draft cancellation',async():Promise<void>=>{
  await withSession(entry,plan(),async s=>{
   await nav(s,'电商模板','电商模板管理');await pointer(s,main(s).getByTitle('编辑',{exact:true}));const field=main(s).getByPlaceholder('如：白底主图');expect(await field.inputValue()).toBe(LONG);await pointer(s,field);
   await s.page.keyboard.press('Control+A');await s.page.keyboard.type('AU desktop discard');await pointer(s,btn(s,'取消'));await pointer(s,main(s).getByTitle('编辑',{exact:true}));expect(await field.inputValue()).toBe(LONG);await pointer(s,btn(s,'取消'));await desktopFrame(s);
  });
 },25000);
 it('desktop payment configuration keeps both read-only QR previews and save control visible',async():Promise<void>=>{
  await withSession(entry,plan({'/api/credits?action=audit-orders':read({success:true,orders:[]})},{'/api/credits/payment-status':{success:true,status:{wechat:true,alipay:true},canRecharge:true,methods:['wechat','alipay']},'/api/credits/payment-config':{success:true,config:{wechatQrUrl:IMAGE,alipayQrUrl:IMAGE,wechatPayLink:'',alipayPayLink:''}}}),async s=>{
   await nav(s,'支付配置','人工收款审核');await readable(s,main(s).getByAltText('微信收款码预览'));await readable(s,main(s).getByAltText('支付宝收款码预览'));
   await readable(s,btn(s,'保存收款码配置'),true);await desktopFrame(s);
  });
 },25000);
});
