import {z} from 'zod';
import {assertWorkflowImageGridShape} from './workflow-image-actions';

export interface WorkflowImageGridActionRequest {
  action:'grid';projectId:string;workspaceId:string;sourceNodeId:string;operationId:string;
  columns:number;rows:number;targetNodeIds:string[];
  source:{projectId?:string;assetId?:string;assetVersionId?:string;placementId?:string;imageUrl?:string};
}
export class WorkflowImageActionRequestError extends Error {
  readonly code='WORKFLOW_IMAGE_ACTION_INVALID';constructor(){super('WORKFLOW_IMAGE_ACTION_INVALID');}
}
const id=z.string().min(1).max(256).refine((value:string):boolean=>value.trim()===value&&!/\p{Cc}/u.test(value));
const sourceSchema=z.object({projectId:id.optional(),assetId:id.optional(),assetVersionId:id.optional(),placementId:id.optional(),
  imageUrl:z.string().min(1).max(48*1024*1024).optional()}).strict();
const requestSchema=z.object({action:z.literal('grid'),projectId:id,workspaceId:id,sourceNodeId:id,operationId:id,
  columns:z.number().int().min(1).max(64),rows:z.number().int().min(1).max(64),
  targetNodeIds:z.array(id).min(1).max(64),source:sourceSchema}).strict();
/** Parsing is not project/asset authorization; the original source reader and
 * final transaction must still validate the actual actor and current grant. */
export function parseWorkflowImageGridAction(value:unknown):WorkflowImageGridActionRequest {
  const parsed=requestSchema.safeParse(value);
  if(!parsed.success)throw new WorkflowImageActionRequestError();
  const input=parsed.data;
  try{assertWorkflowImageGridShape(input.columns,input.rows);}catch{throw new WorkflowImageActionRequestError();}
  if(input.targetNodeIds.length!==input.columns*input.rows||new Set(input.targetNodeIds).size!==input.targetNodeIds.length
    ||input.targetNodeIds.includes(input.sourceNodeId)||input.source.projectId!==undefined&&input.source.projectId!==input.projectId
    ||!input.source.assetVersionId&&(!input.source.imageUrl||input.source.assetId||input.source.placementId))
    throw new WorkflowImageActionRequestError();
  return input;
}
