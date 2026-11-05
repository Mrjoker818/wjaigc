/** Shared image-node contracts. No asset authorization or side effects live here. */
export interface WorkflowImageGridCell {
  index:number;column:number;row:number;columns:number;rows:number;
  left:number;top:number;width:number;height:number;
}

export const WORKFLOW_IMAGE_GRID_MAX_CELLS=64;

export function assertWorkflowImageGridShape(columns:number,rows:number):void {
  if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<1||rows<1
    ||columns>WORKFLOW_IMAGE_GRID_MAX_CELLS||rows>WORKFLOW_IMAGE_GRID_MAX_CELLS
    ||columns*rows>WORKFLOW_IMAGE_GRID_MAX_CELLS)throw new TypeError('WORKFLOW_IMAGE_GRID_INVALID');
}

/** Integer boundaries partition every pixel exactly once, including odd edges. */
export function partitionWorkflowImageGrid(width:number,height:number,columns:number,rows:number):WorkflowImageGridCell[] {
  assertWorkflowImageGridShape(columns,rows);
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<columns||height<rows
    ||!Number.isSafeInteger(width*height)||!Number.isSafeInteger(width*columns)
    ||!Number.isSafeInteger(height*rows))throw new TypeError('WORKFLOW_IMAGE_GRID_INVALID');
  const cells:WorkflowImageGridCell[]=[];
  for(let row=0;row<rows;row++){
    const top=Math.floor(row*height/rows),bottom=Math.floor((row+1)*height/rows);
    for(let column=0;column<columns;column++){
      const left=Math.floor(column*width/columns),right=Math.floor((column+1)*width/columns);
      cells.push({index:row*columns+column,column,row,columns,rows,left,top,width:right-left,height:bottom-top});
    }
  }
  return cells;
}
