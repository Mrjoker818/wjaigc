/** Browser display bookkeeping only. Tasks, authorization and frozen execution
 * context remain authoritative on the server. No client results are submitted. */
export interface WorkflowImageRetryView {
  version:1;
  rootExecutionId:string;
  contextExecutionId:string;
  nodeExecutionIds:Record<string,string>;
  active?:{nodeId:string;executionId:string};
  pending?:{nodeId:string;sourceExecutionId:string};
}
export interface WorkflowImageRetryResult {status:string;output?:Record<string,unknown>;error?:string}
export interface WorkflowImageRetrySnapshot {
  status:'running'|'paused'|'completed'|'failed'|'cancelled';
  result?:WorkflowImageRetryResult;
  error?:string;
}
export function workflowImageRetryRecord(value:unknown):Record<string,unknown>|undefined {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
function id(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);}
export function readWorkflowImageRetryView(raw:unknown,displayedExecutionId:unknown):WorkflowImageRetryView|null {
  const value=workflowImageRetryRecord(raw),mapping=workflowImageRetryRecord(value?.nodeExecutionIds);
  if(!value||value.version!==1||!id(value.rootExecutionId)||!id(value.contextExecutionId)||!mapping)return null;
  const entries=Object.entries(mapping);if(entries.some(([node,execution])=>!id(node)||!id(execution)))return null;
  const nodeExecutionIds=Object.fromEntries(entries) as Record<string,string>;
  // A second attempt replaces its node mapping while the prior confirmed
  // execution remains the independent cumulative context until settlement.
  const view:WorkflowImageRetryView={version:1,rootExecutionId:value.rootExecutionId,contextExecutionId:value.contextExecutionId,nodeExecutionIds};
  if(value.active!==undefined){
    const active=workflowImageRetryRecord(value.active);
    if(!active||!id(active.nodeId)||!id(active.executionId)||active.executionId!==displayedExecutionId
      ||nodeExecutionIds[active.nodeId]!==active.executionId||active.executionId===view.contextExecutionId)return null;
    view.active={nodeId:active.nodeId,executionId:active.executionId};
  }
  if(value.pending!==undefined){
    const pending=workflowImageRetryRecord(value.pending);
    if(view.active||!pending||!id(pending.nodeId)||!id(pending.sourceExecutionId)||pending.sourceExecutionId!==view.contextExecutionId)return null;
    view.pending={nodeId:pending.nodeId,sourceExecutionId:pending.sourceExecutionId};
  }
  return view;
}
export function beginWorkflowImageRetry(view:WorkflowImageRetryView|null,executionId:string,nodeId:string):WorkflowImageRetryView {
  if(!id(executionId)||!id(nodeId)||view?.active||view?.pending&&view.pending.nodeId!==nodeId)throw new Error('请先核对当前图片重试任务');
  const base=view??{version:1,rootExecutionId:executionId,contextExecutionId:executionId,nodeExecutionIds:{}};
  return {...base,pending:{nodeId,sourceExecutionId:base.pending?.sourceExecutionId??base.contextExecutionId}};
}
export function acceptWorkflowImageRetry(view:WorkflowImageRetryView,executionId:unknown,nodeId:unknown):WorkflowImageRetryView {
  const pending=view.pending;
  if(!pending||nodeId!==pending.nodeId||!id(executionId)||executionId===pending.sourceExecutionId)throw new Error('图片重试回执尚未确认，请核对原请求');
  const {pending:omitted,...base}=view;void omitted;
  return {...base,nodeExecutionIds:{...base.nodeExecutionIds,[pending.nodeId]:executionId},active:{nodeId:pending.nodeId,executionId}};
}
export function finishWorkflowImageRetry(view:WorkflowImageRetryView):WorkflowImageRetryView {
  if(!view.active)throw new Error('图片重试身份不完整');
  const {active,pending:omitted,...base}=view;void omitted;
  return {...base,contextExecutionId:active.executionId};
}
export function readWorkflowImageRetrySnapshot(raw:unknown,executionId:string,nodeId:string):WorkflowImageRetrySnapshot {
  const value=workflowImageRetryRecord(raw),results=workflowImageRetryRecord(value?.results);
  if(!value||value.executionId!==executionId||value.results!==undefined&&!results
    ||!['running','paused','completed','failed','cancelled'].includes(String(value.status)))throw new Error('图片重试状态尚未确认');
  const status=value.status as WorkflowImageRetrySnapshot['status'],entry=workflowImageRetryRecord(results?.[nodeId]);
  let result:WorkflowImageRetryResult|undefined;
  if(entry){
    if(!['running','paused','success','failed','error','cancelled','timeout','skipped'].includes(String(entry.status)))throw new Error('图片节点结果尚未确认');
    const output=workflowImageRetryRecord(entry.output);
    if(entry.status==='success'&&(!output||typeof output.imageUrl!=='string'||!output.imageUrl))throw new Error('图片节点结果尚未确认');
    result={status:String(entry.status),...(output?{output}:{}),...(typeof entry.error==='string'?{error:entry.error}:{})};
  }
  if(status==='completed'&&result?.status!=='success')throw new Error('图片重试完成回执缺少节点结果');
  if(!result&&(status==='failed'||status==='cancelled'))result={status,error:typeof value.error==='string'?value.error:status==='cancelled'?'用户取消':'图片重试未完成'};
  return {status,...(result?{result}:{}),...(typeof value.error==='string'?{error:value.error}:{})};
}
