// @vitest-environment node
// Native viewport/draft evidence only: no real authentication, provider calls,
// persistence, parent-entry acceptance, physical touch or soft keyboard claim.
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import {
  MATRIX,PROVIDER_NAME,LONG_MODEL,withSession,activate,reach,readable,geometry,
  noHorizontalOverflow,quiet,capture,type Session,type NativePlan,
} from '../helpers/legacy-model-dialog-as-native-fixture';

const plan=(kind:NativePlan['kind']):NativePlan=>({kind,steps:[{}]});
const button=(s:Session,name:string):Locator=>s.page.getByRole('button',{name,exact:true});
async function field(s:Session,locator:Locator,value:string):Promise<void>{
  await reach(s,locator);const box=await locator.boundingBox();if(!box)throw Error('AS_INPUT_BOX');
  await s.page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await s.page.keyboard.press('Control+A');await s.page.keyboard.type(value);
  expect(await locator.inputValue()).toBe(value);await quiet(s);
}
async function check(s:Session,name:string):Promise<void>{
  const input=s.page.getByRole('checkbox',{name,exact:true});
  const label=input.locator('..');await readable(s,label,true);const g=await geometry(label);
  expect(g.rect.width).toBeGreaterThanOrEqual(44);expect(g.rect.height).toBeGreaterThanOrEqual(44);expect(g.fiveHits).toBe(true);
  const before=await input.isChecked();await s.page.mouse.click(g.rect.x+g.rect.width/2,g.rect.y+g.rect.height/2);
  expect(await input.isChecked()).toBe(!before);await quiet(s);
}
async function base(s:Session):Promise<void>{
  expect(await s.page.getByRole('dialog').count()).toBe(1);
  await reach(s,button(s,'关闭模型设置'));await noHorizontalOverflow(s);await quiet(s);
}
async function edit(s:Session):Promise<void>{
  await activate(s,button(s,'编辑 '+PROVIDER_NAME));
  expect(await s.page.getByPlaceholder('请输入显示名称').inputValue()).toBe(PROVIDER_NAME);
  expect(await s.page.getByPlaceholder('输入API密钥').inputValue()).toBe('');
  expect(await button(s,'保存').isDisabled()).toBe(true);
}

for(const entry of MATRIX){
 describe(`legacy models AS ${entry.theme} ${entry.width}x${entry.height}`,()=>{
  // Catches clipped provider identity, tiny unlabelled controls, missing
  // selection feedback, inaccessible close and lost type-specific add access.
  it('list four types and 3d draft remain legible and operable',async()=>{
   await withSession(entry,plan('image'),async s=>{
    await base(s);await readable(s,s.page.getByText(PROVIDER_NAME,{exact:true}));
    for(const name of ['编辑 ','启用配置 ','删除配置 '])await reach(s,button(s,name+PROVIDER_NAME));
    for(const name of ['文本对话模型','视频模型','3D 模型','图像模型']){
     await activate(s,button(s,name));expect(await button(s,name).getAttribute('aria-pressed')).toBe('true');
     await readable(s,s.page.getByText(PROVIDER_NAME,{exact:true}));await noHorizontalOverflow(s);
    }
    await activate(s,button(s,'3D 模型'));await activate(s,button(s,'添加3D模型'));
    expect(await s.page.getByRole('region',{name:'模型能力配置'}).count()).toBe(0);
    await reach(s,s.page.getByPlaceholder('搜索或手动输入模型ID'));
    expect(await button(s,'创建').isDisabled()).toBe(true);await activate(s,button(s,'取消'));
    await activate(s,button(s,'关闭模型设置'));expect(await s.page.getByRole('heading',{name:'第三方模型调用'}).count()).toBe(0);
   });
  },25000);

  // Catches unfillable mobile fields, clipped manual IDs/removal, tiny
  // advanced controls and failure to discard an unsaved form.
  it('new image manual selection and advanced parameters cancel cleanly',async()=>{
   await withSession(entry,plan('image'),async s=>{
    await base(s);await activate(s,button(s,'添加图像模型'));
    await field(s,s.page.getByPlaceholder('请输入显示名称'),'AS unsaved local draft');
    await field(s,s.page.getByPlaceholder('https://api.example.com'),'https://never-contact-as.invalid/v1');
    await reach(s,s.page.getByPlaceholder('输入API密钥'));
    expect(await s.page.getByPlaceholder('输入API密钥').getAttribute('type')).toBe('password');
    await activate(s,button(s,'显示API密钥'));expect(await s.page.getByPlaceholder('输入API密钥').getAttribute('type')).toBe('text');
    await activate(s,button(s,'隐藏API密钥'));
    await field(s,s.page.getByPlaceholder('搜索或手动输入模型ID'),LONG_MODEL);
    await activate(s,button(s,'添加 “'+LONG_MODEL+'”'),false);
    await readable(s,s.page.getByText(LONG_MODEL,{exact:true}).first());
    await activate(s,button(s,'移除模型 '+LONG_MODEL));
    expect(await s.page.getByRole('region',{name:'模型能力配置'}).count()).toBe(0);
    await activate(s,s.page.getByRole('button',{name:/^高级参数/}));
    await activate(s,button(s,'添加参数'));
    const key=s.page.getByPlaceholder('参数名'),value=s.page.getByPlaceholder('参数值');
    await field(s,value,'unsaved-value');expect(await key.inputValue()).toMatch(/^param_/);
    await reach(s,key);await noHorizontalOverflow(s);await capture(s,'advanced-local-draft');
    await activate(s,s.page.getByRole('button',{name:/^移除参数 /}));
    expect(await key.count()).toBe(0);
    await activate(s,button(s,'添加参数'));await field(s,value,'must-discard-on-cancel');
    expect(await key.count()).toBe(1);
    expect(await button(s,'测试连接').isDisabled()).toBe(true);expect(await button(s,'创建').isDisabled()).toBe(true);
    await activate(s,button(s,'取消'));await activate(s,button(s,'添加图像模型'));
    expect(await s.page.getByPlaceholder('请输入显示名称').inputValue()).toBe('');
    expect(await s.page.getByPlaceholder('输入API密钥').inputValue()).toBe('');
    await activate(s,s.page.getByRole('button',{name:/^高级参数/}));
    expect(await s.page.getByPlaceholder('参数名').count()).toBe(0);await noHorizontalOverflow(s);
   });
  },25000);

  // Catches broken per-model draft isolation and cancellation: the draft is
  // intentionally still dirty at cancel; reopening must hydrate original 2.
  it('image capability dirty draft cancels without changing provider',async()=>{
   await withSession(entry,plan('image'),async s=>{
    await base(s);await edit(s);const section=s.page.getByRole('region',{name:'模型能力配置'});
    await activate(s,section.getByRole('button',{name:LONG_MODEL,exact:true}),false);
    const max=s.page.getByRole('spinbutton',{name:'最大生成数量',exact:true});
    expect(await max.inputValue()).toBe('2');await field(s,max,'3');
    await check(s,'支持蒙版');await noHorizontalOverflow(s);await capture(s,'image-dirty-capability');
    await activate(s,button(s,'取消'));await edit(s);
    expect(await max.inputValue()).toBe('2');expect(await s.page.getByRole('checkbox',{name:'支持蒙版',exact:true}).isChecked()).toBe(false);
    await readable(s,s.page.getByRole('button',{name:'移除模型 '+LONG_MODEL,exact:true}),false);
   });
  },25000);

  // Catches mobile shared-editor regression through the actual video consumer,
  // incorrect video hydration, or a per-model switch losing unsaved state.
  it('video duration local changes survive model switch but not cancel',async()=>{
   await withSession(entry,plan('video'),async s=>{
    await base(s);await edit(s);const section=s.page.getByRole('region',{name:'模型能力配置'});
    await activate(s,section.getByRole('button',{name:'as-video',exact:true}));
    const max=s.page.getByRole('spinbutton',{name:'最大时长（秒）',exact:true});
    expect(await max.inputValue()).toBe('10');await field(s,max,'7');
    await activate(s,section.getByRole('button',{name:LONG_MODEL,exact:true}),false);
    await activate(s,section.getByRole('button',{name:'as-video',exact:true}));expect(await max.inputValue()).toBe('7');
    await noHorizontalOverflow(s);await capture(s,'video-local-duration');
    await activate(s,button(s,'取消'));await edit(s);
    await activate(s,section.getByRole('button',{name:'as-video',exact:true}));expect(await max.inputValue()).toBe('10');
   });
  },25000);

  // Catches a chat draft rendered as an image model, lost vision feedback,
  // or Escape failing to close the existing dialog.
  it('chat vision local selection and escape preserve no configuration',async()=>{
   await withSession(entry,plan('chat'),async s=>{
    await base(s);await activate(s,button(s,'添加对话模型'));
    await field(s,s.page.getByPlaceholder('搜索或手动输入模型ID'),'as-chat');
    await activate(s,button(s,'添加 “as-chat”'));
    expect(await s.page.getByRole('spinbutton',{name:'最大生成数量',exact:true}).count()).toBe(0);
    await check(s,'支持视觉理解');expect(await s.page.getByRole('checkbox',{name:'支持视觉理解',exact:true}).isChecked()).toBe(true);
    await noHorizontalOverflow(s);await capture(s,'chat-vision-local');
    await s.page.keyboard.press('Escape');expect(await s.page.getByRole('dialog').count()).toBe(0);
   });
  },25000);
 });
}

// Guard calibration, not a product flow or real configuration mutation.
it('storage safety catches swallowed set remove and clear attempts',async()=>{
 let ledger:string[]|undefined,caught:string[]=[],cleanup:unknown;
 try{
  await withSession(MATRIX[0],plan('image'),async s=>{
   const result=await s.page.evaluate(():{ledger:string[]|undefined;caught:string[]}=>{
    const caught:string[]=[];
    for(const run of [()=>localStorage.setItem('forbidden-as','discard'),()=>localStorage.removeItem('unbounded_ai_universal_apis'),()=>localStorage.clear()]){
     try{run();}catch(error){caught.push(String(error));}
    }
    const state=(window as unknown as {asDashboard:{state:{storageFaults?:string[]}}}).asDashboard.state;
    return {ledger:state.storageFaults,caught};
   });ledger=result.ledger;caught=result.caught;
  });
 }catch(error){cleanup=error;}
 expect(caught).toHaveLength(3);
 expect(ledger).toEqual(['AS_FORBIDDEN_STORAGE_MUTATION','AS_FORBIDDEN_STORAGE_REMOVE','AS_FORBIDDEN_STORAGE_CLEAR']);
 expect(cleanup).toBeInstanceOf(AggregateError);
 const error=cleanup as AggregateError;
 expect(error.message).toBe('AS_DISPOSAL');
 expect(error.errors.map((item:unknown):string=>String(item)).join('\n')).toContain('storage mutation attempts are fatal even if caught');
},25000);
