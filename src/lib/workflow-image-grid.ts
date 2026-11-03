import sharp from 'sharp';
import {withSafeSharp,assertSafePixelDimensions} from '@/lib/safe-image-input';
import {assertWorkflowImageGridShape,partitionWorkflowImageGrid,WORKFLOW_IMAGE_GRID_MAX_CELLS,type WorkflowImageGridCell} from './workflow-image-actions';

export const WORKFLOW_IMAGE_GRID_LIMITS=Object.freeze({maxInputBytes:32*1024*1024,maxPixels:40_000_000,maxOutputBytes:256*1024*1024,maxCells:WORKFLOW_IMAGE_GRID_MAX_CELLS,timeoutMs:30_000});
export interface WorkflowImageGridTile {cell:WorkflowImageGridCell;bytes:Buffer;mimeType:'image/png'}
export interface WorkflowImageGridOptions {signal?:AbortSignal;maxPixels?:number;maxOutputBytes?:number;timeoutMs?:number;onProgress?:(completed:number,total:number)=>void}

export async function cropWorkflowImageGridCell(bytes:Buffer,columns:number,rows:number,column:number,row:number,options:WorkflowImageGridOptions={}):Promise<WorkflowImageGridTile> {
  assertWorkflowImageGridShape(columns,rows);
  if(!Number.isSafeInteger(column)||!Number.isSafeInteger(row)||column<0||row<0||column>=columns||row>=rows)
    throw new TypeError('WORKFLOW_IMAGE_GRID_INVALID');
  const tiles=await cropSelectedWorkflowImageGrid(bytes,columns,rows,options,{column,row});
  return tiles[0];
}

let activeDecodes=0;

function lowerBoundedLimit(value:number|undefined,ceiling:number):number {
  const result=value??ceiling;
  if(!Number.isSafeInteger(result)||result<1||result>ceiling)throw new TypeError('WORKFLOW_IMAGE_GRID_LIMIT_INVALID');
  return result;
}

/** CPU bytes only. The integrating asset service must also bound persistence jobs. */
export async function cropWorkflowImageGrid(bytes:Buffer,columns:number,rows:number,options:WorkflowImageGridOptions={}):Promise<WorkflowImageGridTile[]> {
  return cropSelectedWorkflowImageGrid(bytes,columns,rows,options);
}

async function cropSelectedWorkflowImageGrid(bytes:Buffer,columns:number,rows:number,options:WorkflowImageGridOptions,selection?:{column:number;row:number}):Promise<WorkflowImageGridTile[]> {
  options.signal?.throwIfAborted();
  assertWorkflowImageGridShape(columns,rows);
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>WORKFLOW_IMAGE_GRID_LIMITS.maxInputBytes)throw new TypeError('WORKFLOW_IMAGE_GRID_INPUT_INVALID');
  const maxPixels=lowerBoundedLimit(options.maxPixels,WORKFLOW_IMAGE_GRID_LIMITS.maxPixels);
  const maxOutputBytes=lowerBoundedLimit(options.maxOutputBytes,WORKFLOW_IMAGE_GRID_LIMITS.maxOutputBytes);
  const timeoutMs=lowerBoundedLimit(options.timeoutMs,WORKFLOW_IMAGE_GRID_LIMITS.timeoutMs);
  if(activeDecodes>=1)throw new Error('WORKFLOW_IMAGE_GRID_BUSY');
  activeDecodes++;
  const deadline=new AbortController(),timeoutError=new Error('WORKFLOW_IMAGE_GRID_TIMEOUT');
  const expiresAt=performance.now()+timeoutMs,timer=setTimeout(()=>deadline.abort(timeoutError),timeoutMs);
  timer.unref();
  const signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
  const assertActive=():void=>{
    signal.throwIfAborted();
    if(performance.now()>=expiresAt)deadline.abort(timeoutError);
    signal.throwIfAborted();
  };
  const nativeTimeoutSeconds=():number=>{
    assertActive();
    const remaining=expiresAt-performance.now();
    if(remaining<=0){deadline.abort(timeoutError);signal.throwIfAborted();}
    // Sharp counts native processing in whole seconds, excluding libuv queue time.
    // Keep awaiting its real receipt; never release this slot via Promise.race.
    return Math.max(1,Math.ceil(remaining/1000));
  };
  try {
    // Decode/orient once; each serial tile encoder reads the same bounded RGBA.
    const image=await withSafeSharp(bytes,{maxPixels,signal},pipeline=>pipeline.timeout({seconds:nativeTimeoutSeconds()}).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true}));
    assertActive();
    const {width,height,channels}=image.info;
    assertSafePixelDimensions(width,height,maxPixels);
    if(channels!==4||image.data.length!==width*height*4)throw new Error('WORKFLOW_IMAGE_GRID_DECODE_INVALID');
    const partition=partitionWorkflowImageGrid(width,height,columns,rows);
    const cells=selection?[partition[selection.row*columns+selection.column]]:partition,tiles:WorkflowImageGridTile[]=[];
    let outputBytes=0;
    for(const cell of cells){
      assertActive();
      const seconds=nativeTimeoutSeconds();
      const pipeline=sharp(image.data,{raw:{width,height,channels:4},failOn:'error',limitInputPixels:maxPixels}).timeout({seconds}).extract({left:cell.left,top:cell.top,width:cell.width,height:cell.height}).png();
      const abort=():void=>{pipeline.once('error',()=>undefined);pipeline.destroy(signal.reason instanceof Error?signal.reason:new Error('WORKFLOW_IMAGE_GRID_CANCELLED'));};
      signal.addEventListener('abort',abort,{once:true});
      let encoded:Buffer;
      try {if(signal.aborted)abort();encoded=await pipeline.toBuffer();}
      finally {signal.removeEventListener('abort',abort);pipeline.destroy();}
      assertActive();
      if(encoded.length>maxOutputBytes-outputBytes)throw new Error('WORKFLOW_IMAGE_GRID_OUTPUT_LIMIT');
      outputBytes+=encoded.length;
      tiles.push({cell,bytes:encoded,mimeType:'image/png'});
      // Synchronous progress notification; persistence is deliberately outside it.
      options.onProgress?.(tiles.length,cells.length);
      assertActive();
    }
    assertActive();
    return tiles;
  } catch(error) {
    // Preserve the originating cancellation identity, including native aborts.
    assertActive();
    throw error;
  } finally {
    clearTimeout(timer);
    activeDecodes--;
  }
}
