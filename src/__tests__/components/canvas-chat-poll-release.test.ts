// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { canvasTransferContractFixture, contractReference, contractSecondReference, contractDeferred, observeContractOperation, withContractOperation, waitForContractEntry, type ObservedContractOperation } from '../helpers/canvas-chat-transfer-contract-fixture';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('early rejection leaves no polling after the actual operation settles',async()=>{
  const failure=Error('EARLY_REJECTION'),entry=contractDeferred<void>();let checks=0;
  const observed=observeContractOperation(Promise.reject(failure));
  const scheduled=vi.spyOn(globalThis,'setTimeout'),cancelled=vi.spyOn(globalThis,'clearTimeout');
  const wait=async (o:ObservedContractOperation<never>):Promise<void>=>{
    await waitForContractEntry(o,entry.promise,()=>{checks++;throw Error('NOT_ENTERED');});
  };
  try {
    await expect(wait(observed)).rejects.toBe(failure);
    const timeoutIndex=scheduled.mock.calls.findIndex(call=>call[1]===1000);
    expect(timeoutIndex).toBeGreaterThanOrEqual(0);
    expect(cancelled).toHaveBeenCalledWith(scheduled.mock.results[timeoutIndex].value);
    const atRejection=checks;await new Promise<void>(resolve=>setTimeout(resolve,130));
    expect(checks,'no polling may survive the early rejection').toBe(atRejection);
  } finally {entry.release();await observed.settled;}
});

it('release throwing before opening the gate still ends the real operation and preserves both errors',async()=>{
  const f=canvasTransferContractFixture({pause:'flush'}),primary=Error('PRIMARY'),releaseFailure=Error('RELEASE_BEFORE_GATE');
  const operation=f.batch([contractReference,contractSecondReference],{runId:'run-a'});let finished=false;
  const handled=operation.then(()=>{finished=true;},()=>{finished=true;});
  const run=withContractOperation(operation,()=>{throw releaseFailure;},async observed=>{await observed.waitForEntry(f.entered);throw primary;},{forceRelease:f.forceRelease});
  const outcome=run.then(()=>null,error=>error);let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const value=await Promise.race([outcome,new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('STUCK_AFTER_RELEASE_FAILURE'),250);})]);
    expect(value).toBeInstanceOf(AggregateError);expect(value).toMatchObject({cause:primary,errors:[primary,releaseFailure]});expect(finished).toBe(true);
  }finally{if(timer)clearTimeout(timer);f.release();await outcome;await handled;}
});
