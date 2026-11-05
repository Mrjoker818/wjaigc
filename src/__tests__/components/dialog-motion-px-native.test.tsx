// @vitest-environment node
// Actual Dashboard/DataManager and shipped dialog CSS, via the original AV boundary.
import { expect, it } from 'vitest';
import {
  activate, capture, geometry, main, quiet, reveal, settle, withSession,
  type NativePlan, type ReadReply, type Session,
} from '../helpers/data-manager-av-native-fixture';

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jivsAAAAASUVORK5CYII=';
const QUERY='/api/admin/user-images?page=1&pageSize=24';
const BASE:Readonly<Record<string,unknown>>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},
 '/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:''}},
 '/api/admin/users':{success:true,users:[]},'/api/admin/apis':{success:true,providers:[]},
 '/api/admin/groups':{success:true,groups:[]},'/api/admin/api-balance':{success:true,balances:[]},'/api/ecom-templates':{success:true,templates:[]},
};
function plan():NativePlan{
 const base:Record<string,ReadReply>=Object.fromEntries(Object.entries(BASE).map(([url,body])=>[url,{count:1,body}]));
 const image={id:'px-image',url:PNG,prompt:'PX motion image',model:'PX model',quality:'standard',aspectRatio:'1:1',createdAt:1,projectId:'px-project',projectName:'PX project',originalWidth:1,originalHeight:1,source:'generated',apiProvider:'PX provider',userId:'px-user',userName:'PX user'};
 const body={images:[image],total:1,page:1,pageSize:24,stats:{totalUsers:1,filteredUsers:1,totalImages:1,generated:1,uploaded:0,edited:0,userStats:[{userId:'px-user',userName:'PX user',totalImages:1,generated:1,uploaded:0,edited:0,projectCount:1}]}};
 return{kind:'data',steps:[base,{...base,[QUERY]:{count:1,body}}]};
}
async function library(s:Session):Promise<void>{
 const open=s.page.getByRole('button',{name:'展开导航',exact:true});if(await open.isVisible())await activate(s,open);
 const data=s.page.getByRole('navigation').getByRole('button',{name:'数据管理',exact:true});
 await reveal(s,data);s.step=1;await activate(s,data);
 await main(s).getByRole('heading',{name:'数据管理',exact:true}).waitFor();await settle(s);
 await activate(s,main(s).getByRole('button',{name:'内容库',exact:true}));
}
for(const theme of ['gold','mono'] as const)for(const preference of ['reduce','no-preference'] as const){
 it('PX '+theme+' '+preference+' actual image detail respects motion preference and restores focus',async():Promise<void>=>{
  let bodyComplete=false;
  await withSession({theme,width:390,height:844},plan(),async s=>{
   await library(s);
   const origin=main(s).getByAltText('PX motion image',{exact:true}).locator('..').locator('..');
   await reveal(s,origin);const card=await geometry(origin);expect(card.clear&&card.fiveHits,'public image card is reachable').toBe(true);
   await s.page.emulateMedia({reducedMotion:preference});
   await s.page.mouse.click(card.rect.x+card.rect.width/2,card.rect.y+card.rect.height/2);
   const dialog=s.page.getByRole('dialog',{name:'图片详情',exact:true});await dialog.waitFor({state:'visible'});
   // Pure reads before reveal/settle. This is the first sample, not a paint-frame claim.
   const motion=await dialog.evaluate(el=>{
    const overlay=document.querySelector('[data-slot="dialog-overlay"]');if(!overlay)throw Error('PX_REAL_OVERLAY_REQUIRED');
    const read=(element:Element):Record<string,string>=>{const style=getComputedStyle(element);return{animationName:style.animationName,animationDuration:style.animationDuration,transitionProperty:style.transitionProperty,transitionDuration:style.transitionDuration,opacity:style.opacity,transform:style.transform,scale:style.scale};};
    return{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,dialog:read(el),overlay:read(overlay)};
   });
   console.log('PX_DIALOG_MOTION_READ',JSON.stringify({theme,preference,motion,readBeforeReveal:true}));
   expect(motion.reduced).toBe(preference==='reduce');
   if(preference==='reduce'){
    expect(motion.dialog.animationName,'reduced detail has no entry/exit animation').toBe('none');
    expect(motion.overlay.animationName,'reduced overlay has no entry/exit animation').toBe('none');
    for(const style of [motion.dialog,motion.overlay]){
     expect(style.transitionProperty,'reduced dialog surface has no transition').toBe('none');
     expect(style.transitionDuration.split(',').every(value=>parseFloat(value)===0),'reduced transition duration is zero').toBe(true);
    }
    expect(motion.dialog.opacity).toBe('1');expect(motion.overlay.opacity).toBe('1');
   }else{
    expect(motion.dialog.animationName,'ordinary detail still animates').not.toBe('none');
    expect(motion.overlay.animationName,'ordinary overlay still animates').not.toBe('none');
    expect(parseFloat(motion.dialog.animationDuration)).toBeGreaterThan(0);
    expect(parseFloat(motion.overlay.animationDuration)).toBeGreaterThan(0);
    const animations=await dialog.evaluateHandle(el=>{
     const overlay=document.querySelector('[data-slot="dialog-overlay"]');if(!overlay)throw Error('PX_NORMAL_OVERLAY_REQUIRED');
     return{dialog:el.getAnimations(),overlay:overlay.getAnimations()};
    });
    try{
     const completion=await animations.evaluate(async captured=>{
      if(!captured.dialog.length||!captured.overlay.length)throw Error('PX_NONEMPTY_ANIMATIONS_REQUIRED');
      const owned=[...captured.dialog,...captured.overlay];let timer:number|undefined;
      try{
       await Promise.race([Promise.all(owned.map(animation=>animation.finished)),new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>reject(Error('PX_ANIMATION_COMPLETION_TIMEOUT')),1500);})]);
       return{dialogCount:captured.dialog.length,overlayCount:captured.overlay.length,states:owned.map(animation=>animation.playState)};
      }finally{if(timer!==undefined)window.clearTimeout(timer);}
     });
     expect(completion.dialogCount).toBeGreaterThan(0);expect(completion.overlayCount).toBeGreaterThan(0);
     expect(completion.states.every(state=>state==='finished'),'captured animations finish without cancellation').toBe(true);
    }finally{await animations.dispose();}
   }
   const close=dialog.getByRole('button',{name:'关闭图片详情',exact:true});
   const shape=await geometry(close);
   expect(shape.rect.width,'real close target retains 44px width').toBeGreaterThanOrEqual(44);
   expect(shape.rect.height,'real close target retains 44px height').toBeGreaterThanOrEqual(44);
   expect(shape.clear&&shape.fiveHits&&shape.iconsFit,'actual close geometry is visible and usable').toBe(true);
   expect(await close.evaluate(el=>document.activeElement===el),'opening detail owns native focus').toBe(true);
   await capture(s,'px-'+preference+'-dialog');
   await s.page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await settle(s);
   expect(await origin.evaluate(el=>document.activeElement===el),'Escape restores the actual originating card').toBe(true);
   await quiet(s);
   console.log('PX_DIALOG_MOTION_COMPLETE',JSON.stringify({theme,preference,motion,rect:shape.rect,focusRestored:true,closeWithNativeEscape:true,physicalAndroid:false,softKeyboardAccepted:false,ordinaryMotionPreserved:preference==='no-preference'}));
   bodyComplete=true;
  });
  expect(bodyComplete,'all dialog motion and disposal assertions complete').toBe(true);
 },25000);
}

