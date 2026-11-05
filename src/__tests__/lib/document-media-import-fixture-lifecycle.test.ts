// @vitest-environment node
// QK controlled helper-overlap negative control. No server or real SQL.
import {afterEach,expect,it,vi} from 'vitest';
import type {IsolatedPostgresContext} from '../../../tests/helpers/postgres-test-database';
const state=vi.hoisted(()=>({clients:0,ended:[] as number[],events:[] as Array<{event:string;client?:number;database?:string;sql?:string}>}));
const base='postgresql://qk_unit@127.0.0.1:1/qk_never_connect';
const baseline='postgresql://qk_origin@127.0.0.1:1/qk_origin_never_connect';
vi.mock('pg',()=>({Client:class {
 readonly id=++state.clients;
 constructor(options:{connectionString:string}){if(options.connectionString!==base)throw Error('QK_ONLY_IN_MEMORY_CLIENT');state.events.push({event:'construct',client:this.id});}
 async connect():Promise<void>{state.events.push({event:'connect',client:this.id});}
 async query(sql:string):Promise<{rows:never[];rowCount:number;command:string;oid:number;fields:never[]}>{
  if(!/^(?:CREATE SCHEMA "test_qk_|SET search_path TO "test_qk_|DROP SCHEMA IF EXISTS "test_qk_|ROLLBACK$|RESET search_path$)/.test(sql))throw Error('QK_UNEXPECTED_IN_MEMORY_SQL');
  state.events.push({event:'fake-query',client:this.id,sql});return{rows:[],rowCount:0,command:'FAKE',oid:0,fields:[]};
 }
 async end():Promise<void>{state.ended.push(this.id);state.events.push({event:'end',client:this.id});}
}}));
vi.mock('../../../src/lib/db-client',()=>({closePool:vi.fn(async():Promise<void>=>{state.events.push({event:'close-shared-pool',database:process.env.PGDATABASE_URL});})}));
import {withIsolatedPostgres} from '../../../tests/helpers/postgres-test-database';
interface Gate {promise:Promise<void>;release:()=>void}
function gate():Gate{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
function env():string|undefined{return process.env.PGDATABASE_URL;}
function bindUnitEnvironment():void{state.clients=0;state.ended=[];state.events=[];vi.stubEnv('POSTGRES_TEST_DATABASE_URL',base);vi.stubEnv('PGDATABASE_URL',baseline);vi.stubEnv('DATABASE_URL',baseline);}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

import {readFileSync}from'node:fs';
import ts from'typescript';
import path from'node:path';
const mediaSource=readFileSync('tests/integration/document-media-import-postgres.test.ts','utf8');
type Hook=()=>void|Promise<void>;
interface HookHost {run:typeof withIsolatedPostgres;before:Hook;after:Hook;final:Hook;calls:Array<{name:string;ended:number}>;initialized:()=>number}
function actualHooks(source:string=mediaSource):HookHost{
 const file=ts.createSourceFile('document-media-import-postgres.test.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 expect(ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)).toEqual([]);
 const support:string[]=[];let localWrapper=false;
 for(const statement of file.statements){
  if(ts.isFunctionDeclaration(statement)&&statement.name&&['withIsolatedPostgres','finishMediaImportFixtures'].includes(statement.name.text)){
   support.push(statement.getText(file));if(statement.name.text==='withIsolatedPostgres')localWrapper=true;
  }else if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&['pendingMediaImportFixtures','mediaImportFixtureTainted','mediaImportFixtureFailures','mediaImportFixtureClosures'].includes(d.name.text))){
   support.push(statement.getText(file));
  }
 }
 const registrations=file.statements.filter(ts.isExpressionStatement).filter(s=>ts.isCallExpression(s.expression)&&ts.isIdentifier(s.expression.expression)&&['beforeEach','afterEach','afterAll'].includes(s.expression.expression.text));
 const before:Hook[]=[],after:Hook[]=[],final:Hook[]=[],calls:Array<{name:string;ended:number}>=[];let initialized=0;
 const instrument={stubEnv:():void=>{initialized++;calls.push({name:'stub',ended:state.ended.length});},restoreAllMocks:():void=>{calls.push({name:'restore',ended:state.ended.length});},unstubAllEnvs:():void=>{calls.push({name:'unstub',ended:state.ended.length});}};
 const contents=(localWrapper?'':'const withIsolatedPostgres=runIsolatedPostgres;\n')+support.join('\n')+'\n'+registrations.map(s=>s.getText(file)).join('\n')+'\nreturn {run:withIsolatedPostgres};';
 const out=ts.transpileModule(contents,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}});
 expect(out.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)).toEqual([]);
 const baseRoot=path.resolve('output/qk-no-real-files'),mediaRoot=path.join(baseRoot,'document-media-import-qk-lifecycle');
 const factory=new Function('runIsolatedPostgres','vi','beforeEach','afterEach','afterAll','path','roots','mediaRoot','expect','rm','process',out.outputText) as (...values:unknown[])=>{run:typeof withIsolatedPostgres};
 const value=factory(withIsolatedPostgres,instrument,(h:Hook)=>before.push(h),(h:Hook)=>after.push(h),(h:Hook)=>final.push(h),path,{base:baseRoot,previousRoot:'qk-original'},mediaRoot,expect,async():Promise<void>=>{calls.push({name:'rm',ended:state.ended.length});},{env:{WUJIE_DATA_DIR:mediaRoot}});
 expect(before).toHaveLength(1);expect(after).toHaveLength(1);expect(final).toHaveLength(1);
 return {run:value.run,before:before[0],after:after[0],final:final[0],calls,initialized:()=>initialized};
}
async function ticks():Promise<void>{for(let i=0;i<24;i++)await Promise.resolve();}
function errorMessage(error:unknown):string{return error instanceof Error?error.message:String(error);}
it('QK media test cleanup waits for complete isolated helper before restoring mocks and environment',async():Promise<void>=>{
 bindUnitEnvironment();const host=actualHooks(),entry=gate(),resume=gate();await host.before();
 let cleanupDone=false;let cleanup:Promise<unknown>|undefined;const work=host.run('qk_cleanup',async():Promise<void>=>{entry.release();await resume.promise;});
 try{
  await Promise.race([entry.promise,work.then(()=>{throw Error('QK_NO_ENTRY');})]);
  cleanup=Promise.resolve().then(()=>host.after()).then(()=>{cleanupDone=true;});await ticks();
  const beforeClose={restored:host.calls.some(c=>c.name==='restore'||c.name==='unstub'),ended:state.ended.length};
  resume.release();await work;const helperFinishedWithCleanupPending=!cleanupDone;let closingError:unknown;try{await host.before();}catch(e){closingError=e;}
  const cleanupWindow={active:helperFinishedWithCleanupPending,blocked:errorMessage(closingError).startsWith('DOCUMENT_MEDIA_FIXTURE_PENDING'),initialized:host.initialized()};await cleanup;
  console.log('QK_CLEANUP_OBSERVATION',JSON.stringify({beforeClose,cleanupWindow,calls:host.calls,clientsEnded:state.ended.length,realSql:false}));
  expect(beforeClose.restored,'QK cleanup must not restore globals before helper cleanup').toBe(false);
  expect(beforeClose.ended).toBe(0);expect(cleanupWindow).toEqual({active:true,blocked:true,initialized:1});expect(state.ended).toEqual([1]);
  expect(host.calls.filter(c=>c.name==='restore'||c.name==='unstub')).toEqual([{name:'restore',ended:1},{name:'unstub',ended:1}]);expect(env()).toBe(baseline);
 }finally{resume.release();await Promise.allSettled([work,...(cleanup?[cleanup]:[])]);}
});
it('QK next media test refuses to initialize while previous database fixture is unfinished',async():Promise<void>=>{
 bindUnitEnvironment();const host=actualHooks(),entry=gate(),resume=gate();await host.before();
 const work=host.run('qk_next',async():Promise<void>=>{entry.release();await resume.promise;});
 try{
  await Promise.race([entry.promise,work.then(()=>{throw Error('QK_NO_ENTRY');})]);let blocked:unknown;
  try{await host.before();}catch(e){blocked=e;}
  resume.release();await work;await host.after();
  console.log('QK_NEXT_OBSERVATION',JSON.stringify({blocked:errorMessage(blocked),initialized:host.initialized(),clientsEnded:state.ended.length,realSql:false}));
  expect(errorMessage(blocked)).toContain('DOCUMENT_MEDIA_FIXTURE_PENDING');expect(host.initialized()).toBe(1);expect(state.ended).toEqual([1]);expect(env()).toBe(baseline);
 }finally{resume.release();await Promise.allSettled([work]);}
});
it('QK late fixture failure stays visible and prevents another media test initialization',async():Promise<void>=>{
 bindUnitEnvironment();const host=actualHooks(),entry=gate(),resume=gate();await host.before();
 const failure=new Error('QK_LATE_WORK_FAILURE'),work=host.run('qk_failure',async():Promise<void>=>{entry.release();await resume.promise;throw failure;});
 const observed=work.then(()=>undefined,e=>e);let cleanup:Promise<unknown>|undefined;
 try{
  await Promise.race([entry.promise,observed.then(()=>{throw Error('QK_NO_ENTRY');})]);
  cleanup=Promise.resolve().then(()=>host.after()).then(()=>undefined,e=>e);await ticks();resume.release();
  expect(await observed).toBe(failure);const cleanupError=await cleanup;let blocked:unknown;try{await host.before();}catch(e){blocked=e;}
  console.log('QK_LATE_FAILURE_OBSERVATION',JSON.stringify({cleanupError:errorMessage(cleanupError),blocked:errorMessage(blocked),clientsEnded:state.ended.length,restores:host.calls.filter(c=>c.name==='restore').length,realSql:false}));
  expect(cleanupError).toBeInstanceOf(AggregateError);expect((cleanupError as AggregateError).errors).toContain(failure);expect(errorMessage(blocked)).toContain('DOCUMENT_MEDIA_FIXTURE_PENDING');
  expect(host.calls.some(c=>c.name==='restore'||c.name==='unstub')).toBe(false);expect(state.ended).toEqual([1]);expect(env()).toBe(baseline);
 }finally{resume.release();await Promise.allSettled([work,...(cleanup?[cleanup]:[])]);}
});

it('QK media directory cleanup refuses unfinished fixture work and only removes after actual completion',async():Promise<void>=>{
 bindUnitEnvironment();const host=actualHooks(),entry=gate(),resume=gate();await host.before();
 const work=host.run('qk_media_cleanup',async():Promise<void>=>{entry.release();await resume.promise;});
 try{
  await Promise.race([entry.promise,work.then(()=>{throw Error('QK_NO_ENTRY');})]);let blocked:unknown;try{await host.final();}catch(e){blocked=e;}
  const removedBeforeClose=host.calls.filter(c=>c.name==='rm').length;resume.release();await work;await host.after();await host.final();
  console.log('QK_MEDIA_CLEANUP_OBSERVATION',JSON.stringify({blocked:errorMessage(blocked),removedBeforeClose,removals:host.calls.filter(c=>c.name==='rm'),clientsEnded:state.ended.length,realFilesystemRemoval:false,realSql:false}));
  expect(errorMessage(blocked)).toContain('DOCUMENT_MEDIA_FIXTURE_PENDING');expect(removedBeforeClose).toBe(0);
  expect(host.calls.filter(c=>c.name==='rm')).toEqual([{name:'rm',ended:1}]);expect(state.ended).toEqual([1]);expect(env()).toBe(baseline);
 }finally{resume.release();await Promise.allSettled([work]);}
});

for(const [label,reason]of [['Error',new Error('QK_SETTLED_FAILURE')],['null',null],['undefined',undefined]] as const)it('QK settled '+label+' helper rejection remains visible and blocks later initialization',async():Promise<void>=>{
 bindUnitEnvironment();const host=actualHooks();await host.before();
 const work=host.run('qk_settled_'+label.toLowerCase(),async():Promise<void>=>{throw reason;});
 const observed=work.then(()=>({rejected:false,reason:undefined as unknown}),value=>({rejected:true,reason:value as unknown}));
 try{
  const outcome=await observed;await ticks();expect(outcome.rejected).toBe(true);expect(outcome.reason).toBe(reason);expect(state.ended).toEqual([1]);
  let cleanupError:unknown,blockedError:unknown;try{await host.after();}catch(e){cleanupError=e;}try{await host.before();}catch(e){blockedError=e;}
  const blocked=errorMessage(blockedError).startsWith('DOCUMENT_MEDIA_FIXTURE_PENDING'),captured=cleanupError instanceof AggregateError;
  console.log('QK_SETTLED_REJECTION_OBSERVATION',JSON.stringify({label,callbackRejectionObserved:outcome.rejected,blocked,cleanupCaptured:captured,initialized:host.initialized(),restoreCalls:host.calls.filter(c=>c.name==='restore').length,clientsEnded:state.ended.length,realSql:false}));
  expect(blocked,'QK settled rejection blocks next initialization').toBe(true);expect(captured).toBe(true);
  expect((cleanupError as AggregateError).errors).toHaveLength(1);expect((cleanupError as AggregateError).errors[0]).toBe(reason);
  expect(host.initialized()).toBe(1);expect(host.calls.some(c=>c.name==='restore'||c.name==='unstub')).toBe(false);expect(env()).toBe(baseline);
 }finally{await Promise.allSettled([work]);}
});
