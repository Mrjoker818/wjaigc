// Tracks actual settlement separately from the caller's deadline.
import {performance} from 'node:perf_hooks';

export interface OwnedOperationRecord { name: string; deadline: number; settled: boolean; timedOut: boolean; rejected: boolean }
export interface OwnedLateError { name: string; message: string }
export interface OwnedOperationsSnapshot { pending: string[]; lateErrors: OwnedLateError[]; operations: OwnedOperationRecord[] }
export interface OwnedOperations {
  run<T>(name: string, operation: () => T | Promise<T>, timeoutMs?: number): Promise<T>;
  pendingPromises(): Promise<unknown>[];
  snapshot(): OwnedOperationsSnapshot;
}

export function createOwnedOperations(): OwnedOperations {
  const operations: OwnedOperationRecord[]=[], pending=new Map<OwnedOperationRecord, Promise<unknown>>(), lateErrors: OwnedLateError[]=[];
  return {
    async run<T>(name: string, operation: () => T | Promise<T>, timeoutMs=2500): Promise<T> {
      const deadline=performance.now()+timeoutMs;
      const record={name,deadline,settled:false,timedOut:false,rejected:false};
      const expired=(): boolean=>performance.now()>=deadline;
      const timeout=(): Error=>{record.timedOut=true;return Error('MC_OPERATION_TIMEOUT '+name);};
      operations.push(record);
      const actual=Promise.resolve().then(()=>{
        if(expired())throw timeout();
        return operation();
      }).then(value=>{
        if(expired())record.timedOut=true;
        record.settled=true;pending.delete(record);return value;
      },error=>{
        if(expired())record.timedOut=true;
        record.settled=true;record.rejected=true;pending.delete(record);
        if(record.timedOut)lateErrors.push({name,message:error instanceof Error?error.message:String(error)});
        throw error;
      });
      pending.set(record,actual);
      // The race propagates ordinary failures; late failures are retained and fail the resource gate.
      void actual.catch(()=>{});
      const accepted=actual.then(value=>{if(expired())throw timeout();return value;});
      void accepted.catch(()=>{});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {return await Promise.race([accepted,new Promise<never>((_,reject)=>{
        const expire=()=>{
          const remaining=deadline-performance.now();
          if(remaining>0){timer=setTimeout(expire,Math.ceil(remaining));return;}
          reject(timeout());
        };
        timer=setTimeout(expire,Math.max(0,Math.ceil(deadline-performance.now())));
      })]);}finally{if(timer)clearTimeout(timer);}
    },
    pendingPromises(): Promise<unknown>[] {return [...pending.values()];},
    snapshot(): OwnedOperationsSnapshot {return {pending:[...pending.keys()].map(record=>record.name),lateErrors:structuredClone(lateErrors),operations:structuredClone(operations)};}
  };
}
export async function acquireOwned<T>(tracker: OwnedOperations,name: string,acquire: () => Promise<T>,dispose: (value: T) => Promise<unknown>,shouldClose: () => boolean,timeoutMs=2500): Promise<T>{
  return tracker.run(name,async()=>{
    const value=await acquire();
    if(shouldClose())await tracker.run(name+':late-dispose',()=>dispose(value));
    return value;
  },timeoutMs);
}


