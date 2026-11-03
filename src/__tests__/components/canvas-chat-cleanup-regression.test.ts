// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { canvasTransferContractFixture, contractReference, contractSecondReference, withContractOperation } from '../helpers/canvas-chat-transfer-contract-fixture';
afterEach(() => vi.unstubAllGlobals());

async function drive<T>(operation:Promise<T>,entered:Promise<void>,release:()=>void,action:()=>Promise<void>):Promise<void>{
  await withContractOperation(operation,release,async observed=>{await observed.waitForEntry(entered);await action();release();await observed.unwrap();}, { forceRelease: release });
}

it('early rejection reaches caller without waiting for an entry that cannot happen',async()=>{
  const f=canvasTransferContractFixture({pause:'flush'}),failure=Error('SYNTHETIC_EARLY_FAILURE');
  vi.stubGlobal('fetch',async()=>{throw failure;});
  const op=f.batch([contractReference,contractSecondReference],{runId:'run-a'});
  const run=drive(op,f.entered,f.release,async()=>{}).then(()=>null,error=>error);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const seen=await Promise.race([run,new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('STUCK_BEFORE_ENTRY'),250);})]);
    expect(seen).toBe(failure);expect(f.writes).toEqual([]);expect(f.saves).toEqual([]);
  }finally{if(timer)clearTimeout(timer);f.release();await op.catch(()=>undefined);}
});

it('midpoint failure releases the real operation, waits for its settlement, and keeps the original error',async()=>{
  const f=canvasTransferContractFixture({pause:'flush'}),failure=Error('SYNTHETIC_MIDPOINT_FAILURE');
  const op=f.batch([contractReference,contractSecondReference],{runId:'run-a'});let settled=false;
  const tracked=op.then(()=>{settled=true;},()=>{settled=true;});
  try{
    const run=drive(op,f.entered,f.release,async()=>{throw failure;});
    await expect(run).rejects.toBe(failure);
    expect(settled).toBe(true);
  }finally{f.release();await tracked;}
});
it('keeps both the primary error and a release error after the real operation settles',async()=>{
  const f=canvasTransferContractFixture({pause:'flush'}),primary=Error('PRIMARY'),releaseFailure=Error('RELEASE');
  const operation=f.batch([contractReference,contractSecondReference],{runId:'run-a'});let settled=false;
  const tracked=operation.then(()=>{settled=true;},()=>{settled=true;});
  try{
    const run=withContractOperation(operation,()=>{f.release();throw releaseFailure;},async observed=>{
      await observed.waitForEntry(f.entered);throw primary;
    }, { forceRelease: f.forceRelease });
    await expect(run).rejects.toMatchObject({cause:primary,errors:[primary,releaseFailure]});
    expect(settled).toBe(true);
  }finally{f.release();await tracked;}
});