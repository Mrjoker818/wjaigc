// @vitest-environment jsdom
import React from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {installWorkflowOfflineGuard} from '@/__tests__/helpers/workflow-offline-guard';
const boundary=vi.hoisted(()=>({violations:[] as string[]}));
vi.mock('@/lib/db-client',()=>({execSql:async()=>{boundary.violations.push('DB');throw Error('DB_FORBIDDEN');},getPool:()=>{boundary.violations.push('DB');throw Error('DB_FORBIDDEN');}}));
vi.mock('@/lib/server-data-root',()=>{const deny=()=>{boundary.violations.push('DATA_ROOT');throw Error('WORKFLOW_TEST_DATA_ROOT_FORBIDDEN');};return {getServerDataRoot:deny,getServerSystemDir:deny,getServerUsersDir:deny,isServerDataRootDurable:deny,saveImageFile:deny,deleteImageFile:deny};});
vi.mock('pg',()=>{boundary.violations.push('PG');throw Error('WORKFLOW_TEST_PG_FORBIDDEN');});
let offline:ReturnType<typeof installWorkflowOfflineGuard>;
let NodeEditor:typeof import('@/components/node-editor').default;
let createConnection:typeof import('@/lib/workflow-engine').createConnection;
let createEmptyWorkflow:typeof import('@/lib/workflow-engine').createEmptyWorkflow;
let createWorkflowNode:typeof import('@/lib/workflow-engine').createWorkflowNode;
beforeAll(async()=>{offline=installWorkflowOfflineGuard();const engine=await import('@/lib/workflow-engine');createConnection=engine.createConnection;createEmptyWorkflow=engine.createEmptyWorkflow;createWorkflowNode=engine.createWorkflowNode;NodeEditor=(await import('@/components/node-editor')).default;});
afterAll(()=>offline?.restore());
let requests:Array<{url:string;action?:string}>=[];
beforeEach(()=>{
 offline.verify();
 requests=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
  const method=String(init?.method ?? (input instanceof Request?input.method:'GET')).toUpperCase();
  const action=typeof init?.body==='string'?(JSON.parse(init.body) as {action?:string}).action:undefined;requests.push({url,action});
  if(url==='/api/skills?surface=workflow'&&method==='GET'&&!init?.body)return Response.json({skills:[]});
  if(url==='/api/workflow/execute'&&method==='POST'&&action==='start')return Response.json({error:'工作流连线 test-edge 失配：请检查端口',code:'WORKFLOW_CONNECTION_PREFLIGHT_FAILED'},{status:422});
  boundary.violations.push('UNEXPECTED_FETCH');throw Error('UNEXPECTED_REQUEST '+url);
 }));
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 vi.stubGlobal('ResizeObserver',class{observe():void{} unobserve():void{} disconnect():void{}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();expect([...offline.violations,...boundary.violations]).toEqual([]);});
it('real editor shows rejected start reason and remains runnable',async()=>{
 const a=createWorkflowNode('input-image',0,0,'source');a.id='source';a.config={...a.config,source:'url',imageUrl:'data:image/png;base64,AA=='};
 const b=createWorkflowNode('output-image',0,0,'target');b.id='target';const edge={...createConnection(a.id,'out-image',b.id,'missing','image'),id:'test-edge'};
 const workflow={...createEmptyWorkflow('synthetic'),nodes:[a,b],connections:[edge]};
 render(<NodeEditor workflow={workflow} userId="actor" projectId="project" canvasImages={[]} />);
 fireEvent.click(screen.getByRole('button',{name:'执行工作流'}));
 await screen.findByText('工作流连线 test-edge 失配：请检查端口');
 await waitFor(()=>expect((screen.getByRole('button',{name:'执行工作流'}) as HTMLButtonElement).disabled).toBe(false));
 expect(requests.filter(item=>item.url==='/api/workflow/execute')).toEqual([{url:'/api/workflow/execute',action:'start'}]);
});
