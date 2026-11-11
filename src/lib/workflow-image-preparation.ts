import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import type {AssetFile,AssetVersion} from '@/lib/asset-core/types';
import {persistAssetBytes,type PersistedAssetFile} from '@/lib/asset-core/binary-persistence';
import {readManagedAssetVersionBytes} from '@/lib/asset-core/managed-media-read';
import {IMAGE_IMPORT_LIMIT,readMediaBody} from '@/lib/collaboration/document-media-request';
import {prepareUploadedMedia,importedMediaIdentity,type PreparedImportedMedia} from '@/lib/collaboration/document-media-source';
import {assertWorkflowImageGridShape,type WorkflowImageGridCell} from './workflow-image-actions';
import {cropWorkflowImageGrid,cropWorkflowImageGridCell,WORKFLOW_IMAGE_GRID_LIMITS} from './workflow-image-grid';
import {readWorkflowImageMediaForActor,workflowImageMediaIdentity,assertWorkflowImageMediaSourceInTransaction,
  type WorkflowImageMediaInput,type WorkflowImageMediaIdentity,type WorkflowImageMediaSource} from './workflow-image-media';
export interface WorkflowImageGridPreparationInput extends WorkflowImageMediaInput {columns:number;rows:number;operationId:string;targetNodeIds:readonly string[]}
export interface WorkflowImageCellPreparationInput extends WorkflowImageMediaInput {columns:number;rows:number;column:number;row:number;operationId:string;targetNodeId:string}
declare const cellBrand:unique symbol;
export interface PreparedWorkflowImageCell {readonly [cellBrand]:true}
export interface WorkflowImageCellPreparationIdentity {
  input:WorkflowImageCellPreparationInput;source:WorkflowImageMediaIdentity;legacyParentFile?:AssetFile;
  tile:{targetNodeId:string;cell:WorkflowImageGridCell;file:AssetFile};
}
export async function prepareAndPublishWorkflowImageCell<T>(input:WorkflowImageCellPreparationInput,publish:(prepared:PreparedWorkflowImageCell,signal:AbortSignal)=>Promise<WorkflowImageGridPublication<T>>,options:WorkflowImageGridPreparationOptions={}):Promise<Exclude<WorkflowImageGridPublication<T>,{status:'rolled-back'}>> {
  options.signal?.throwIfAborted();
  if(!input||typeof publish!=='function'||!id(input.targetNodeId))invalid();
  assertWorkflowImageGridShape(input.columns,input.rows);
  if(!Number.isSafeInteger(input.column)||!Number.isSafeInteger(input.row)||input.column<0||input.row<0
    ||input.column>=input.columns||input.row>=input.rows)invalid();
  const {column,row,targetNodeId,...base}=structuredClone(input);
  return prepareSelectedWorkflowImageGrid({...base,targetNodeIds:[targetNodeId]},async(grid,signal)=>{
    // The private core's grid handle never escapes through the cell capability.
    // Whole-grid publishers therefore cannot accept a runtime replacement input.
    const prepared=Object.freeze({}) as PreparedWorkflowImageCell;
    cellPreparations.set(prepared,{grid,column,row,targetNodeId});
    try{return await publish(prepared,signal);}finally{cellPreparations.delete(prepared);}
  },options,{column,row});
}
export function workflowImageCellPreparationIdentity(prepared:PreparedWorkflowImageCell):WorkflowImageCellPreparationIdentity {
  const record=cellRecord(prepared),identity=workflowImageGridPreparationIdentity(record.grid),{targetNodeIds,...input}=identity.input;
  if(identity.tiles.length!==1||targetNodeIds.length!==1||targetNodeIds[0]!==record.targetNodeId
    ||identity.tiles[0].targetNodeId!==record.targetNodeId||identity.tiles[0].cell.column!==record.column||identity.tiles[0].cell.row!==record.row)invalid();
  return {input:{...input,column:record.column,row:record.row,targetNodeId:record.targetNodeId},source:identity.source,
    ...(identity.legacyParentFile?{legacyParentFile:identity.legacyParentFile}:{}),tile:identity.tiles[0]};
}
export function workflowImageCellDocumentMedia(prepared:PreparedWorkflowImageCell):PreparedImportedMedia {return workflowImageGridDocumentMedia(cellRecord(prepared).grid,0);}
export async function assertWorkflowImageCellPreparationInTransaction(client:PoolClient,prepared:PreparedWorkflowImageCell,signal?:AbortSignal):Promise<void> {
  await assertWorkflowImageGridPreparationInTransaction(client,cellRecord(prepared).grid,signal);
}
declare const gridBrand:unique symbol;
export interface PreparedWorkflowImageGrid {readonly [gridBrand]:true}
export interface WorkflowImageGridPreparationIdentity {
  input:WorkflowImageGridPreparationInput;source:WorkflowImageMediaIdentity;
  legacyParentFile?:AssetFile;
  tiles:Array<{targetNodeId:string;cell:WorkflowImageGridCell;file:AssetFile}>;
}
export type WorkflowImageGridPublication<T>={status:'committed';value:T;retainedFileUrls?:readonly string[];cleanupErrors?:readonly unknown[]}|{status:'rolled-back';error:unknown}|{status:'unknown';error:unknown};
export interface WorkflowImageGridPreparationOptions {signal?:AbortSignal;timeoutMs?:number;persistBytes?:typeof persistAssetBytes}
export const WORKFLOW_IMAGE_PREPARATION_LIMITS=Object.freeze({maxJobs:1,timeoutMs:120_000,maxOutputBytes:WORKFLOW_IMAGE_GRID_LIMITS.maxOutputBytes});
interface GridRecord {active:boolean;source:WorkflowImageMediaSource;identity:WorkflowImageGridPreparationIdentity;documentMedia:Map<number,PreparedImportedMedia>;signal:AbortSignal}
const preparations=new WeakMap<PreparedWorkflowImageGrid,GridRecord>();let activeJobs=0;
/** Compare the full canonical read with the immutable file recorded in the receipt. */
export async function workflowImagePublishedMediaMatches(version:AssetVersion,signal:AbortSignal,
  read:typeof readManagedAssetVersionBytes=readManagedAssetVersionBytes):Promise<boolean> {
  signal.throwIfAborted();
  const media=await read(version,'image',{signal});
  signal.throwIfAborted();
  return media.mimeType===version.file.mimeType&&media.bytes.length===version.file.byteSize&&media.totalBytes===media.bytes.length
    &&createHash('sha256').update(media.bytes).digest('hex')===version.file.checksum;
}
/** Share the original preparation admission and real IO lifetime with read-only receipt verification. */
export async function withWorkflowImageReceiptRead<T>(read:(signal:AbortSignal)=>Promise<T>,options:Pick<WorkflowImageGridPreparationOptions,'signal'|'timeoutMs'>={}):Promise<T> {
  options.signal?.throwIfAborted();
  const timeoutMs=options.timeoutMs??WORKFLOW_IMAGE_PREPARATION_LIMITS.timeoutMs;
  if(typeof read!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>WORKFLOW_IMAGE_PREPARATION_LIMITS.timeoutMs)invalid();
  if(activeJobs>=WORKFLOW_IMAGE_PREPARATION_LIMITS.maxJobs)throw new Error('WORKFLOW_IMAGE_PREPARATION_BUSY');
  activeJobs++;
  const deadline=new AbortController(),expiresAt=performance.now()+timeoutMs,error=new Error('WORKFLOW_IMAGE_PREPARATION_TIMEOUT');
  const timer=setTimeout(()=>deadline.abort(error),timeoutMs);timer.unref();
  const signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
  const active=():void=>{if(performance.now()>=expiresAt)deadline.abort(error);signal.throwIfAborted();};
  try{active();const result=await read(signal);active();return result;}
  finally{clearTimeout(timer);activeJobs--;}
}
interface CellRecord {grid:PreparedWorkflowImageGrid;column:number;row:number;targetNodeId:string}
const cellPreparations=new WeakMap<PreparedWorkflowImageCell,CellRecord>();
declare const referenceBrand:unique symbol;
export interface PreparedWorkflowImageReference {readonly [referenceBrand]:true}
export interface WorkflowImageReferencePreparationInput extends WorkflowImageMediaInput {operationId:string}
export interface WorkflowImageReferencePreparationIdentity {input:WorkflowImageReferencePreparationInput;source:WorkflowImageMediaIdentity}
export type WorkflowImageReferencePublication<T>=({status:'committed';value:T}|{status:'rolled-back';error:unknown}|{status:'unknown';error:unknown})&{kind:'reference';connectionErrors?:readonly unknown[]};
interface ReferenceRecord {active:boolean;source:WorkflowImageMediaSource;identity:WorkflowImageReferencePreparationIdentity;signal:AbortSignal}
const referencePreparations=new WeakMap<PreparedWorkflowImageReference,ReferenceRecord>();
function referenceRecord(prepared:PreparedWorkflowImageReference):ReferenceRecord {const record=referencePreparations.get(prepared);if(!record?.active)invalid();return record;}
export function workflowImageReferencePreparationIdentity(prepared:PreparedWorkflowImageReference):WorkflowImageReferencePreparationIdentity {
  return structuredClone(referenceRecord(prepared).identity);
}
export async function assertWorkflowImageReferencePreparationInTransaction(client:PoolClient,prepared:PreparedWorkflowImageReference,signal?:AbortSignal):Promise<void> {
  const record=referenceRecord(prepared);record.signal.throwIfAborted();signal?.throwIfAborted();
  await assertWorkflowImageMediaSourceInTransaction(client,record.source,signal);record.signal.throwIfAborted();signal?.throwIfAborted();
}
/** Fresh bytes are checked outside SQL; this never mints authority from a flag. */
export async function revalidateWorkflowImageReferenceBytes(prepared:PreparedWorkflowImageReference):Promise<void> {
  const record=referenceRecord(prepared);record.signal.throwIfAborted();
  const media=await readWorkflowImageMediaForActor(record.identity.input,record.signal);
  if(!isDeepStrictEqual(workflowImageMediaIdentity(media.source),record.identity.source))throw new Error('WORKFLOW_IMAGE_MEDIA_SOURCE_CHANGED');
  record.source=media.source;record.signal.throwIfAborted();
}
/** Forward the original reference. No crop, persisted copy, new version or placement. */
export async function prepareAndPublishWorkflowImageReference<T>(input:WorkflowImageReferencePreparationInput,publish:(prepared:PreparedWorkflowImageReference,signal:AbortSignal)=>Promise<WorkflowImageReferencePublication<T>>,options:Pick<WorkflowImageGridPreparationOptions,'signal'|'timeoutMs'>={}):Promise<Exclude<WorkflowImageReferencePublication<T>,{status:'rolled-back'}>> {
  options.signal?.throwIfAborted();if(!input||!id(input.operationId)||typeof publish!=='function')invalid();
  const held=structuredClone(input),timeoutMs=options.timeoutMs??WORKFLOW_IMAGE_PREPARATION_LIMITS.timeoutMs;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>WORKFLOW_IMAGE_PREPARATION_LIMITS.timeoutMs)invalid();
  if(activeJobs>=WORKFLOW_IMAGE_PREPARATION_LIMITS.maxJobs)throw new Error('WORKFLOW_IMAGE_PREPARATION_BUSY');activeJobs++;
  const deadline=new AbortController(),expiresAt=performance.now()+timeoutMs,timeoutError=new Error('WORKFLOW_IMAGE_PREPARATION_TIMEOUT');
  const timer=setTimeout(()=>deadline.abort(timeoutError),timeoutMs);timer.unref();
  const signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
  const active=():void=>{if(performance.now()>=expiresAt)deadline.abort(timeoutError);signal.throwIfAborted();};
  let prepared:PreparedWorkflowImageReference|undefined;
  try {
    active();const media=await readWorkflowImageMediaForActor(held,signal);active();
    const source=workflowImageMediaIdentity(media.source);
    if(createHash('sha256').update(media.bytes).digest('hex')!==source.sha256)invalid();
    prepared=Object.freeze({}) as PreparedWorkflowImageReference;
    referencePreparations.set(prepared,{active:true,source:media.source,identity:{input:{...source.input,operationId:held.operationId},source},signal});
    const result=await publish(prepared,signal);
    if(!result||result.kind!=='reference'||!['committed','rolled-back','unknown'].includes(result.status))invalid();
    if(result.status==='rolled-back')throw result.error;
    return result;
  }finally{
    if(prepared){const record=referencePreparations.get(prepared);if(record)record.active=false;referencePreparations.delete(prepared);}
    clearTimeout(timer);activeJobs--;
  }
}
function cellRecord(prepared:PreparedWorkflowImageCell):CellRecord {const record=cellPreparations.get(prepared);if(!record)invalid();return record;}
function invalid():never {throw new TypeError('WORKFLOW_IMAGE_PREPARATION_INVALID');}
function id(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);}
function activeRecord(prepared:PreparedWorkflowImageGrid):GridRecord {const record=preparations.get(prepared);if(!record?.active)invalid();return record;}
function fileDescription(file:PersistedAssetFile):AssetFile {
  const {url,availability,recoverySourceUrl,storageKey,checksum,mimeType,byteSize,width,height}=file;
  return {url,availability,...(recoverySourceUrl===undefined?{}:{recoverySourceUrl}),...(storageKey===undefined?{}:{storageKey}),
    ...(checksum===undefined?{}:{checksum}),...(mimeType===undefined?{}:{mimeType}),...(byteSize===undefined?{}:{byteSize}),
    ...(width===undefined?{}:{width}),...(height===undefined?{}:{height})};
}
function checkedFile(file:PersistedAssetFile,bytes:Buffer,mimeType:string,dimensions?:{width:number;height:number}):AssetFile {
  if(!file||file.availability!=='ready'||file.mimeType!==mimeType||file.byteSize!==bytes.length
    ||file.checksum!==createHash('sha256').update(bytes).digest('hex')
    ||typeof file.createdThisCall!=='boolean'||typeof file.cleanup!=='function'
    ||!/^\/api\/serve-upload\/exports\/[A-Za-z0-9._-]+$/u.test(file.url)
    ||dimensions&&(file.width!==dimensions.width||file.height!==dimensions.height))throw new Error('WORKFLOW_IMAGE_PREPARATION_FILE_INVALID');
  return fileDescription(file);
}
async function cleanup(files:readonly PersistedAssetFile[],retain:ReadonlySet<string>=new Set()):Promise<unknown[]> {
  const errors:unknown[]=[];
  for(const file of files)if(file.createdThisCall===true&&!retain.has(file.url)){
    try {await file.cleanup();}catch(error){errors.push(error);}
  }
  return errors;
}
/** Full local IO lifetime. The server publisher must use the original held project/source
 * fence and its real transaction; this callback is not a client permission boundary.
 * Unknown publication outcomes retain files for that publisher's durable reconciliation. */
export async function prepareAndPublishWorkflowImageGrid<T>(input:WorkflowImageGridPreparationInput,publish:(prepared:PreparedWorkflowImageGrid,signal:AbortSignal)=>Promise<WorkflowImageGridPublication<T>>,options:WorkflowImageGridPreparationOptions={}):Promise<Exclude<WorkflowImageGridPublication<T>,{status:'rolled-back'}>> {
  return prepareSelectedWorkflowImageGrid(input,publish,options);
}
async function prepareSelectedWorkflowImageGrid<T>(input:WorkflowImageGridPreparationInput,publish:(prepared:PreparedWorkflowImageGrid,signal:AbortSignal)=>Promise<WorkflowImageGridPublication<T>>,options:WorkflowImageGridPreparationOptions,selection?:{column:number;row:number}):Promise<Exclude<WorkflowImageGridPublication<T>,{status:'rolled-back'}>> {
  options.signal?.throwIfAborted();
  if(!input||!id(input.operationId)||!Array.isArray(input.targetNodeIds)||typeof publish!=='function')invalid();
  assertWorkflowImageGridShape(input.columns,input.rows);
  if(input.targetNodeIds.length!==(selection?1:input.columns*input.rows)||!input.targetNodeIds.every(id)
    ||new Set(input.targetNodeIds).size!==input.targetNodeIds.length)invalid();
  input=structuredClone(input);
  const timeoutMs=options.timeoutMs??WORKFLOW_IMAGE_PREPARATION_LIMITS.timeoutMs;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>WORKFLOW_IMAGE_PREPARATION_LIMITS.timeoutMs)invalid();
  if(activeJobs>=WORKFLOW_IMAGE_PREPARATION_LIMITS.maxJobs)throw new Error('WORKFLOW_IMAGE_PREPARATION_BUSY');
  activeJobs++;
  const deadline=new AbortController(),expiresAt=performance.now()+timeoutMs,timeoutError=new Error('WORKFLOW_IMAGE_PREPARATION_TIMEOUT');
  const timer=setTimeout(()=>deadline.abort(timeoutError),timeoutMs);timer.unref();
  const signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
  const active=():void=>{signal.throwIfAborted();if(performance.now()>=expiresAt)deadline.abort(timeoutError);signal.throwIfAborted();};
  const files:PersistedAssetFile[]=[],persist=options.persistBytes??persistAssetBytes;
  let record:GridRecord|undefined,phase:'unpublished'|'publishing'|'committed'|'unknown'|'rolled-back'='unpublished';
  try {
    const media=await readWorkflowImageMediaForActor(input,signal);active();
    const source=workflowImageMediaIdentity(media.source);
    const frozen:WorkflowImageGridPreparationInput={...source.input,columns:input.columns,rows:input.rows,operationId:input.operationId,targetNodeIds:input.targetNodeIds.slice()};
    const identity:WorkflowImageGridPreparationIdentity={input:frozen,source,tiles:[]};
    if(createHash('sha256').update(media.bytes).digest('hex')!==source.sha256)invalid();
    const cropOptions={signal,timeoutMs:Math.min(WORKFLOW_IMAGE_GRID_LIMITS.timeoutMs,Math.max(1,Math.floor(expiresAt-performance.now())))};
    const tiles=selection?[await cropWorkflowImageGridCell(media.bytes,frozen.columns,frozen.rows,selection.column,selection.row,cropOptions)]
      :await cropWorkflowImageGrid(media.bytes,frozen.columns,frozen.rows,cropOptions);active();
    if(tiles.length!==frozen.targetNodeIds.length)invalid();
    // Every published PNG must fit the managed-image reader as well as document ingress.
    // Check the whole batch before staging the parent or any tile.
    if(tiles.some(tile=>tile.bytes.length>IMAGE_IMPORT_LIMIT)
      ||tiles.reduce((total,tile)=>total+tile.bytes.length,0)>WORKFLOW_IMAGE_PREPARATION_LIMITS.maxOutputBytes)
      throw new Error('WORKFLOW_IMAGE_GRID_OUTPUT_LIMIT');
    // A real legacy parent file is prepared here; its asset/version must be created
    // together with children inside the publisher's SAME authorized transaction.
    if(!source.version){
      const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/bmp':'bmp'} as Record<string,string>)[media.mimeType];if(!extension)invalid();
      const file=await persist({bytes:media.bytes,mimeType:media.mimeType,filename:'workflow-original.'+extension,signal});files.push(file);active();
      identity.legacyParentFile=checkedFile(file,media.bytes,media.mimeType);
    }
    record={active:false,source:media.source,identity,documentMedia:new Map(),signal};
    for(const [index,tile] of tiles.entries()){
      active();
      let file:PersistedAssetFile;
      if(source.access.kind==='document'){
        // Use the original body and media WeakMaps, not structural casts or an
        // editor impersonating the owner's private version-import API.
        const request=new Request('https://workflow.local.invalid/image-grid',{method:'POST',body:Uint8Array.from(tile.bytes),headers:{'content-length':String(tile.bytes.length)}});
        const body=await readMediaBody(request,IMAGE_IMPORT_LIMIT,signal);active();
        const prepared=await prepareUploadedMedia(body,'image/png',`workflow-grid-${index}.png`,source.access.actorUserId,source.access.ownerId,source.access.projectId,signal);
        file=importedMediaIdentity(prepared).file;record.documentMedia.set(index,prepared);
      } else file=await persist({bytes:tile.bytes,mimeType:'image/png',filename:`workflow-grid-${index}.png`,signal});
      // Capture ownership BEFORE observing late cancellation so that a completed
      // persistence receipt is still compensated on a pre-publication failure.
      files.push(file);active();
      identity.tiles.push({targetNodeId:frozen.targetNodeIds[index],cell:structuredClone(tile.cell),file:checkedFile(file,tile.bytes,'image/png',tile.cell)});
    }
    active();record.active=true;
    const prepared=Object.freeze({}) as PreparedWorkflowImageGrid;preparations.set(prepared,record);phase='publishing';
    let result:WorkflowImageGridPublication<T>;
    try {result=await publish(prepared,signal);}
    catch(error){phase='unknown';return {status:'unknown',error};}
    if(result?.status==='committed'){
      phase='committed';
      if(result.retainedFileUrls!==undefined){
        // A confirmed replay may use earlier files. Clean only unused newly
        // prepared files after the real publisher supplies its exact receipt.
        const retain=new Set(result.retainedFileUrls);
        if(!Array.isArray(result.retainedFileUrls)||retain.size!==result.retainedFileUrls.length
          ||[...retain].some(url=>!files.some(file=>file.url===url)))return {status:'unknown',error:new Error('WORKFLOW_IMAGE_PREPARATION_RECEIPT_INVALID')};
        const errors=await cleanup(files,retain);
        // The original publisher has confirmed COMMIT. Cleanup diagnostics must
        // never turn that durable result into a failed task or discard its refs.
        if(errors.length)return {...result,cleanupErrors:[...(result.cleanupErrors??[]),...errors]};
      }
      // An actual definitive commit wins over cancellation observed afterwards.
      return result;
    }
    if(result?.status==='rolled-back'){phase='rolled-back';throw result.error;}
    phase='unknown';return result?.status==='unknown'?result:{status:'unknown',error:new Error('WORKFLOW_IMAGE_PREPARATION_RECEIPT_INVALID')};
  } catch(error){
    if(phase==='unpublished'||phase==='rolled-back'){
      const reason=phase==='unpublished'&&signal.aborted?signal.reason:error,errors=await cleanup(files);
      if(errors.length)throw new AggregateError([reason,...errors],'WORKFLOW_IMAGE_PREPARATION_CLEANUP_FAILED');
      throw reason;
    }
    throw error;
  } finally {
    if(record)record.active=false;
    clearTimeout(timer);activeJobs--;
  }
}
/** Detached descriptions only. Neither these fields nor the token grant a write. */
export function workflowImageGridPreparationIdentity(prepared:PreparedWorkflowImageGrid):WorkflowImageGridPreparationIdentity {return structuredClone(activeRecord(prepared).identity);}
export function workflowImageGridDocumentMedia(prepared:PreparedWorkflowImageGrid,index:number):PreparedImportedMedia {
  const record=activeRecord(prepared),media=record.documentMedia.get(index);
  if(!Number.isSafeInteger(index)||!media)invalid();return media;
}
export async function assertWorkflowImageGridPreparationInTransaction(client:PoolClient,prepared:PreparedWorkflowImageGrid,signal?:AbortSignal):Promise<void> {
  const record=activeRecord(prepared);record.signal.throwIfAborted();signal?.throwIfAborted();
  await assertWorkflowImageMediaSourceInTransaction(client,record.source,signal);record.signal.throwIfAborted();signal?.throwIfAborted();
}
