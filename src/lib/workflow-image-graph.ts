import {createWorkflowNode,createConnection,canConnectPorts,topologicalSort,type Workflow,type WorkflowNode,type NodePort} from '@/lib/workflow-engine';
import {assertWorkflowImageGridShape,partitionWorkflowImageGrid,type WorkflowImageGridCell} from './workflow-image-actions';
import {readWorkflowImageInputTransform} from './workflow-image-receiver';

export interface WorkflowImageGridPublicationExpectation {
  workspaceId:string;operationId:string;targetNodeIds:readonly string[];parentVersionId?:string;
}

export interface PreparedWorkflowImageTile {
  nodeId?:string;
  cell:WorkflowImageGridCell;
  reference:{projectId:string;assetId:string;assetVersionId:string;placementId:string;imageUrl:string;entityId?:string};
}

/** Pure client graph composition, never asset authorization or a COMMIT receipt. */
export function planPublishedWorkflowImageGrid(workflow:Workflow,nodeId:string,projectId:string,columns:number,rows:number,
  publication:unknown,expected:WorkflowImageGridPublicationExpectation):Workflow {
  assertWorkflowImageGridShape(columns,rows);
  const value=publicationRecord(publication);
  if(!value)publicationInvalid();
  if(value.projectId!==projectId)throw new TypeError('WORKFLOW_IMAGE_ACTION_PROJECT');
  if(!expected||!validTargetId(expected.workspaceId)||!validTargetId(expected.operationId)
    ||workflow.id!==expected.workspaceId||value.workspaceId!==expected.workspaceId||value.operationId!==expected.operationId
    ||!Array.isArray(expected.targetNodeIds)||expected.targetNodeIds.length!==columns*rows
    ||new Set(expected.targetNodeIds).size!==expected.targetNodeIds.length
    ||!validTargetId(value.parentVersionId)||expected.parentVersionId!==undefined
      &&(!validTargetId(expected.parentVersionId)||expected.parentVersionId!==value.parentVersionId)
    ||value.documentSequence!==undefined&&(!Number.isSafeInteger(value.documentSequence)||Number(value.documentSequence)<0)
    ||!Array.isArray(value.tiles)||value.tiles.length!==expected.targetNodeIds.length)publicationInvalid();
  for(let index=0;index<expected.targetNodeIds.length;index++)if(!validTargetId(expected.targetNodeIds[index]))publicationInvalid();
  const tiles:PreparedWorkflowImageTile[]=value.tiles.map((raw,index)=>{
    const tile=publicationRecord(raw),reference=publicationRecord(tile?.reference),cell=publicationRecord(tile?.cell);
    if(!tile||!validTargetId(tile.nodeId)||tile.nodeId!==expected.targetNodeIds[index]||!reference||reference.kind!=='image'
      ||!['assetId','assetVersionId','placementId','entityId'].every(key=>validTargetId(reference[key]))
      ||typeof reference.url!=='string'||!reference.url.trim()||reference.url.trim()!==reference.url||!cell
      ||!['index','column','row','columns','rows','left','top','width','height'].every(key=>
        Number.isSafeInteger(cell[key])&&Number(cell[key])>=0)||Number(cell.width)<1||Number(cell.height)<1)publicationInvalid();
    return {nodeId:expected.targetNodeIds[index],cell:structuredClone(cell) as unknown as WorkflowImageGridCell,
      reference:{projectId,assetId:reference.assetId as string,assetVersionId:reference.assetVersionId as string,
        placementId:reference.placementId as string,entityId:reference.entityId as string,imageUrl:reference.url}};
  });
  // This adapter deliberately selects the client-safe tuple. A server publication
  // value's canvas entity ID must never be substituted for its target node ID.
  return planPreparedWorkflowImageGrid(workflow,nodeId,projectId,columns,rows,tiles);
}

function publicationRecord(value:unknown):Record<string,unknown>|undefined {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
function validTargetId(value:unknown):value is string {
  return typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);
}
function publicationInvalid():never {throw new TypeError('WORKFLOW_IMAGE_ACTION_PUBLICATION');}

function nonempty(value:unknown):value is string {return typeof value==='string'&&value.trim().length>0;}

function sourceNode(workflow:Workflow,nodeId:string,projectId:string):WorkflowNode {
  const matches=workflow.nodes.filter(node=>node.id===nodeId),node=matches[0];
  if(matches.length!==1||new Set(workflow.nodes.map(item=>item.id)).size!==workflow.nodes.length
    ||!Number.isFinite(node.x)||!Number.isFinite(node.y))throw new TypeError('WORKFLOW_IMAGE_ACTION_INVALID');
  if(!nonempty(projectId)||(node.config.projectId!==undefined&&node.config.projectId!==''&&node.config.projectId!==projectId))
    throw new TypeError('WORKFLOW_IMAGE_ACTION_PROJECT');
  return node;
}

function imageOutput(node:WorkflowNode):NodePort {
  const ports=node.ports.filter(port=>port.direction==='out'&&port.type==='image');
  if(ports.length!==1||node.ports.filter(port=>port.id===ports[0].id).length!==1)throw new TypeError('WORKFLOW_IMAGE_ACTION_PORT');
  return ports[0];
}

function receiverPorts(node:WorkflowNode):NodePort[] {
  const existing=node.ports.filter(port=>port.id==='in-image');
  if(existing.length>1||(existing.length===1&&(existing[0].type!=='image'||existing[0].direction!=='in')))
    throw new TypeError('WORKFLOW_IMAGE_ACTION_PORT');
  return existing.length?structuredClone(node.ports):[{id:'in-image',label:'原图',type:'image',direction:'in'},...structuredClone(node.ports)];
}

function assertNewId(id:string,ids:Set<string>):void {
  if(ids.has(id))throw new Error('WORKFLOW_IMAGE_ACTION_ID_COLLISION');
  ids.add(id);
}

/** Pure complete plan; the editor rechecks scope/source before one history commit. */
export function planWorkflowImageExtraction(workflow:Workflow,nodeId:string,projectId:string):Workflow {
  const node=sourceNode(workflow,nodeId,projectId);
  if(node.type!=='input-image'||(!nonempty(node.config.imageUrl)&&!nonempty(node.config.assetVersionId)))throw new TypeError('WORKFLOW_IMAGE_ACTION_INVALID');
  const output=imageOutput(node),ports=receiverPorts(node),transform=readWorkflowImageInputTransform(node);
  const incoming=workflow.connections.filter(connection=>connection.toNodeId===nodeId);
  if(!transform&&incoming.length)throw new TypeError('WORKFLOW_IMAGE_ACTION_PORT');
  if(transform){
    if(!node.ports.some(port=>port.id==='in-image'&&port.direction==='in'&&port.type==='image'))throw new TypeError('WORKFLOW_IMAGE_ACTION_PORT');
    const blocking=node.config.blockedInputs;
    if(blocking!==undefined&&(!Array.isArray(blocking)||!blocking.every(nonempty)))throw new TypeError('WORKFLOW_IMAGE_ACTION_INVALID');
    const active=incoming.filter(connection=>!(blocking as string[]|undefined)?.includes(connection.id));
    if(active.length!==1)throw new TypeError('WORKFLOW_IMAGE_ACTION_PORT');
    for(const connection of incoming){
      const upstream=workflow.nodes.filter(item=>item.id===connection.fromNodeId);
      const upstreamPorts=upstream[0]?.ports.filter(port=>port.id===connection.fromPortId)??[];
      if(connection.fromNodeId===nodeId||upstream.length!==1||upstreamPorts.length!==1||upstreamPorts[0].direction!=='out'
        ||connection.toPortId!=='in-image'||connection.type!==upstreamPorts[0].type||!canConnectPorts(upstreamPorts[0].type,'image'))
        throw new TypeError('WORKFLOW_IMAGE_ACTION_PORT');
    }
  }
  const source=createWorkflowNode('input-image',node.x-280,node.y,'源图');
  assertNewId(source.id,new Set(workflow.nodes.map(item=>item.id)));
  source.config={...structuredClone(node.config),label:'源图'};source.ports=structuredClone(node.ports);
  const config:WorkflowNode['config']={...structuredClone(node.config),source:'upstream',imageInputTransform:{version:1,kind:'identity'}};
  delete config.blockedInputs;
  const receiver={...node,ports,config},edge=createConnection(source.id,output.id,node.id,'in-image','image');
  assertNewId(edge.id,new Set(workflow.connections.map(connection=>connection.id)));
  const nodes=[...workflow.nodes.map(item=>item.id===nodeId?receiver:item),source];
  const connections=[...workflow.connections.map(connection=>connection.toNodeId===nodeId?{...connection,toNodeId:source.id}:connection),edge];
  topologicalSort(nodes,connections);
  return {...workflow,nodes,connections,updatedAt:Date.now()};
}

/** Accept complete prepared references only; this function is never an authorization decision. */
export function planPreparedWorkflowImageGrid(workflow:Workflow,nodeId:string,projectId:string,columns:number,rows:number,tiles:readonly PreparedWorkflowImageTile[]):Workflow {
  assertWorkflowImageGridShape(columns,rows);
  const source=sourceNode(workflow,nodeId,projectId),output=imageOutput(source);
  if(!Array.isArray(tiles)||tiles.length!==columns*rows)throw new TypeError('WORKFLOW_IMAGE_ACTION_TILES');
  const last=tiles[tiles.length-1]?.cell;
  if(!last)throw new TypeError('WORKFLOW_IMAGE_ACTION_TILES');
  let expected:WorkflowImageGridCell[];
  try {expected=partitionWorkflowImageGrid(last.left+last.width,last.top+last.height,columns,rows);}
  catch {throw new TypeError('WORKFLOW_IMAGE_ACTION_TILES');}
  const versions=new Set<string>(),placements=new Set<string>();
  for(let index=0;index<tiles.length;index++){
    const tile=tiles[index],reference=tile?.reference,cell=tile?.cell;
    if(!cell||!reference||Object.entries(expected[index]).some(([key,value])=>cell[key as keyof WorkflowImageGridCell]!==value))
      throw new TypeError('WORKFLOW_IMAGE_ACTION_TILES');
    if(reference.projectId!==projectId)throw new TypeError('WORKFLOW_IMAGE_ACTION_PROJECT');
    if(tile.nodeId!==undefined&&!validTargetId(tile.nodeId))throw new TypeError('WORKFLOW_IMAGE_ACTION_TILES');
    if(![reference.assetId,reference.assetVersionId,reference.placementId,reference.imageUrl].every(nonempty)
      ||versions.has(reference.assetVersionId)||placements.has(reference.placementId))throw new TypeError('WORKFLOW_IMAGE_ACTION_TILES');
    versions.add(reference.assetVersionId);placements.add(reference.placementId);
  }
  const nodeIds=new Set(workflow.nodes.map(node=>node.id)),edgeIds=new Set(workflow.connections.map(edge=>edge.id));
  const added:WorkflowNode[]=[],connections=[...workflow.connections];
  for(const tile of tiles){
    const cell=tile.cell,node=createWorkflowNode('input-image',source.x+(cell.column-1)*260,source.y+260+cell.row*200,`切分 ${cell.index+1}`);
    if(tile.nodeId!==undefined)node.id=tile.nodeId;
    if(!Number.isFinite(node.x)||!Number.isFinite(node.y))throw new TypeError('WORKFLOW_IMAGE_ACTION_INVALID');
    assertNewId(node.id,nodeIds);node.ports=receiverPorts(node);
    node.config={...node.config,...structuredClone(tile.reference),label:`切分 ${cell.index+1}`,source:'upstream',gridIndex:cell.index+1,gridCol:cell.column+1,gridRow:cell.row+1,
      imageInputTransform:{version:1,kind:'grid',columns,rows,column:cell.column,row:cell.row}};
    const edge=createConnection(source.id,output.id,node.id,'in-image','image');assertNewId(edge.id,edgeIds);added.push(node);connections.push(edge);
  }
  const nodes=[...workflow.nodes,...added];topologicalSort(nodes,connections);
  return {...workflow,nodes,connections,updatedAt:Date.now()};
}
