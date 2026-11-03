import {expect,it,vi} from 'vitest';
import {observeWorkflowBackground} from '@/lib/workflow-background';

it('returns the same promise without subscribing to it',async()=>{
 const task=Promise.resolve('completed');const then=vi.spyOn(task,'then');
 expect(observeWorkflowBackground(task)).toBe(task);
 expect(then).not.toHaveBeenCalled();then.mockRestore();
 await expect(task).resolves.toBe('completed');
});
it('returns the same rejecting promise without changing its error',async()=>{
 const error=new Error('synthetic background failure');const task=Promise.reject(error);
 expect(observeWorkflowBackground(task)).toBe(task);
 await expect(task).rejects.toBe(error);
});
