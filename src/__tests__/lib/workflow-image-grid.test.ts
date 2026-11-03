// @vitest-environment node
import sharp from 'sharp';
import {describe,expect,it} from 'vitest';
import {partitionWorkflowImageGrid} from '@/lib/workflow-image-actions';
import {cropWorkflowImageGrid,cropWorkflowImageGridCell} from '@/lib/workflow-image-grid';

async function oddPng():Promise<Buffer>{
  const rgba=Buffer.from(Array.from({length:35},(_,index)=>[index*5,255-index*3,(index%7)*30,80+(index%5)*35]).flat());
  return sharp(rgba,{raw:{width:7,height:5,channels:4}}).png().toBuffer();
}

describe('workflow image grid real pixels and cancellation',()=>{
  it('partitions a 7 by 5 PNG into six distinct lossless tiles without losing or repeating pixels',async()=>{
    const bytes=await oddPng(),source=await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer();
    const bounds:Array<readonly[number,number,number,number]>=[[0,0,2,2],[2,0,2,2],[4,0,3,2],[0,2,2,3],[2,2,2,3],[4,2,3,3]];
    expect(partitionWorkflowImageGrid(7,5,3,2).map(cell=>[cell.left,cell.top,cell.width,cell.height])).toEqual(bounds);
    const tiles=await cropWorkflowImageGrid(bytes,3,2),covered=new Set<string>();expect(tiles).toHaveLength(6);
    for(const[index,tile]of tiles.entries()){
      const[left,top,width,height]=bounds[index]!;expect(tile.cell).toEqual({index,column:index%3,row:Math.floor(index/3),columns:3,rows:2,left,top,width,height});expect(tile.mimeType).toBe('image/png');
      const decoded=await sharp(tile.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});expect(decoded.info).toMatchObject({width,height,channels:4});
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const key=`${left+x},${top+y}`;expect(covered.has(key)).toBe(false);covered.add(key);
        const actual=(y*width+x)*4,original=((top+y)*7+left+x)*4;
        expect(decoded.data.subarray(actual,actual+4)).toEqual(source.subarray(original,original+4));
      }
    }
    expect(covered.size).toBe(35);
  });

  it('preserves the exact abort reason before starting a decode',async()=>{
    const bytes=await oddPng(),controller=new AbortController(),reason=new Error('Cancelled before grid decode');controller.abort(reason);
    await expect(cropWorkflowImageGrid(bytes,3,2,{signal:controller.signal})).rejects.toBe(reason);
    await expect(cropWorkflowImageGridCell(bytes,3,2,0,0)).resolves.toMatchObject({cell:{column:0,row:0,left:0,top:0,width:2,height:2}});
  });

  it('rejects an outside cell and still returns the complete valid bottom right tile',async()=>{
    const bytes=await oddPng();await expect(cropWorkflowImageGridCell(bytes,3,2,3,0)).rejects.toThrow('WORKFLOW_IMAGE_GRID_INVALID');
    const tile=await cropWorkflowImageGridCell(bytes,3,2,2,1);expect(tile.cell).toMatchObject({index:5,column:2,row:1,left:4,top:2,width:3,height:3});
    expect(await sharp(tile.bytes).metadata()).toMatchObject({format:'png',width:3,height:3});
  });
});
