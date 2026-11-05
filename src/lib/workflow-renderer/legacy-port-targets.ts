export interface LegacyScreenRect {x:number;y:number;width:number;height:number}
export interface LegacyScreenPort {key:string;nodeId:string;portId:string;direction:'in'|'out';label:string;type:string;point:{x:number;y:number}}
export interface LegacyDirectPortTarget extends LegacyScreenPort {rect:LegacyScreenRect}
const finiteRect=(r:LegacyScreenRect):boolean=>Number.isFinite(r.x)&&Number.isFinite(r.y)&&Number.isFinite(r.width)&&Number.isFinite(r.height)&&r.width>=0&&r.height>=0;
const overlaps=(a:LegacyScreenRect,b:LegacyScreenRect):boolean=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
/** Preserve every port through either a safe unscaled target or an explicit list. */
export function partitionLegacyPortTargets(ports:readonly LegacyScreenPort[],bounds:LegacyScreenRect,obstacles:readonly LegacyScreenRect[]=[]):{direct:LegacyDirectPortTarget[];fallback:LegacyScreenPort[]} {
 const targets=ports.map(p=>({...p,rect:{x:p.point.x-22,y:p.point.y-22,width:44,height:44}}));
 const direct:LegacyDirectPortTarget[]=[],fallback:LegacyScreenPort[]=[];
 if(obstacles.some(obstacle=>!finiteRect(obstacle)))return {direct,fallback:[...ports]};
 for(const p of targets){
  const r=p.rect,valid=finiteRect(bounds)&&finiteRect(r)&&r.x>=bounds.x&&r.y>=bounds.y&&r.x+r.width<=bounds.x+bounds.width&&r.y+r.height<=bounds.y+bounds.height;
  const collision=targets.some(other=>other!==p&&finiteRect(other.rect)&&overlaps(r,other.rect));
  const obstructed=obstacles.some(o=>finiteRect(o)&&o.width>0&&o.height>0&&overlaps(r,o));
  if(valid&&!collision&&!obstructed)direct.push(p);else fallback.push(ports[targets.indexOf(p)]);
 }
 return {direct,fallback};
}
