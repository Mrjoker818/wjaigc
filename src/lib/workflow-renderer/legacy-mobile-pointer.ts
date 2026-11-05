import {createCanvasTouchGestureController,type CanvasTouchGestureController,type CanvasTouchIntent} from '@/lib/canvas-touch-gestures';

export interface LegacyMobilePoint { x:number; y:number }
export interface LegacyMobileViewport extends LegacyMobilePoint { zoom:number }
export interface LegacyPortEndpoint { nodeId:string; portId:string; direction:'in'|'out' }
export interface LegacyPointerCaptureOwner extends EventTarget {
 setPointerCapture(pointerId:number):void;
 hasPointerCapture(pointerId:number):boolean;
 releasePointerCapture(pointerId:number):void;
}
export interface LegacyMobilePointerInput {
 pointerId:number;pointerType:string;isPrimary:boolean;button:number;
 clientX:number;clientY:number;target:EventTarget|null;
}
export interface LegacyMobilePointerOptions {
 getScope:()=>string;
 getViewport:()=>LegacyMobileViewport;
 getCanvasRect:()=>{left:number;top:number}|null;
 isExternalGestureBusy:()=>boolean;
 isWithinOwner:(owner:LegacyPointerCaptureOwner,target:EventTarget|null)=>boolean;
 onPortBegin:(source:LegacyPortEndpoint,point:LegacyMobilePoint,owner:LegacyPointerCaptureOwner)=>boolean;
 onPortMove:(source:LegacyPortEndpoint,point:LegacyMobilePoint)=>void;
 onPortEnd:(source:LegacyPortEndpoint,target:LegacyPortEndpoint)=>void;
 onPortCancel:()=>void;
 resolvePortAt:(point:LegacyMobilePoint)=>LegacyPortEndpoint|null;
 onViewportBegin:(initial:LegacyMobileViewport)=>void;
 onViewportPreview:(viewport:LegacyMobileViewport)=>void;
 onViewportEnd:(viewport:LegacyMobileViewport,commit:boolean,restore:boolean)=>void;
 onBlankTap:()=>void;
 onLongPress:(point:LegacyMobilePoint,target:'blank'|'image')=>void;
}
export interface LegacyMobilePointerController {
 beginPort:(owner:LegacyPointerCaptureOwner,input:LegacyMobilePointerInput,source:LegacyPortEndpoint)=>boolean;
 beginViewport:(owner:LegacyPointerCaptureOwner,input:LegacyMobilePointerInput,target:'blank'|'image')=>boolean;
 move:(input:LegacyMobilePointerInput)=>boolean;
 up:(input:LegacyMobilePointerInput)=>boolean;
 cancel:(input:LegacyMobilePointerInput)=>boolean;
 cancelAll:()=>void;
 dispose:()=>void;
 freshPointer:(input:LegacyMobilePointerInput)=>void;
 busy:()=>boolean;
 hasViewport:()=>boolean;
 blocksNativeTouch:()=>boolean;
 matchesNativeTouchTargets:(targets:readonly EventTarget[])=>boolean;
 suppressesMouse:()=>boolean;
}
const finitePoint=(p:LegacyMobilePoint):boolean=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const validViewport=(v:LegacyMobileViewport):boolean=>finitePoint(v)&&Number.isFinite(v.zoom)&&v.zoom>0;
const point=(e:LegacyMobilePointerInput):LegacyMobilePoint=>({x:e.clientX,y:e.clientY});
const validInput=(e:LegacyMobilePointerInput):boolean=>Number.isInteger(e.pointerId)&&e.pointerId>=0&&finitePoint(point(e))&&['mouse','touch','pen'].includes(e.pointerType);
export function panLegacyViewport(initial:LegacyMobileViewport,start:LegacyMobilePoint,current:LegacyMobilePoint):LegacyMobileViewport {
 if(!validViewport(initial)||!finitePoint(start)||!finitePoint(current))return {...initial};
 return {x:initial.x+current.x-start.x,y:initial.y+current.y-start.y,zoom:initial.zoom};
}
export function pinchLegacyViewport(current:LegacyMobileViewport,midpoint:LegacyMobilePoint,delta:LegacyMobilePoint,scale:number,rect:{left:number;top:number}):LegacyMobileViewport {
 if(!validViewport(current)||!finitePoint(midpoint)||!finitePoint(delta)||!Number.isFinite(scale)||scale<=0||!Number.isFinite(rect.left)||!Number.isFinite(rect.top))return {...current};
 const oldMid={x:midpoint.x-delta.x-rect.left,y:midpoint.y-delta.y-rect.top},nextMid={x:midpoint.x-rect.left,y:midpoint.y-rect.top};
 const zoom=Math.max(.15,Math.min(3,current.zoom*scale));
 return {x:nextMid.x-(oldMid.x-current.x)/current.zoom*zoom,y:nextMid.y-(oldMid.y-current.y)/current.zoom*zoom,zoom};
}
interface PortSession {kind:'port';scope:string;owner:LegacyPointerCaptureOwner;pointerId:number;pointerType:string;source:LegacyPortEndpoint}
interface ViewTouch {pointerId:number;initial:LegacyMobilePoint;captured:boolean;target:'blank'|'image';initialTarget:EventTarget|null}
interface ViewSession {
 kind:'viewport';scope:string;owner:LegacyPointerCaptureOwner;touches:Map<number,ViewTouch>;
 initial:LegacyMobileViewport;current:LegacyMobileViewport;rect:{left:number;top:number};
 recognizer:CanvasTouchGestureController;started:boolean;owned:boolean;bodyMoved:boolean;
 changed:boolean;pinched:boolean;longPressed:boolean;panStart:LegacyMobilePoint|null;panViewport:LegacyMobileViewport;
}
type Session=PortSession|ViewSession;

/** Ephemeral UI ownership only. Business connection validation stays in the host. */
export function createLegacyMobilePointerController(options:LegacyMobilePointerOptions):LegacyMobilePointerController {
 let active:Session|null=null,suppressedMouse=false,disposed=false;
 const release=(owner:LegacyPointerCaptureOwner,id:number):void=>{try{if(owner.hasPointerCapture(id))owner.releasePointerCapture(id);}catch{/* DOM owner may have been removed. */}};
 const capture=(owner:LegacyPointerCaptureOwner,id:number):boolean=>{try{owner.setPointerCapture(id);return owner.hasPointerCapture(id);}catch{return false;}};
 const sameScope=(s:Session):boolean=>s.scope===options.getScope();
 function stop(commit=false,target:LegacyPortEndpoint|null=null):void {
  const s=active;if(!s)return;active=null;
  const restore=sameScope(s);
  if(s.kind==='port'){
   suppressedMouse=true;
   try{if(commit&&restore&&target?.direction==='in')options.onPortEnd(s.source,target);else options.onPortCancel();}
   finally{release(s.owner,s.pointerId);}return;
  }
  s.recognizer.dispose();
  try{if(s.started)options.onViewportEnd(commit?s.current:s.initial,commit&&s.changed&&restore,restore);}
  finally{for(const t of s.touches.values())if(t.captured)release(s.owner,t.pointerId);s.touches.clear();}
 }
 const stale=():boolean=>{if(active&&!sameScope(active)){stop();return true;}return false;};
 const owns=(s:Session,e:LegacyMobilePointerInput):boolean=>{
  if(!validInput(e))return false;
  if(s.kind==='port')return e.pointerId===s.pointerId&&e.pointerType===s.pointerType&&e.target===s.owner;
  const t=s.touches.get(e.pointerId);return !!t&&e.pointerType==='touch'&&(t.captured?e.target===s.owner:options.isWithinOwner(s.owner,e.target));
 };
 const startView=(s:ViewSession):void=>{if(!s.started){s.started=true;options.onViewportBegin(s.initial);}};
 const preview=(s:ViewSession,next:LegacyMobileViewport):void=>{
  if(!validViewport(next))return;
  startView(s);s.current=next;s.changed||=next.x!==s.initial.x||next.y!==s.initial.y||next.zoom!==s.initial.zoom;options.onViewportPreview(next);
 };
 const intents=(s:ViewSession,items:CanvasTouchIntent[]):void=>{
  for(const intent of items){
   if(active!==s||!sameScope(s))return;
   if(intent.type==='pan-start'){s.panStart=intent.point;s.panViewport={...s.current};startView(s);}
   else if(intent.type==='pan-move'&&s.panStart)preview(s,panLegacyViewport(s.panViewport,s.panStart,intent.point));
   else if(intent.type==='pinch')preview(s,pinchLegacyViewport(s.current,intent.midpoint,intent.midpointDelta,intent.scale,s.rect));
   // pan-end can precede pinch; only the final normal release may commit the view.
  }
 };
 function beginViewport(owner:LegacyPointerCaptureOwner,e:LegacyMobilePointerInput,target:'blank'|'image'):boolean {
  if(disposed||stale()||e.pointerType!=='touch'||e.button!==0||!validInput(e)||!options.isWithinOwner(owner,e.target)||options.isExternalGestureBusy())return false;
  if(active?.kind==='port')return false;
  if(!active){
   if(!e.isPrimary)return false;
   const initial=options.getViewport(),rect=options.getCanvasRect();if(!validViewport(initial)||!rect||!Number.isFinite(rect.left)||!Number.isFinite(rect.top))return false;
   const s:ViewSession={kind:'viewport',scope:options.getScope(),owner,touches:new Map(),initial:{...initial},current:{...initial},rect:{left:rect.left,top:rect.top},recognizer:null as unknown as CanvasTouchGestureController,started:false,owned:target==='blank',bodyMoved:false,changed:false,pinched:false,longPressed:false,panStart:null,panViewport:{...initial}};
   s.recognizer=createCanvasTouchGestureController({onIntent:intent=>{if(intent.type==='long-press'&&active===s&&sameScope(s)){
    s.longPressed=true;suppressedMouse=true;stop();options.onLongPress(intent.point,intent.target);
   }}});active=s;
  }
  const s=active;if(s.kind!=='viewport'||s.owner!==owner||s.touches.has(e.pointerId))return false;
  if(s.touches.size>=2){suppressedMouse=true;stop();return false;}
  const touch:ViewTouch={pointerId:e.pointerId,initial:point(e),captured:false,target,initialTarget:e.target};s.touches.set(e.pointerId,touch);
  if(s.owned||s.touches.size===2){
   s.owned=true;suppressedMouse=true;
   for(const t of s.touches.values())if(!t.captured){if(!capture(owner,t.pointerId)){stop();return true;}t.captured=true;}
  }
  if(s.touches.size===2){s.pinched=true;startView(s);}
  intents(s,s.recognizer.pointerDown({pointerId:e.pointerId,pointerType:'touch',point:point(e),target}));return s.owned;
 }
 function beginPort(owner:LegacyPointerCaptureOwner,e:LegacyMobilePointerInput,source:LegacyPortEndpoint):boolean {
  if(disposed||stale()||active||options.isExternalGestureBusy()||!validInput(e)||!e.isPrimary||e.button!==0||source.direction!=='out'||!source.nodeId||!source.portId||!options.isWithinOwner(owner,e.target))return false;
  suppressedMouse=true;if(!capture(owner,e.pointerId))return true;
  const s:PortSession={kind:'port',scope:options.getScope(),owner,pointerId:e.pointerId,pointerType:e.pointerType,source:{...source}};active=s;
  try{if(!options.onPortBegin(s.source,point(e),owner))stop();}
  catch(error){try{stop();}catch(cleanup){throw new AggregateError([error,cleanup],'LEGACY_PORT_BEGIN_AND_CLEANUP_FAILURE');}throw error;}
  return true;
 }
 function move(e:LegacyMobilePointerInput):boolean {
  if(stale())return true;const s=active;if(!s||!owns(s,e))return false;
  if(s.kind==='port'){options.onPortMove(s.source,point(e));return true;}
  const rect=options.getCanvasRect();if(!rect||rect.left!==s.rect.left||rect.top!==s.rect.top){suppressedMouse=true;stop();return true;}
  const touch=s.touches.get(e.pointerId)!;if(Math.hypot(e.clientX-touch.initial.x,e.clientY-touch.initial.y)>=6){s.bodyMoved=true;suppressedMouse=true;}
  intents(s,s.recognizer.pointerMove({pointerId:e.pointerId,pointerType:'touch',point:point(e),target:touch.target}));return s.owned||s.bodyMoved;
 }
 function up(e:LegacyMobilePointerInput):boolean {
  if(stale())return true;const s=active;if(!s||!owns(s,e))return false;
  if(s.kind==='port'){const target=options.resolvePortAt(point(e));stop(!!target,target);return true;}
  const consumed=s.owned||s.bodyMoved||s.longPressed;move(e);if(active!==s)return consumed;
  const t=s.touches.get(e.pointerId)!;
  intents(s,s.recognizer.pointerUp({pointerId:e.pointerId,pointerType:'touch',point:point(e),target:t.target}));
  s.touches.delete(e.pointerId);if(t.captured)release(s.owner,e.pointerId);
  if(s.touches.size===0){const blankTap=t.target==='blank'&&!s.changed&&!s.pinched&&!s.longPressed&&!s.bodyMoved;stop(true);if(blankTap&&sameScope(s))options.onBlankTap();}
  return consumed;
 }
 function cancel(e:LegacyMobilePointerInput):boolean {
  if(stale())return true;if(!active||!owns(active,e))return false;suppressedMouse=true;stop();return true;
 }
 function matchesNativeTouchTargets(targets:readonly EventTarget[]):boolean {
  if(stale()||active?.kind!=='viewport'||targets.length!==active.touches.size)return false;
  // Touch.identifier and PointerEvent.pointerId are separate browser identities.
  // Match the complete multiset of original DOM targets, never an inferred ID.
  const remaining=[...active.touches.values()].map(touch=>touch.initialTarget);
  for(const target of targets){const index=remaining.indexOf(target);if(index<0)return false;remaining.splice(index,1);}
  return remaining.length===0;
 }
 return {beginPort,beginViewport,move,up,cancel,matchesNativeTouchTargets,cancelAll:()=>{if(active){suppressedMouse=true;stop();}},dispose:()=>{if(!disposed){stop();disposed=true;}},freshPointer:e=>{stale();if(!disposed&&!active&&validInput(e)&&e.isPrimary&&e.button===0)suppressedMouse=false;},busy:()=>{stale();return active!==null;},hasViewport:()=>{stale();return active?.kind==='viewport';},blocksNativeTouch:()=>{stale();return active?.kind==='viewport'&&(active.owned||active.bodyMoved||active.touches.size>1);},suppressesMouse:()=>{stale();return suppressedMouse;}};
}
