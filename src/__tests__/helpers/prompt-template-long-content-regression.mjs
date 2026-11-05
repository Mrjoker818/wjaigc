// Portable product regression, derived from the completed LN diagnostic.
// Importing this module only defines functions/data. No application/DB import,
// browser launch, listener, filesystem write, process exit or automatic install.
// This does NOT replace release-native PG identity/approval/evidence gates.
// Uses preinstalled matching Chromium; unavailable environments must fail, not skip.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';

/**
 * @typedef {{qualified:boolean, counts:{selected:number,passed:number,failed:number}|null,
 * primary:string|null, cases:Array<{name:string,status:string,ready:boolean,flowFinished:boolean,
 * bodyError:unknown,defects:unknown[],closed:{qualified:boolean}|null}>,
 * final:{browserDisconnected:boolean,live:number,admissionPending:number,admissionErrors:unknown[],
 * admissionLateErrors:unknown[],operationsPending:number,operationErrors:unknown[],
 * operationLateErrors:unknown[],closePending:number,closeErrors:unknown[],closeLateErrors:unknown[]},
 * sourceChanged:boolean,outputDirectory:string,resultPath:string}} RegressionResult
 */
const must=(value,code)=>{if(!value)throw Error(code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** @param {string} file @returns {{path:string,bytes:number,sha256:string}} */
function pinFile(file){
 const absolute=path.resolve(file);must(fs.realpathSync(absolute)===absolute&&!fs.lstatSync(absolute).isSymbolicLink(),'LN_PHYSICAL_SOURCE');
 const bytes=fs.readFileSync(absolute);return {path:absolute,bytes:bytes.length,sha256:sha(bytes)};
}
/** @param {string} filename @param {Buffer} bytes @returns {void} */
function writeExclusive(filename,bytes){
 const fd=fs.openSync(filename,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
const matrix=[
 {w:320,h:640,theme:'gold',kind:'normal',role:'user'},
 {w:390,h:844,theme:'mono',kind:'failure',role:'admin'},
 {w:844,h:390,theme:'gold',kind:'failure',role:'user'},
 {w:1280,h:800,theme:'mono',kind:'normal',role:'admin'},
];
const scope={httpCaps:{'GET / document':1,'GET /fixture/a.png image':1,'GET /fixture/b.png image':1}};
const fixtureMedia={"a":{"base64":"iVBORw0KGgoAAAANSUhEUgAAAEgAAAAwCAYAAACynDzrAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAoElEQVRoge3YwRHCMADEwFRCsSoxDR0VwAOGMY99pAGNTrF9Pbrnu18yuMC53woCUADtm5UwKIDGoH73JzaxABqDMrGdOtBqUACNQZnYNKj/fHYR6QAagzKxaVDngyzSATQGZWI73R0HxQAagzKxne6Py2oAjUGZ2DSo8zEW6QAagzKxnW6Og2IAjUGZ2E63x2U1gMagTGwa1HkIIt3ngJ4mlPdhkzFbPAAAAABJRU5ErkJggg==","sha256":"55b36f66b778d8568c76b111b9379d7e5b598a50bc8bd9579856fd4e1f24792a","bytes":238,"width":72,"height":48},"b":{"base64":"iVBORw0KGgoAAAANSUhEUgAAAEgAAAAwCAYAAACynDzrAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAoElEQVRoge3YsRHCMADF0EySYTU2zWcCKOA4U7wiC+j0FdvXo3u++yWDC5z7rSAABdC+WQmDAmgM6nd/YhMLoDEoE9upA60GBdAYlIlNg/rPZxeRDqAxKBObBnU+yCIdQGNQJrbT3XFQDKAxKBPb6f64rAbQGJSJTYM6H2ORDqAxKBPb6eY4KAbQGJSJ7XR7XFYDaAzKxKZBnYcg0n0O6AlHVBOOwTK3tAAAAABJRU5ErkJggg==","sha256":"dc36c8bde4166a2d76a845b3a71e952ac6958a8f80fdae46b2bbc850b4f3e9c4","bytes":238,"width":72,"height":48}};
const custom=[{"id":"ln-a","name":"LN-CATALOG LN-A 品牌活动长期复用的摄影参考模板_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789","content":"为 {subject} 制作品牌活动画面。\n完整保留 {style} 与原始换行。A","category":"隔离长文分类","tags":["LN-TAG-A-BrandCampaignAssetReferenceABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],"createdBy":"ln-user","createdAt":1000,"updatedAt":1000,"isGlobal":false},{"id":"ln-b","name":"LN-CATALOG LN-B 多平台活动物料的完整原文模板_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789","content":"以 {subject} 为主体，保留 {style}。\n第二行：不要丢失此行、标点或占位符。\nLN 原文 B / exact","category":"隔离长文分类","tags":["LN-TAG-B-brand-identity-campaign-reference-channel-package-20261022"],"createdBy":"ln-user","createdAt":2000,"updatedAt":2000,"isGlobal":false}];

/**
 * @template T
 * @param {() => Promise<T>} create
 * @param {(error: unknown) => void} latch
 * @returns {Promise<T>}
 */
async function admitOwnedResource(create,latch) {
 try { return await create(); } catch(error) { latch(error); throw error; }
}
/**
 * @param {() => Promise<unknown>} operation
 * @param {{pending:Set<Promise<unknown>>, errors:unknown[], lateErrors:unknown[], onLateError?:(error:unknown)=>void}} state
 * @param {number} budget
 * @returns {Promise<boolean>}
 */
async function closeWithinBudget(operation,state,budget=2500) {
 let timer,expired=false;
 const observed=Promise.resolve().then(operation);state.pending.add(observed);
 void observed.then(()=>state.pending.delete(observed),error=>{
  state.pending.delete(observed);state.errors.push(error);
  if(expired){state.lateErrors.push(error);try{state.onLateError?.(error);}catch(note){state.errors.push(note);}}
 });
 try{return await Promise.race([observed.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>{expired=true;state.errors.push(Error('KT_OWNED_CLOSE_BUDGET_'+budget));resolve(false);},budget);})]);}
 catch{return false;}
 finally{clearTimeout(timer);}
}

/**
 * OWNED loopback test admission only. Does not navigate, mount UI, change DOM,
 * loosen old guards or qualify an app. Caller must retain its original
 * operation/late-work ledger and provide one absolute monotonic deadline.
 */
const fail=code=>{throw Error('LL_VIEWPORT '+code);};
const sameNumber=(actual,want)=>Number.isFinite(actual)&&Math.abs(actual-want)<=0.5;
function expectedIdentity(expected){
 if(!expected||![expected.width,expected.height].every(n=>Number.isInteger(n)&&n>0)||!Number.isFinite(expected.deviceScaleFactor)||expected.deviceScaleFactor<=0)fail('EXPECTED_METRICS');
 const u=new URL(expected.url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.hash)fail('EXPECTED_OWNED_LOOPBACK');
 return u.href;
}
function assertMobileViewportSnapshot(expected,snapshot){
 const url=expectedIdentity(expected);if(snapshot?.url!==url)fail('URL');
 if(!snapshot.contextViewport||!sameNumber(snapshot.contextViewport.width,expected.width)||!sameNumber(snapshot.contextViewport.height,expected.height))fail('CONTEXT_VIEWPORT');
 if(!Array.isArray(snapshot.meta)||snapshot.meta.length!==1)fail('META_COUNT');
 const fields=new Map();for(const part of snapshot.meta[0].split(',')){const pieces=part.trim().split('=');if(pieces.length!==2)fail('META_FIELD');const key=pieces[0].trim().toLowerCase(),value=pieces[1].trim().toLowerCase();if(fields.has(key))fail('META_DUPLICATE');fields.set(key,value);}
 if(fields.get('width')!=='device-width'||Number(fields.get('initial-scale'))!==1)fail('META_DEVICE_WIDTH_SCALE');
 for(const [key,want]of [['innerWidth',expected.width],['clientWidth',expected.width],['innerHeight',expected.height],['clientHeight',expected.height]])if(!sameNumber(snapshot[key],want))fail('LAYOUT_'+key);
 const v=snapshot.visualViewport;if(!v||!sameNumber(v.width,expected.width)||!sameNumber(v.height,expected.height)||!Number.isFinite(v.scale)||Math.abs(v.scale-1)>0.001||!sameNumber(v.left,0)||!sameNumber(v.top,0))fail('VISUAL_VIEWPORT');
 if(snapshot.coarse!==true||!Number.isInteger(snapshot.maxTouchPoints)||snapshot.maxTouchPoints<1)fail('COARSE_TOUCH');
 if(!Number.isFinite(snapshot.devicePixelRatio)||Math.abs(snapshot.devicePixelRatio-expected.deviceScaleFactor)>0.001)fail('PIXEL_RATIO');
 return{kind:'OWNED_MOBILE_VIEWPORT_IDENTITY_ONLY',qualified:true,expected:{...expected,url},snapshot:structuredClone(snapshot),applicationAccepted:false,wholeMobileAccepted:false};
}
async function admitOwnedMobileViewport(page,expected,deadline){
 expectedIdentity(expected);
 const check=()=>{if(!Number.isFinite(deadline)||performance.now()>=deadline)fail('DEADLINE');};check();
 if(page.url()!==new URL(expected.url).href)fail('URL_BEFORE_READ');
 const contextViewport=page.viewportSize();check();
 const metrics=await page.evaluate(()=>({url:location.href,meta:Array.from(document.querySelectorAll('meta[name="viewport" i]'),m=>m.getAttribute('content')||''),innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,visualViewport:window.visualViewport?{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,left:visualViewport.offsetLeft,top:visualViewport.offsetTop}:null,coarse:matchMedia('(pointer:coarse)').matches,maxTouchPoints:navigator.maxTouchPoints,devicePixelRatio}));
 check();if(page.url()!==new URL(expected.url).href)fail('URL_AFTER_READ');check();const result=assertMobileViewportSnapshot(expected,{...metrics,contextViewport});check();return result;
}

/**
 * Execute exactly four owned coarse-touch CSS contexts. Synthetic role slots
 * are not authentication, real Android, full CanvasWorkspace, or cloud evidence.
 * Caller supplies one Vitest timeout covering setup + four cases + cleanup.
 * All artifacts go to a fresh repo-local directory; nothing is removed.
 * @param {string} rootDirectory repository root (normally process.cwd()).
 * @returns {Promise<RegressionResult>}
 */
export async function runPromptTemplateLongContentRegression(rootDirectory){
 const root=fs.realpathSync(path.resolve(rootDirectory));
 const testedSources=['src/components/canvas-workspace.tsx','src/components/prompt-template-panel.tsx','src/lib/prompt-templates.ts','src/app/globals.css'].map(file=>pinFile(path.join(root,file)));
 function sourcesHeld(){return testedSources.every(before=>{try{const after=pinFile(before.path);return before.bytes===after.bytes&&before.sha256===after.sha256;}catch{return false;}});}
 const outputParent=path.join(root,'output','playwright');fs.mkdirSync(outputParent,{recursive:true});
 must(fs.realpathSync(outputParent)===outputParent,'LN_PHYSICAL_OUTPUT_PARENT');
 const output=fs.mkdtempSync(path.join(outputParent,'prompt-template-long-content-')),target=path.join(output,'result.json');
 let bundle,css,setupProof,media,chromium;
 async function prepareFixture(){
  const [{default:ts},{build},{compile},{Scanner},{default:sharp},playwright]=await Promise.all([import('typescript'),import('esbuild'),import('tailwindcss'),import('@tailwindcss/oxide'),import('sharp'),import('@playwright/test')]);
const sf=ts.createSourceFile('canvas-workspace.tsx',fs.readFileSync(root+'/src/components/canvas-workspace.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let jsx;
function visit(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(sf)==='PromptTemplatePanel'){must(!jsx,'LN_UNIQUE_PARENT');jsx=n.getText(sf);}ts.forEachChild(n,visit);}visit(sf);must(jsx,'LN_PARENT_JSX');
const entry=[
"import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import PromptTemplatePanel from'@/components/prompt-template-panel';import{getPromptTemplates}from'@/lib/prompt-templates';",
"const root=createRoot(document.getElementById('fixture-root')),hosts=new WeakMap();let host=0;const hostId=el=>{if(!hosts.has(el))hosts.set(el,++host);return hosts.get(el);};",
"const state={events:[],mounted:0,disposed:false,open:true,externalPrompt:'ln-original-prompt',storageBefore:null};",
"const observe=e=>{if(state.events.length>=1536)throw Error('LN_TRACE_CAP');const el=e.target instanceof Element?e.target.closest('button,input,select,.cursor-pointer'):null;state.events.push({type:e.type,trusted:e.isTrusted,host:el?hostId(el):null,pointerId:e.pointerId??null,touchId:e.changedTouches?.[0]?.identifier??null,key:e.key??null});};const types=['pointerdown','pointerup','touchstart','touchend','click','keydown','input','pointercancel','touchcancel'];",
"function Host({theme,role}){const[showPromptTemplate,setShowPromptTemplate]=useState(true),[externalPrompt,setExternalPrompt]=useState('ln-original-prompt');const currentUser={id:'ln-user',role},themeStyle=theme==='mono'?'monochrome':'gold';useEffect(()=>{state.open=showPromptTemplate;state.externalPrompt=externalPrompt;});return ("+jsx+");}",
"Object.assign(window,{ln:{state,hostId,mount(theme,role,items){if(state.mounted++)throw Error('LN_SINGLE_MOUNT');const defaults=getPromptTemplates();if(defaults.length!==8)throw Error('LN_ORIGINAL_DEFAULTS');localStorage.setItem('wujie_prompt_templates',JSON.stringify([...defaults,...items]));state.storageBefore=localStorage.getItem('wujie_prompt_templates');document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');for(const t of types)document.addEventListener(t,observe,true);root.render(<Host theme={theme} role={role}/>);},snapshot(){return {...structuredClone(state),storageAfter:localStorage.getItem('wujie_prompt_templates')};},unmount(){if(state.disposed)throw Error('LN_DOUBLE_UNMOUNT');state.disposed=true;root.unmount();for(const t of types)document.removeEventListener(t,observe,true);}}});"
].join('\n');
const compiled=await build({write:false,bundle:true,metafile:true,platform:'browser',format:'iife',target:'es2022',absWorkingDir:root,tsconfig:root+'/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},stdin:{contents:entry,resolveDir:root,sourcefile:'prompt-template-regression-parent.tsx',loader:'tsx'}});
must(compiled.outputFiles.length===1,'LN_ONE_MEMORY_BUNDLE');const bundle=compiled.outputFiles[0].text,require=createRequire(import.meta.url),inputs=Object.keys(compiled.metafile.inputs).filter(f=>/^src[\\/]/.test(f)&&/\.[jt]sx?$/.test(f)),sourceTexts=inputs.map(f=>({content:fs.readFileSync(root+'/'+f,'utf8'),extension:path.extname(f).slice(1)}));sourceTexts.push({content:entry,extension:'tsx'});must(inputs.includes('src/components/prompt-template-panel.tsx')&&inputs.includes('src/lib/prompt-templates.ts'),'LN_ORIGINAL_COMPONENT');
must(JSON.stringify([...inputs].sort())===JSON.stringify(['src/components/prompt-template-panel.tsx','src/lib/prompt-templates.ts']),'LN_SOURCE_IMPORT_ALLOWLIST');
const compiler=await compile(fs.readFileSync(root+'/src/app/globals.css','utf8'),{base:root,loadStylesheet:async(id,base)=>{const file=id==='tailwindcss'?require.resolve('tailwindcss/index.css'):id==='tw-animate-css'?root+'/node_modules/tw-animate-css/dist/tw-animate.css':require.resolve(id.startsWith('.')?path.resolve(base,id):id);return{path:file,base:path.dirname(file),content:fs.readFileSync(file,'utf8')};}}),css=compiler.build(new Scanner({}).scanFiles(sourceTexts));
const setupProof={parent:pinFile(root+'/src/components/canvas-workspace.tsx'),component:pinFile(root+'/src/components/prompt-template-panel.tsx'),jsxBytes:Buffer.byteLength(jsx),jsxSha256:sha(jsx),wholeOriginalJsx:true,originalComponentAndStyles:true,originalStorageLibrary:true,syntheticParentAccountAndState:true,fullCanvasWorkspace:false,inputs};

  const media={};for(const key of ['a','b']){const bytes=Buffer.from(fixtureMedia[key].base64,'base64'),m=await sharp(bytes).metadata();must(sha(bytes)===fixtureMedia[key].sha256&&bytes.length===fixtureMedia[key].bytes&&m.width===72&&m.height===48&&m.format==='png','LN_MEDIA_BYTES');media[key]=bytes;}
  return {bundle,css,setupProof,media,chromium:playwright.chromium};
 }
 const rows=origin=>custom.map((row,i)=>({...row,thumbnail:origin+'/fixture/'+(i?'b':'a')+'.png'}));
const operations={pending:new Set(),errors:[],lateErrors:[]},closeState={pending:new Set(),errors:[],lateErrors:[]},admissions={pending:new Set(),errors:[],lateErrors:[]},cases=[],captures=[],live=new Set();let browser,disconnected=false,cleanupStarted=false,activeCase=null,fatalError=null;

function markFatal(e){if(!fatalError)fatalError=e instanceof Error?e:Error(String(e));}
const latch=e=>{admissions.errors.push(String(e));markFatal(e);};
function fatalInputCheck(){const prior=fatalError||activeCase?.errors[0]||admissions.errors[0]||admissions.lateErrors[0]||operations.errors[0]||operations.lateErrors[0]||closeState.errors[0]||closeState.lateErrors[0];if(prior){markFatal(prior);throw Error('LN_FATAL_BEFORE_INPUT '+String(prior));}if(activeCase&&performance.now()>=activeCase.deadline){const error=Error('LN_CASE_DEADLINE');markFatal(error);throw error;}}
async function op(label,fn,budget=1500,sharedDeadline,cleanup=false){
 const deadline=Math.min(performance.now()+budget,sharedDeadline??Infinity,cleanup?Infinity:activeCase?.deadline??Infinity);let timer,expired=false;
 const note=(error,late=false)=>{operations.errors.push({label,error:String(error)});if(late)operations.lateErrors.push({label,error:String(error)});markFatal(error);},check=()=>{if(!cleanup)fatalInputCheck();if(performance.now()>=deadline){expired=true;const error=Error('LN_INPUT_DEADLINE '+label);note(error,true);throw error;}};
 const actual=Promise.resolve().then(()=>{check();return fn();}).then(v=>{check();return v;});operations.pending.add(actual);void actual.then(()=>operations.pending.delete(actual),e=>{operations.pending.delete(actual);note(e,expired||performance.now()>=deadline);});
 try{const value=await Promise.race([actual,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;const e=Error('LN_INPUT_BUDGET '+label);note(e);reject(e);},Math.max(0,deadline-performance.now()));})]);check();return value;}finally{clearTimeout(timer);}
}
async function close(fn){must(await closeWithinBudget(fn,closeState,2500),'LN_OWNED_CLOSE');}
async function admit(create,lateDispose,budget=1500){
 const deadline=Math.min(performance.now()+budget,activeCase?.deadline??Infinity);let timer,expired=false;
 fatalInputCheck();must(performance.now()<deadline,'LN_ADMISSION_START_DEADLINE');
 const actual=Promise.resolve().then(()=>{fatalInputCheck();must(performance.now()<deadline,'LN_ADMISSION_CREATE_DEADLINE');return admitOwnedResource(create,markFatal);});
 const tracked=actual.then(async resource=>{if(expired||cleanupStarted||fatalError||performance.now()>=deadline){const e=Error('LN_LATE_ADMISSION');admissions.lateErrors.push(String(e));markFatal(e);await close(()=>lateDispose(resource));throw e;}return resource;});admissions.pending.add(tracked);
 void tracked.then(()=>admissions.pending.delete(tracked),error=>{admissions.pending.delete(tracked);admissions.errors.push(String(error));markFatal(error);if(expired&&!admissions.lateErrors.includes(String(error)))admissions.lateErrors.push(String(error));});
 try{return await Promise.race([tracked,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;const e=Error('LN_ADMISSION_BUDGET');admissions.errors.push(String(e));markFatal(e);reject(e);},Math.max(0,deadline-performance.now()));})]);}finally{clearTimeout(timer);}
}
const ui=(v,c)=>{if(!v)throw Error('LN_UI '+c);};
async function settle(s,deadline){await op('settle',()=>s.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))),1500,deadline);}
async function drain(s,cleanup=false){const deadline=performance.now()+2500;while(s.pending.size||s.handlers.size||s.serverHandlers.size||s.responses.size){must(performance.now()<deadline,'LN_DRAIN_DEADLINE');await op('http-drain-tick',()=>s.page.evaluate(()=>new Promise(r=>requestAnimationFrame(r))),Math.max(1,deadline-performance.now()),undefined,cleanup);}must(performance.now()<deadline,'LN_DRAIN_ACCEPT');}
async function state(s){return op('state',()=>s.page.evaluate(()=>window.ln.snapshot()));}
async function box(target){return target.evaluate(el=>{const r=el.getBoundingClientRect();let clear=r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,opacity=1,paint=true;for(let p=el;p;p=p.parentElement){const st=getComputedStyle(p);opacity*=Number(st.opacity);if(st.display==='none'||st.visibility!=='visible')paint=false;}for(let p=el.parentElement;p;p=p.parentElement){const b=p.getBoundingClientRect(),st=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(st.overflowX)&&(r.left<b.left+p.clientLeft-.5||r.right>b.left+p.clientLeft+p.clientWidth+.5))clear=false;if(/auto|scroll|hidden|clip/.test(st.overflowY)&&(r.top<b.top+p.clientTop-.5||r.bottom>b.top+p.clientTop+p.clientHeight+.5))clear=false;}return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,clear,paint:paint&&opacity>=.95,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});}
async function tap(s,target,label,deadline=performance.now()+1500,cardAnchor){
 const attempt={label,status:'STARTED',box:null,marker:null,events:null,traceAvailable:false,inputDispatchStarted:false,accepted:false,stage:'admission',error:null};s.actions.push(attempt);
 const run=(name,fn)=>op(name,fn,1500,deadline),remaining=()=>Math.max(1,deadline-performance.now());
 try{
  await run('viewport:'+label,()=>admitOwnedMobileViewport(s.page,{url:s.origin+'/',width:s.w,height:s.h,deviceScaleFactor:1},deadline));await run('bring:'+label,()=>(cardAnchor||target).scrollIntoViewIfNeeded({timeout:remaining()}));
  const b=await run('box:'+label,()=>box(target));attempt.box=b;attempt.stage='geometry';ui(b.width>=43.5&&b.height>=43.5&&b.clear&&b.hit&&b.paint,'touch target clipped/small '+label+' '+JSON.stringify(b));
  const m=await run('marker:'+label,()=>target.evaluate(el=>({index:window.ln.state.events.length,host:window.ln.hostId(el.closest('button,input,select,.cursor-pointer')||el)})));attempt.marker=m;attempt.stage='tap';
  await run('tap:'+label,()=>{attempt.inputDispatchStarted=true;return target.tap({timeout:remaining()});});attempt.stage='settle';await settle(s,deadline);attempt.stage='trace';
  const events=await run('trace:'+label,()=>s.page.evaluate(i=>window.ln.state.events.slice(i),m.index));attempt.events=events;attempt.traceAvailable=true;
  const down=events.findIndex(e=>e.type==='pointerdown'&&e.trusted&&e.host===m.host),up=events.findIndex((e,i)=>i>down&&e.type==='pointerup'&&e.trusted&&e.host===m.host&&e.pointerId===events[down]?.pointerId),click=events.findIndex((e,i)=>i>up&&e.type==='click'&&e.trusted&&e.host===m.host),start=events.findIndex(e=>e.type==='touchstart'&&e.trusted&&e.host===m.host),end=events.findIndex((e,i)=>i>start&&e.type==='touchend'&&e.trusted&&e.host===m.host&&e.touchId===events[start]?.touchId);
  attempt.accepted=down>=0&&up>down&&click>up&&start>=0&&end>start&&!events.some(e=>/cancel/.test(e.type));attempt.status=attempt.accepted?'DISPATCHED_VERIFIED':'UNVERIFIED_INPUT';must(attempt.accepted,'LN_TRUSTED_INPUT '+label);attempt.stage='complete';
 }catch(e){attempt.error=String(e);if(!attempt.traceAvailable)attempt.traceUnavailableReason='not retrieved within original action budget at '+attempt.stage;if(!attempt.inputDispatchStarted&&String(e).startsWith('Error: LN_UI '))attempt.status='UNREACHABLE_NOT_INPUT';throw e;}
}
async function capture(s,suffix){const file=output+'/'+s.name+'-'+suffix+'.png';must(!fs.existsSync(file),'LN_CAPTURE_UNIQUE');await op('capture:'+suffix,()=>s.page.screenshot({path:file}));captures.push({name:s.name,suffix,pin:pinFile(file)});}
async function visible(s,target,label){const b=await op('visible-box:'+label,()=>box(target));ui(b.clear&&b.hit&&b.paint,'hidden/overlap '+label);return b;}

function addDefect(s,value){s.defects.push(value);}
function expectUi(s,condition,value){if(!condition)addDefect(s,value);return condition;}
async function search(s,value){
 const deadline=performance.now()+1500,run=(label,fn)=>op(label,fn,1500,deadline),input=s.page.getByLabel('搜索模板',{exact:true});
 await tap(s,input,'custom-search',deadline);const attempt={label:'search-value',value,status:'STARTED',marker:null,events:null,traceAvailable:false,accepted:false,stage:'marker',error:null};s.actions.push(attempt);
 try{attempt.marker=await run('search-marker',()=>input.evaluate(el=>({index:window.ln.state.events.length,host:window.ln.hostId(el)})));attempt.stage='keyboard';await run('search-all',()=>s.page.keyboard.press('Control+A'));await run('search-type',()=>s.page.keyboard.insertText(value));await settle(s,deadline);attempt.stage='trace';attempt.events=await run('search-events',()=>s.page.evaluate(i=>window.ln.state.events.slice(i),attempt.marker.index));attempt.traceAvailable=true;attempt.accepted=attempt.events.some(e=>e.type==='input'&&e.trusted&&e.host===attempt.marker.host);must(attempt.accepted,'LN_TRUSTED_SEARCH');ui(await run('search-final',()=>input.inputValue())===value,'custom search value');attempt.status='DISPATCHED_VERIFIED';attempt.stage='complete';}
 catch(e){attempt.error=String(e);if(!attempt.traceAvailable)attempt.traceUnavailableReason='not retrieved within original input budget at '+attempt.stage;throw e;}
}
function collectCustomHorizontal(el){
 const card=el.closest('.group'),modal=card.closest('[data-modal="prompt-templates"]'),windows=modal.querySelectorAll(':scope > .relative');if(windows.length!==1)throw Error('LN_UNIQUE_INNER_WINDOW');const panel=windows[0],c=card.getBoundingClientRect(),p=panel.getBoundingClientRect(),r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const textRects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),ancestors=[];
 let reached=false;for(let node=el;node;node=node.parentElement){if(ancestors.length>=32)throw Error('LN_ANCESTOR_CAP');const b=node.getBoundingClientRect(),st=getComputedStyle(node);ancestors.push({self:node===el,isWindow:node===panel,left:b.left,right:b.right,clientLeft:node.clientLeft,clientWidth:node.clientWidth,overflowX:st.overflowX});if(node===panel){reached=true;break;}}
 if(!reached)throw Error('LN_INNER_WINDOW_ANCESTRY');const title=card.querySelector('h4'),description=card.querySelector('p');
 const clipped=ancestors.filter(a=>/auto|scroll|hidden|clip/.test(a.overflowX)).some(a=>{const left=a.left+a.clientLeft,right=left+a.clientWidth;return textRects.some(t=>t.left<left-.5||t.right>right+.5)||(!a.self&&(r.left<left-.5||r.right>right+.5));});
 return{tagText:el.textContent,card:{left:c.left,right:c.right,width:c.width,clientWidth:card.clientWidth,scrollWidth:card.scrollWidth},tag:{left:r.left,right:r.right,width:r.width,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth},window:{left:p.left,right:p.right,clientLeft:panel.clientLeft,clientWidth:panel.clientWidth},windowCandidates:windows.length,ancestorWindowReached:reached,viewportWidth:innerWidth,ancestors,textRects,title:{text:title.textContent,scrollWidth:title.scrollWidth,clientWidth:title.clientWidth,textOverflow:getComputedStyle(title).textOverflow},summary:{text:description.textContent,lineClamp:getComputedStyle(description).webkitLineClamp},horizontalContainment:r.left>=c.left-.5&&r.right<=c.right+.5&&textRects.every(t=>t.left>=c.left-.5&&t.right<=c.right+.5)&&c.left>=p.left-.5&&c.right<=p.right+.5&&p.left>=-.5&&p.right<=innerWidth+.5&&!clipped};
}

async function customContentEvidence(s){
 const cards=s.panel.locator('.group'),count=await op('custom-count',()=>cards.count());ui(count===2,'custom filter expected2');const records=[];
 for(const item of custom){const card=cards.filter({has:s.page.getByRole('heading',{name:item.name,exact:true})});must(await op('one-custom-card',()=>card.count())===1,'LN_UNIQUE_CUSTOM_CARD');const tag=card.getByText(item.tags[0],{exact:true});const r=await op('custom-content-measure',()=>tag.evaluate(collectCustomHorizontal));r.id=item.id;records.push(r);expectUi(s,r.horizontalContainment&&r.card.scrollWidth<=r.card.clientWidth+1,'custom tag/card horizontal overflow '+item.id);}
 s.content=records;
 const imgs=s.panel.locator('.group img');await op('image-decode-settled',()=>imgs.evaluateAll(nodes=>new Promise(resolve=>{const sample=()=>{if(nodes.length===2&&nodes.every(n=>n.complete))resolve();else requestAnimationFrame(sample);};sample();})));s.media=await op('image-decode-evidence',()=>imgs.evaluateAll(nodes=>nodes.map(n=>({url:n.currentSrc,alt:n.alt,complete:n.complete,naturalWidth:n.naturalWidth,naturalHeight:n.naturalHeight}))));
 must(s.media.length===2&&s.media.every(i=>i.complete),'LN_MEDIA_COMPLETION');const a=s.media.find(i=>i.url===s.origin+'/fixture/a.png'),b=s.media.find(i=>i.url===s.origin+'/fixture/b.png');must(a&&b&&a.naturalWidth===72&&a.naturalHeight===48&&(s.kind==='failure'?b.naturalWidth===0&&b.naturalHeight===0:b.naturalWidth===72&&b.naturalHeight===48),'LN_ACTUAL_IMAGE_DECODE');
}
async function shutdownServer(s){if(!s.server?.listening)return;await Promise.all([Promise.all([...s.sockets].map(socket=>new Promise(resolve=>socket.once('close',resolve)))),new Promise((resolve,reject)=>{s.server.close(e=>e?reject(e):resolve());s.server.closeIdleConnections();})]);}
const keyOf=r=>r.method()+' '+new URL(r.url()).pathname+' '+r.resourceType();
async function session(c){const began=performance.now();const s={...c,began,deadline:began+25000,name:c.w+'x'+c.h+'-'+c.theme+'-'+c.kind+'-'+c.role,phase:'bootstrap',keyOf,defects:[],actions:[],outcomes:[],pending:new Set(),finished:new Set(),failed:new Set(),handlers:new Set(),serverHandlers:new Set(),responses:new Set(),sockets:new Set(),requests:[],statuses:[],counts:new Map(),console:[],expectedHttpConsole:[],errors:[],contextClosed:false,serverClosed:false,ready:false};activeCase=s;live.add(s);
 s.server=createServer();s.server.once('close',()=>s.serverClosed=true);s.server.on('error',e=>s.errors.push(String(e)));s.server.on('connection',socket=>{s.sockets.add(socket);socket.once('close',()=>s.sockets.delete(socket));});
 s.server.on('request',(req,res)=>{const task=(async()=>{s.responses.add(res);res.once('close',()=>s.responses.delete(res));must(req.method==='GET'&&req.headers.host===new URL(s.origin).host&&!req.headers.cookie&&!req.headers.authorization&&!req.headers['x-api-key'],'LN_SERVER_IDENTITY');const type=req.url==='/'?'document':req.headers['sec-fetch-dest']==='image'?'image':'fetch',key=req.method+' '+req.url+' '+type,limit=scope.httpCaps[key];must(limit&&s.requests.filter(r=>r.key===key).length<limit,'LN_SERVER_HTTP_CAP');const status=type==='image'&&req.url==='/fixture/b.png'&&c.kind==='failure'?503:200,record={key,status,finished:false};s.requests.push(record);res.once('finish',()=>record.finished=true);
 const body=type==='document'?'<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>'+css+'\nhtml,body,#fixture-root{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="fixture-root"></div></body></html>':status===503?Buffer.from('{"error":"LN_SYNTHETIC_MEDIA_FAILURE"}'):req.url==='/fixture/a.png'?media.a:media.b;
 res.writeHead(status,{'Content-Type':type==='document'?'text/html; charset=utf-8':status===503?'application/json':'image/png','Cache-Control':'no-store'});res.end(body);
 })().catch(e=>{s.errors.push(String(e));if(!res.writableEnded)res.end();});s.serverHandlers.add(task);void task.finally(()=>s.serverHandlers.delete(task));});
 await admit(()=>new Promise((resolve,reject)=>{s.server.once('error',reject);s.server.listen(0,'127.0.0.1',()=>{s.server.off('error',reject);resolve();});}),()=>shutdownServer(s));const a=s.server.address();must(a&&typeof a!=='string'&&a.address==='127.0.0.1','LN_LOOPBACK');s.origin='http://127.0.0.1:'+a.port;
 s.context=await admit(()=>browser.newContext({viewport:{width:c.w,height:c.h},isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:true}),r=>r.close());s.context.once('close',()=>s.contextClosed=true);s.page=await admit(()=>s.context.newPage(),r=>r.close());s.context.on('request',r=>s.pending.add(r));s.context.on('requestfinished',r=>{s.pending.delete(r);s.finished.add(r);});s.context.on('requestfailed',r=>{s.pending.delete(r);s.failed.add(r);});s.context.on('response',r=>s.statuses.push({key:keyOf(r.request()),status:r.status()}));s.page.on('pageerror',e=>s.errors.push(String(e)));s.page.on('console',m=>{const entry={type:m.type(),text:m.text(),location:m.location()};s.console.push(entry);if(m.type()==='error'){if(c.kind==='failure'&&entry.location.url===s.origin+'/fixture/b.png'&&/^Failed to load resource: the server responded with a status of 503/.test(entry.text))s.expectedHttpConsole.push(entry);else s.errors.push('LN_UNEXPECTED_CONSOLE '+m.text());}});
 s.page.on('dialog',d=>{s.errors.push('LN_UNEXPECTED_DIALOG');void op('owned-dialog-dismiss',()=>d.dismiss(),1500,undefined,true).catch(e=>s.errors.push(String(e)));});
 await op('deny-ws',()=>s.context.routeWebSocket('**/*',ws=>{s.errors.push('LN_UNEXPECTED_WS');ws.close();}));await op('finite-route',()=>s.context.route('**/*',async route=>{const task=(async()=>{const r=route.request(),u=new URL(r.url()),h=r.headers(),key=keyOf(r),n=(s.counts.get(key)||0)+1;s.counts.set(key,n);must(u.origin===s.origin&&!u.username&&!u.password&&!h.cookie&&!h.authorization&&!h['x-api-key']&&scope.httpCaps[key]&&n<=scope.httpCaps[key],'LN_ROUTE_BOUNDARY');await route.continue();})().catch(async e=>{s.errors.push(String(e));try{await route.abort();}catch(a){s.errors.push(String(a));}});s.handlers.add(task);try{await task;}finally{s.handlers.delete(task);}}));
 await op('root',()=>s.page.goto(s.origin+'/'));const deadline=performance.now()+1500;s.viewport=await op('viewport-before-mount',()=>admitOwnedMobileViewport(s.page,{url:s.origin+'/',width:c.w,height:c.h,deviceScaleFactor:1},deadline),1500,deadline);
 await op('inject',()=>s.page.addScriptTag({content:bundle}));await op('mount',()=>s.page.evaluate(({theme,role,items})=>window.ln.mount(theme,role,items),{theme:c.theme,role:c.role,items:rows(s.origin)}));s.mounted=true;await op('original-panel',()=>s.page.getByLabel('关闭提示词模板',{exact:true}).waitFor({timeout:1500}));s.panel=s.page.locator('[data-modal="prompt-templates"]');await drain(s);await settle(s);s.ready=true;await capture(s,'grid');return s;
}
async function dispose(s){must(!s.disposeAttempted,'LN_NO_CLOSE_REPLAY');s.disposeAttempted=true;const errors=[];
 if(s.context){if(s.mounted)try{await op('unmount',()=>s.page.evaluate(()=>window.ln.unmount()),1500,undefined,true);}catch(e){errors.push(String(e));}try{await drain(s,true);}catch(e){errors.push(String(e));}try{await close(()=>s.context.close());}catch(e){errors.push(String(e));}}
 if(s.server?.listening)try{await close(()=>shutdownServer(s));}catch(e){errors.push(String(e));}
 const completed=[...s.finished].map(keyOf).sort(),expected=s.requests.map(r=>r.key).sort(),closed={contextClosed:s.contextClosed,serverClosed:s.serverClosed,pending:s.pending.size,failed:s.failed.size,handlers:s.handlers.size,serverHandlers:s.serverHandlers.size,responses:s.responses.size,sockets:s.sockets.size,errors:[...s.errors,...errors],completed,expected,requests:s.requests,statuses:s.statuses,counts:[...s.counts],console:s.console,expectedHttpConsole:s.expectedHttpConsole,caseRuntimeMs:performance.now()-s.began,caseBudgetMs:25000,caseWithinBudget:performance.now()<s.deadline};
 closed.qualified=closed.caseWithinBudget&&closed.contextClosed&&closed.serverClosed&&closed.pending+closed.failed+closed.handlers+closed.serverHandlers+closed.responses+closed.sockets===0&&closed.errors.length===0&&JSON.stringify(completed)===JSON.stringify(expected)&&s.requests.every(r=>r.finished&&(r.status===200||(s.kind==='failure'&&r.status===503&&r.key==='GET /fixture/b.png image')))&&JSON.stringify(s.statuses.map(r=>r.key+' '+r.status).sort())===JSON.stringify(s.requests.map(r=>r.key+' '+r.status).sort())&&s.expectedHttpConsole.length<=1&&[...s.counts].every(([key,n])=>scope.httpCaps[key]&&n<=scope.httpCaps[key]);if((!s.context||s.contextClosed)&&s.serverClosed)live.delete(s);return closed;
}
let primary=null,result;
try{({bundle,css,setupProof,media,chromium}=await op('compile-real-fixture',prepareFixture,30000));browser=await admit(()=>chromium.launch({headless:true,timeout:30000}),r=>r.close(),30000);browser.once('disconnected',()=>disconnected=true);
 for(const c of matrix){let s,bodyError=null,flowFinished=false,closed=null;try{s=await session(c);await visible(s,s.panel,'template-modal');
 s.phase='custom-long-content';const before=await state(s);must(before.open&&before.externalPrompt==='ln-original-prompt'&&JSON.parse(before.storageBefore).length===10&&before.storageBefore===before.storageAfter,'LN_HEALTHY_SEED_BASELINE');s.storageBefore=before.storageBefore;
 await search(s,'LN-CATALOG');await drain(s);await customContentEvidence(s);await capture(s,'content');
 s.phase='original-parent-use';const card=s.panel.locator('.group').filter({has:s.page.getByRole('heading',{name:custom[1].name,exact:true})}),use=card.getByTitle('使用模板',{exact:true});await op('use-bring',()=>use.scrollIntoViewIfNeeded({timeout:1500}));await capture(s,'before-use');await tap(s,use,'use-custom-B');await settle(s);s.parent=await state(s);
 expectUi(s,s.parent.open===false&&s.parent.externalPrompt==='以 {subject} 为主体，保留 {style}。\n第二行：不要丢失此行、标点或占位符。\nLN 原文 B / exact','original parent exact prompt/close mismatch');expectUi(s,s.parent.storageAfter===s.storageBefore,'template operation changed original localStorage bytes');s.storageAfter=s.parent.storageAfter;fatalInputCheck();flowFinished=true;
 }catch(e){bodyError={message:String(e),phase:s?.phase||'bootstrap',ui:String(e).startsWith('Error: LN_UI ')};if(s)try{await capture(s,'failure');}catch(a){bodyError.captureError=String(a);}}
 finally{if(s)try{closed=await dispose(s);if(!closed.qualified)bodyError={...(bodyError||{}),ui:false,closeError:'LN_CLOSE_AND_HTTP_GUARD'};}catch(e){bodyError={...(bodyError||{}),ui:false,closeError:String(e)};}}
 const defects=s?.defects||[],status=bodyError?(bodyError.ui?'ui-red':'infrastructure-error'):defects.length?'ui-red':'passed';cases.push({name:c.w+'x'+c.h+'-'+c.theme+'-'+c.kind+'-'+c.role,ready:s?.ready||false,flowFinished,status,bodyError,defects,viewport:s?.viewport||null,actions:s?.actions||[],content:s?.content||null,media:s?.media||null,storageBefore:s?.storageBefore||null,storageAfter:s?.storageAfter||null,parent:s?.parent||null,closed});if(bodyError&&!bodyError.ui)break;
 }
}catch(e){primary=String(e);}
finally{cleanupStarted=true;for(const s of live)if(!s.disposeAttempted)try{await dispose(s);}catch(e){latch(e);}if(browser)try{await close(()=>browser.close());}catch(e){latch(e);}
 const final={browserDisconnected:disconnected,live:live.size,admissionPending:admissions.pending.size,admissionErrors:admissions.errors,admissionLateErrors:admissions.lateErrors,operationsPending:operations.pending.size,operationErrors:operations.errors,operationLateErrors:operations.lateErrors,closePending:closeState.pending.size,closeErrors:closeState.errors.map(String),closeLateErrors:closeState.lateErrors.map(String)};
 const qualified=!primary&&cases.length===4&&cases.every(c=>c.ready&&c.closed?.qualified&&['passed','ui-red'].includes(c.status))&&disconnected&&live.size+admissions.pending.size+operations.pending.size+closeState.pending.size===0&&admissions.errors.length+admissions.lateErrors.length+operations.errors.length+operations.lateErrors.length+closeState.errors.length+closeState.lateErrors.length===0;
 const counts=qualified?{selected:4,passed:cases.filter(c=>c.status==='passed').length,failed:cases.filter(c=>c.status==='ui-red').length}:null;result={at:new Date().toISOString(),qualified,counts,primary,cases,captures,final,setupProof,sourceChanged:!sourcesHeld(),fullW17Accepted:false,acceptedApplicationCases:0,cloudAccepted:false,physicalAndroidAccepted:false,wholeMobileAccepted:false,noPaid:true,noAuth:true,noClipboard:true,noBusinessDb:true,noDelete:true,noCrud:true,oldStoppedChainsNotReplayed:true};
 result.qualified=result.qualified&&!result.sourceChanged;
 result.outputDirectory=output;result.resultPath=target;
 writeExclusive(target,Buffer.from(JSON.stringify(result,null,2)+'\n'));
}

return result;
}
