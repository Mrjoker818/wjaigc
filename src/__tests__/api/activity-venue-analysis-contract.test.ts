import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({
  user: { id: 'synthetic-user', name: 'synthetic', role: 'admin', status: 'active', createdAt: 1, updatedAt: 1 } as null | { id: string; name: string; role: 'admin' | 'user'; status: 'active' | 'disabled'; createdAt: number; updatedAt: number; chatModels?: string[] },
  requests: [] as Array<{ model: string; messages?: Array<{ role: string; content: unknown }> }>,
  bases: [] as string[],
  otherProvider: false,
  registered: [] as string[],
  configError: false,
  content: '{"regions":[]}',
  updates: [] as Array<{ status?: string; error?: string; result?: unknown }>,
  provider: {
    id: 'synthetic-provider',
    name: 'synthetic',
    type: 'chat',
    modelType: 'chat' as string | undefined,
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1,
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'synthetic-key',
    selectedModels: ['vision-one', 'vision-two'],
    discoveredModels: [] as Array<{id:string;name:string;providerId:string;type:'chat'}>,
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: async () => fixture.provider,
  findProviderForModel: async () => fixture.provider,
  getApiProviders: async () => {
    if (fixture.configError) throw new Error('synthetic-private-secret');
    return fixture.otherProvider ? [fixture.provider,{...fixture.provider,id:'other-provider',baseUrl:'https://other.invalid/v1'}] : [fixture.provider];
  },
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => fixture.user, listManagedUsers: async () => [] }));
vi.mock('@/lib/task-registry', () => ({
  registerTask: (id: string) => { fixture.registered.push(id); },
  updateTaskProgress: (_id: string, update: { status?: string; error?: string; result?: unknown }) => { fixture.updates.push(update); },
}));
vi.mock('@/lib/api-helpers', () => ({
  fetchWithV1Retry: async (_base: string, _path: string, options: RequestInit) => {
    fixture.bases.push(_base);
    fixture.requests.push(JSON.parse(String(options.body)) as { model: string; messages?: Array<{ role: string; content: unknown }> });
    return { ok: true, json: async () => ({ choices: [{ message: { content: fixture.content } }] }) };
  },
}));

import { POST } from '@/app/api/activity-venue/analyze/route';
import { POST as submitProposals } from '@/app/api/activity-venue/proposals/route';
import { POST as submitQc } from '@/app/api/activity-venue/qc/route';

const request = (overrides: Record<string, unknown> = {}): NextRequest => new NextRequest('https://synthetic.invalid/api/activity-venue/analyze', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ venueImageUrl: 'data:image/png;base64,c3ludGhldGlj', providerId: 'synthetic-provider', model: 'vision-two', ...overrides }),
});

beforeEach(() => {
  fixture.user = { id: 'synthetic-user', name: 'synthetic', role: 'admin', status: 'active', createdAt: 1, updatedAt: 1 };
  fixture.requests = [];
  fixture.bases = [];
  fixture.otherProvider = false;
  fixture.registered = [];
  fixture.configError = false;
  fixture.content = '{"regions":[]}';
  fixture.updates = [];
  fixture.provider.selectedModels = ['vision-one', 'vision-two'];
  fixture.provider.discoveredModels = [];
  fixture.provider.isEnabled = true;
  fixture.provider.modelType = 'chat';
});

describe('venue analysis task admission', () => {
  it('uses the exact selected model on the chosen provider', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.requests[0].model).toBe('vision-two');
  });

  it('rejects unauthenticated requests before creating a task or calling the provider', async () => {
    fixture.user = null;
    const result = await POST(request());
    expect(result.status).toBe(401);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('rejects a model not configured on the selected provider', async () => {
    const result = await POST(request({ model: 'not-configured' }));
    expect(result.status).toBe(403);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('rejects a model not assigned to the current user', async () => {
    fixture.user = { id: 'synthetic-user', name: 'synthetic', role: 'user', status: 'active', createdAt: 1, updatedAt: 1, chatModels: ['synthetic-provider::vision-one'] };
    const result = await POST(request());
    expect(result.status).toBe(403);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('chooses the only authorized provider when the same model exists on multiple providers', async () => {
    fixture.otherProvider = true;
    fixture.user={id:'synthetic-user',name:'synthetic',role:'user',status:'active',createdAt:1,updatedAt:1,chatModels:['other-provider::vision-two']};
    const result=await POST(request({providerId:undefined}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.bases[0]).toBe('https://other.invalid/v1');
    expect(fixture.requests[0].model).toBe('vision-two');
  });

  it('requires the provider when an authorized model name is ambiguous', async () => {
    fixture.otherProvider = true;
    const result=await POST(request({providerId:undefined}));
    expect(result.status).toBe(400);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('uses an authorized model on the requested provider when no model was supplied', async () => {
    fixture.user={id:'synthetic-user',name:'synthetic',role:'user',status:'active',createdAt:1,updatedAt:1,chatModels:['synthetic-provider::vision-two']};
    const result=await POST(request({model:undefined}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.requests[0].model).toBe('vision-two');
  });

  it('uses an authorized discovered model when no selected default exists', async () => {
    fixture.provider.selectedModels=[];
    fixture.provider.discoveredModels=[{id:'discovered-chat',name:'合成聊天模型',providerId:'synthetic-provider',type:'chat'}];
    const result=await POST(request({model:undefined}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.requests[0].model).toBe('discovered-chat');
  });

  it('preserves the configured default when no model was selected', async () => {
    const result = await POST(request({ model: undefined }));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.requests[0].model).toBe('vision-one');
  });

  it('keeps a configured model suffix in the provider request', async () => {
    fixture.provider.selectedModels = ['vision-one', 'vision-two-4k'];
    const result = await POST(request({ model: 'vision-two-4k' }));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.requests[0].model).toBe('vision-two-4k');
  });

  it('rejects a disabled account before task creation', async () => {
    fixture.user = { id: 'synthetic-user', name: 'synthetic', role: 'user', status: 'disabled', createdAt: 1, updatedAt: 1 };
    const result = await POST(request());
    expect(result.status).toBe(403);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('does not replace an unknown explicit provider', async () => {
    const result = await POST(request({ providerId: 'unknown-provider' }));
    expect(result.status).toBe(400);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('accepts a legacy chat provider that has type but no modelType', async () => {
    fixture.provider.modelType = undefined;
    const result = await POST(request());
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.requests[0].model).toBe('vision-two');
  });

  it('does not expose internal provider configuration errors', async () => {
    fixture.configError = true;
    const result = await POST(request());
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain('synthetic-private-secret');
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it.each(['not JSON', '{"regions":"invalid"}'])('does not report fabricated success for invalid analysis %s', async (content) => {
    fixture.content = content;
    const result = await POST(request());
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'failed')).toBe(true));
    expect(fixture.updates.some(item => item.status === 'completed')).toBe(false);
  });

  it('publishes a valid analysis returned by the selected model', async () => {
    const analysis = { spaceType: 'mall_atrium', estimatedDimensions: { length: 12000, width: 8000, height: 4500, unit: 'mm' }, lighting: 'mixed', regions: [{ id: 'r1', name: '入口', type: 'entrance', position: '左侧', estimatedSize: { length: 3000, width: 2000 }, notes: '', floor: '1F' }], structuralLimits: [], designNotes: '合成结果', extraContext: '保持补充信息' };
    fixture.content = JSON.stringify(analysis);
    const result = await POST(request());
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'completed')).toBe(true));
    expect(fixture.updates.find(item => item.status === 'completed')?.result).toEqual({ analysis, type: 'venue-analyze' });
  });

  it('preserves the existing normalized coordinate region format', async () => {
    const analysis = { spaceType:'mall_atrium', estimatedDimensions:{length:12000,width:8000,height:4500}, lighting:'mixed', regions:[{id:'r1',name:'入口',type:'entrance',position:{x:0.1,y:0.1,w:0.3,h:0.4},estimatedSize:'3000 × 2000 mm'}], structuralLimits:[],designNotes:'' };
    fixture.content = JSON.stringify(analysis);
    const result = await POST(request());
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'completed')).toBe(true));
    expect(fixture.updates.find(item => item.status === 'completed')?.result).toEqual({ analysis, type: 'venue-analyze' });
  });

  it('passes both descriptive and normalized positions to the proposal model', async () => {
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
        providerId:'synthetic-provider', model:'vision-two',
        venueAnalysis:{spaceType:'mall_atrium',estimatedDimensions:{length:12000,width:8000,height:4500},lighting:'mixed',structuralLimits:[],regions:[
          {name:'入口',type:'entrance',position:'左侧入口'},
          {name:'展区',type:'main',position:{x:0.1,y:0.2,w:0.3,h:0.4}},
        ]}, activityBrief:{eventName:'合成活动'},
      }),
    });
    const result = await submitProposals(proposalRequest);
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    const prompt = fixture.requests[0].messages?.find(message => message.role === 'user')?.content;
    expect(prompt).toContain('左侧入口');
    expect(prompt).toContain('{"x":0.1,"y":0.2,"w":0.3,"h":0.4}');
    expect(prompt).not.toContain('[object Object]');
  });

  it('does not describe malformed legacy positions as normalized coordinates', async () => {
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
        providerId:'synthetic-provider', model:'vision-two', venueAnalysis:{spaceType:'mall_atrium',estimatedDimensions:{length:1,width:1,height:1},lighting:'mixed',structuralLimits:[],regions:[
          {name:'空值',type:'other',position:null}, {name:'越界',type:'other',position:{x:0.9,y:0,w:0.5,h:1}},
        ]}, activityBrief:{eventName:'合成活动'},
      }),
    });
    const result = await submitProposals(proposalRequest);
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    const prompt = fixture.requests[0].messages?.find(message => message.role === 'user')?.content;
    expect(prompt).toContain('空值(other, 位置未知)');
    expect(prompt).toContain('越界(other, 位置未知)');
    expect(prompt).not.toContain('归一化坐标 null');
  });

  it.each(['not JSON', '{"passed":true}'])('does not fabricate a passing quality check for invalid output %s', async content => {
    fixture.content = content;
    const qcRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/qc', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
        providerId:'synthetic-provider',model:'vision-two',imageUrl:'https://image.invalid/test.png',designId:{brandName:'合成品牌',lockedFields:{}},
      }),
    });
    const result = await submitQc(qcRequest);
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'failed')).toBe(true));
    expect(fixture.updates.some(item => item.status === 'completed')).toBe(false);
  });

  it('preserves an actual non-passing quality check', async () => {
    const dimension = {score:4,comment:'需要调整'};
    const qcResult = {passed:false,overallScore:4,dimensions:{brandIdentity:dimension,styleConsistency:dimension,spaceLayout:dimension,materialColor:dimension,overallQuality:dimension},issues:['品牌不可见'],suggestions:['调整位置'],verdict:'未通过'};
    fixture.content = JSON.stringify(qcResult);
    const qcRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/qc', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',imageUrl:'https://image.invalid/test.png',designId:{brandName:'合成品牌',lockedFields:{}}}),
    });
    expect((await submitQc(qcRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'completed')).toBe(true));
    expect(fixture.updates.find(item => item.status === 'completed')?.result).toEqual({qcResult,type:'venue-qc'});
  });

  it('rejects an invalid extra quality dimension before publishing the result', async () => {
    const dimension = {score:8,comment:'合成'};
    fixture.content = JSON.stringify({passed:true,overallScore:8,dimensions:{brandIdentity:dimension,styleConsistency:dimension,spaceLayout:dimension,materialColor:dimension,overallQuality:dimension,other:null},issues:[],suggestions:[],verdict:'通过'});
    const qcRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/qc', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',imageUrl:'https://image.invalid/test.png',designId:{brandName:'合成品牌',lockedFields:{}}}),
    });
    expect((await submitQc(qcRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'failed')).toBe(true));
    expect(fixture.updates.some(item => item.status === 'completed')).toBe(false);
  });

  it('uses the selected model for quality checking', async () => {
    const qcRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/qc', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',imageUrl:'https://image.invalid/test.png',designId:{brandName:'合成品牌',lockedFields:{}}}),
    });
    expect((await submitQc(qcRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.requests[0].model).toBe('vision-two');
  });

  it('rejects unauthenticated quality checking before task creation', async () => {
    fixture.user = null;
    const qcRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/qc', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',imageUrl:'https://image.invalid/test.png',designId:{brandName:'合成品牌',lockedFields:{}}}),
    });
    expect((await submitQc(qcRequest)).status).toBe(401);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('rejects quality checking with a model not assigned to the user', async () => {
    fixture.user={id:'synthetic-user',name:'synthetic',role:'user',status:'active',createdAt:1,updatedAt:1,chatModels:['synthetic-provider::vision-one']};
    const qcRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/qc', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',imageUrl:'https://image.invalid/test.png',designId:{brandName:'合成品牌',lockedFields:{}}}),
    });
    expect((await submitQc(qcRequest)).status).toBe(403);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it.each([
    'not JSON',
    '{"proposals":[]}',
    '{"proposals":[{"id":"p1","name":"方案一","concept":"概念一"}]}',
    '{"proposals":[{"id":"p1","name":"方案一","concept":"概念一"},{"id":"p2","name":"方案二","concept":"概念二"},{"id":"p3","name":"方案三","concept":"概念三"}]}',
    '{"proposals":[{"id":"p1","name":"方案一","concept":"概念一"},{"id":"p2","name":"方案二","concept":"概念二","highlights":[{}]},{"id":"p3","name":"方案三","concept":"概念三"}]}',
    '{"proposals":[{"id":"p1","name":"方案一","concept":"概念一"},{"id":"p1","name":"方案二","concept":"概念二"},{"id":"p3","name":"方案三","concept":"概念三"}]}',
  ])('does not report synthetic proposals as successful when the supplier output is invalid: %s', async content => {
    fixture.content = content;
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'failed' || item.status === 'completed')).toBe(true));
    expect(fixture.updates.some(item => item.status === 'completed')).toBe(false);
    expect(fixture.updates.find(item => item.status === 'failed')?.error).toMatch(/核实.*费用/);
    expect(fixture.requests).toHaveLength(1);
  });

  it('publishes actual valid supplier proposals without replacing their details', async () => {
    const proposals = [1,2,3].map(n => ({id:`p${n}`,name:`方案${n}`,concept:`概念${n}`,style:'modern',highlights:['亮点'],regionUsage:[{regionId:'r1',usage:'主展台',priority:'primary'}],mainInstallation:'主装置',visualElements:{primaryColor:'#000',materials:['木'],lighting:'暖光'},flowDesign:'环形',estimatedCost:'¥100',renderPromptHint:'display',pros:['可行'],cons:['成本'],customMetadata:'原始细节'}));
    fixture.content = JSON.stringify({proposals});
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[{id:'r1',name:'入口',type:'entrance',position:'左侧'}],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'completed')).toBe(true));
    expect(fixture.updates.find(item => item.status === 'completed')?.result).toEqual({proposals,type:'venue-proposals'});
  });

  it.each(['duplicate-ids','invalid-highlights'])('rejects otherwise complete proposals with %s', async reason => {
    const proposals = [1,2,3].map(n => ({id:`p${n}`,name:`方案${n}`,concept:`概念${n}`,style:'modern',highlights:['亮点'],regionUsage:[],mainInstallation:'主装置',visualElements:{primaryColor:'#000',materials:['木'],lighting:'暖光'},flowDesign:'环形',estimatedCost:'¥100',renderPromptHint:'display',pros:['可行'],cons:['成本']}));
    if (reason === 'duplicate-ids') proposals[1].id = proposals[0].id;
    else (proposals[1] as unknown as {highlights:unknown[]}).highlights = [{}];
    fixture.content = JSON.stringify({proposals});
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'failed' || item.status === 'completed')).toBe(true));
    expect(fixture.updates.some(item => item.status === 'completed')).toBe(false);
  });

  it('provides real venue region identifiers to the supplier and retains valid references', async () => {
    const proposals = [1,2,3].map(n => ({id:`p${n}`,name:`方案${n}`,concept:`概念${n}`,style:'modern',highlights:['亮点'],regionUsage:[{regionId:'zone-actual',usage:'主展台',priority:'primary'}],mainInstallation:'主装置',visualElements:{primaryColor:'#000',materials:['木'],lighting:'暖光'},flowDesign:'环形',estimatedCost:'¥100',renderPromptHint:'display',pros:['可行'],cons:['成本']}));
    fixture.content=JSON.stringify({proposals});
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[{id:'zone-actual',name:'入口',type:'entrance',position:'左侧'}],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'completed')).toBe(true));
    const prompt = fixture.requests[0].messages?.find(message => message.role === 'user')?.content;
    expect(prompt).toContain('zone-actual');
    expect(prompt).not.toContain('"regionId": "r1"');
    expect(prompt).not.toContain('"regionId": "r2"');
    expect(fixture.updates.find(item => item.status === 'completed')?.result).toEqual({proposals,type:'venue-proposals'});
  });

  it('does not publish proposals that refer to a region outside the analyzed venue', async () => {
    const proposals = [1,2,3].map(n => ({id:`p${n}`,name:`方案${n}`,concept:`概念${n}`,style:'modern',highlights:['亮点'],regionUsage:[{regionId:'invented-zone',usage:'主展台',priority:'primary'}],mainInstallation:'主装置',visualElements:{primaryColor:'#000',materials:['木'],lighting:'暖光'},flowDesign:'环形',estimatedCost:'¥100',renderPromptHint:'display',pros:['可行'],cons:['成本']}));
    fixture.content=JSON.stringify({proposals});
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[{id:'zone-actual',name:'入口',type:'entrance',position:'左侧'}],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'failed' || item.status === 'completed')).toBe(true));
    expect(fixture.updates.some(item => item.status === 'completed')).toBe(false);
  });

  it('retains complete proposals with no region references when none are available', async () => {
    const proposals = [1,2,3].map(n => ({id:`p${n}`,name:`方案${n}`,concept:`概念${n}`,style:'modern',highlights:['亮点'],regionUsage:[],mainInstallation:'主装置',visualElements:{primaryColor:'#000',materials:['木'],lighting:'暖光'},flowDesign:'环形',estimatedCost:'¥100',renderPromptHint:'display',pros:['可行'],cons:['成本']}));
    fixture.content=JSON.stringify({proposals});
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(item => item.status === 'completed')).toBe(true));
    expect(fixture.updates.find(item => item.status === 'completed')?.result).toEqual({proposals,type:'venue-proposals'});
    expect(fixture.requests[0].messages?.find(message => message.role === 'user')?.content).toContain('"regionUsage": []');
  });

  it('uses the selected model for venue proposal generation', async () => {
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(fixture.requests[0].model).toBe('vision-two');
  });

  it('rejects unauthenticated venue proposal generation before task creation', async () => {
    fixture.user = null;
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(401);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('rejects venue proposal models not assigned to the user', async () => {
    fixture.user={id:'synthetic-user',name:'synthetic',role:'user',status:'active',createdAt:1,updatedAt:1,chatModels:['synthetic-provider::vision-one']};
    const proposalRequest = new NextRequest('https://synthetic.invalid/api/activity-venue/proposals', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',venueAnalysis:{regions:[],structuralLimits:[]},activityBrief:{eventName:'合成'}}),
    });
    expect((await submitProposals(proposalRequest)).status).toBe(403);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });
});
