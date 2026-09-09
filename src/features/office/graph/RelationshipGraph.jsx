/**
 * Migrated from the DataOS/Mercedes prototype:
 * C:/Users/k/Documents/dataos/prototype/src/components/relationship/RelationshipGraph.tsx
 * Retains its toolbar, pan/zoom, adjacency selection, edge selection and legend structure.
 * SVG-space pointer coordinates, centered zoom, complete bounds, card-edge routing and
 * accessible keyboard/pointer interaction replace the prototype's fixed-size mouse handlers.
 */
import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {LocateFixed, Minus, Plus} from 'lucide-react';
import './graph-canvas.css';

const DEFAULT_WIDTH=180;
const DEFAULT_HEIGHT=76;
const MIN_ZOOM=.5;
const MAX_ZOOM=2.5;
const initialView=()=>({zoom:1,pan:{x:0,y:0}});
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const size=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
const center=node=>({x:node.x+node.width/2,y:node.y+node.height/2});

// Intersect the center-to-control ray with the outside of the card, so arrows remain visible.
function cardBoundary(node,toward){
  const point=center(node);
  let dx=toward.x-point.x,dy=toward.y-point.y;
  if(Math.abs(dx)+Math.abs(dy)<.001)dx=1;
  const scale=Math.min(dx?((node.width/2+2)/Math.abs(dx)):Infinity,dy?((node.height/2+2)/Math.abs(dy)):Infinity);
  return {x:point.x+dx*scale,y:point.y+dy*scale};
}

function edgeLabel(value){
  const text=String(value||'关联');
  const lines=[];
  let line='',width=0;
  for(const character of Array.from(text)){
    const advance=/[^\u0000-\u00ff]/.test(character)?11:6.2;
    if(width+advance>146&&line){lines.push({text:line,width});line='';width=0;}
    line+=character;width+=advance;
  }
  if(line)lines.push({text:line,width});
  return {text,lines:lines.length?lines:[{text:'关联',width:22}],width:Math.max(42,...lines.map(item=>item.width+16)),height:Math.max(24,lines.length*15+8)};
}

const quadraticPoint=(start,control,end,t)=>({x:(1-t)**2*start.x+2*(1-t)*t*control.x+t*t*end.x,y:(1-t)**2*start.y+2*(1-t)*t*control.y+t*t*end.y});
const overlaps=(a,b,padding=0)=>a.x<b.x+b.width+padding&&a.x+a.width>b.x-padding&&a.y<b.y+b.height+padding&&a.y+a.height>b.y-padding;
function segmentCrossesCard(start,end,node,padding=8){
  let low=0,high=1;
  for(const [axis,extent]of [['x','width'],['y','height']]){
    const delta=end[axis]-start[axis],minimum=node[axis]-padding,maximum=node[axis]+node[extent]+padding;
    if(Math.abs(delta)<.00001){if(start[axis]<minimum||start[axis]>maximum)return false;continue;}
    const a=(minimum-start[axis])/delta,b=(maximum-start[axis])/delta;
    low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));
    if(low>high)return false;
  }
  return true;
}
function placeCurveLabel(start,control,end,label,nodes,usedLabels){
  let best=null;
  // Prefer the curve midpoint, then nearby clear portions; an offset gets a short leader.
  for(const shift of [0,26,-26,48,-48,66,-66])for(const t of [.5,.4,.6,.3,.7]){
    const anchor=quadraticPoint(start,control,end,t);
    const tangent={x:2*(1-t)*(control.x-start.x)+2*t*(end.x-control.x),y:2*(1-t)*(control.y-start.y)+2*t*(end.y-control.y)};
    const length=Math.hypot(tangent.x,tangent.y)||1;
    const point={x:anchor.x-tangent.y/length*shift,y:anchor.y+tangent.x/length*shift};
    const rect={x:point.x-label.width/2,y:point.y-label.height/2,width:label.width,height:label.height};
    const covered=nodes.filter(node=>overlaps(rect,node,3)).length;
    const crowded=usedLabels.filter(other=>overlaps(rect,other,4)).length;
    const score=covered*10000+crowded*200+Math.abs(shift)+Math.abs(t-.5)*20;
    if(!best||score<best.score)best={point,anchor,rect,covered,crowded,score};
    if(!covered&&!crowded&&!shift)return best;
  }
  return best;
}
function routeCurve(source,target,nodes,label,baseOffset,direction,usedLabels){
  const from=center(source),to=center(target),dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy)||1;
  const obstacles=nodes.filter(node=>node.id!==source.id&&node.id!==target.id);
  let best=null;
  // Keep the original route when clear. Progressively bow obstructed edges into open lanes.
  for(const adjustment of [0,48,-48,96,-96,160,-160,240,-240]){
    const offset=baseOffset+adjustment;
    const control={x:(from.x+to.x)/2-dy/length*offset*direction,y:(from.y+to.y)/2+dx/length*offset*direction};
    const start=cardBoundary(source,control),end=cardBoundary(target,control);
    const points=Array.from({length:41},(_,index)=>quadraticPoint(start,control,end,index/40));
    const crossed=obstacles.filter(node=>points.slice(1).some((point,index)=>segmentCrossesCard(points[index],point,node))).length;
    const placement=placeCurveLabel(start,control,end,label,nodes,usedLabels);
    const score=crossed*1000000+placement.covered*100000+placement.crowded*200+Math.abs(adjustment)+placement.score/100;
    const result={start,end,control,labelPoint:placement.point,labelAnchor:placement.anchor,labelRect:placement.rect,score,crossed,covered:placement.covered,routePoints:points};
    if(!best||score<best.score)best=result;
    if(!crossed&&!placement.covered&&!placement.crowded)return result;
  }
  // A single bow cannot get around every grid of cards. Use clear orthogonal lanes
  // with rounded corners instead of accepting a curve through another object.
  return routeAroundCards(source,target,nodes,label,baseOffset,usedLabels)||best;
}

function routeAroundCards(source,target,nodes,label,baseOffset,usedLabels){
  const clearance=24+Math.abs(baseOffset)*.25;
  const ports=node=>{const point=center(node);return [{x:node.x-clearance,y:point.y},{x:node.x+node.width+clearance,y:point.y},{x:point.x,y:node.y-clearance},{x:point.x,y:node.y+node.height+clearance}];};
  const starts=ports(source),ends=ports(target);
  const unique=values=>[...new Set(values)].sort((a,b)=>a-b);
  const xs=unique([...nodes.flatMap(node=>[node.x-clearance,node.x+node.width+clearance]),...starts.map(point=>point.x),...ends.map(point=>point.x)]);
  const ys=unique([...nodes.flatMap(node=>[node.y-clearance,node.y+node.height+clearance]),...starts.map(point=>point.y),...ends.map(point=>point.y)]);
  const points=new Map(),key=(x,y)=>`${x},${y}`;
  for(let y=0;y<ys.length;y++)for(let x=0;x<xs.length;x++){
    const point={x:xs[x],y:ys[y],gx:x,gy:y};
    if(!nodes.some(node=>segmentCrossesCard(point,point,node)))points.set(key(x,y),point);
  }
  const pointFor=point=>points.get(key(xs.indexOf(point.x),ys.indexOf(point.y)));
  const connectorClear=(point,node)=>!nodes.some(other=>other.id!==node.id&&segmentCrossesCard(cardBoundary(node,point),point,other));
  const targetKeys=new Set(ends.filter(point=>connectorClear(point,target)).map(pointFor).filter(Boolean).map(point=>key(point.gx,point.gy)));
  const queue=[],costs=new Map(),previous=new Map(),records=new Map(),neighbors=new Map();
  for(const port of starts.filter(point=>connectorClear(point,source))){
    const point=pointFor(port);if(!point)continue;
    const id=`${key(point.gx,point.gy)}:0`,record={id,point,direction:0,cost:clearance};
    costs.set(id,record.cost);records.set(id,record);queue.push(record);
  }
  let finish=null;
  while(queue.length){
    queue.sort((a,b)=>b.cost-a.cost);
    const current=queue.pop();if(current.cost!==costs.get(current.id))continue;
    const location=key(current.point.gx,current.point.gy);
    if(targetKeys.has(location)){finish=current;break;}
    if(!neighbors.has(location))neighbors.set(location,[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>points.get(key(current.point.gx+x,current.point.gy+y))).filter(Boolean).filter(point=>!nodes.some(node=>segmentCrossesCard(current.point,point,node))));
    for(const point of neighbors.get(location)){
      const direction=point.x===current.point.x?2:1;
      const cost=current.cost+Math.abs(point.x-current.point.x)+Math.abs(point.y-current.point.y)+(current.direction&&current.direction!==direction?22:0);
      const id=`${key(point.gx,point.gy)}:${direction}`;
      if(cost>=(costs.get(id)??Infinity))continue;
      const record={id,point,direction,cost};costs.set(id,cost);records.set(id,record);previous.set(id,current.id);queue.push(record);
    }
  }
  if(!finish)return null;
  const route=[];
  for(let record=finish;record;record=records.get(previous.get(record.id)))route.unshift({x:record.point.x,y:record.point.y});
  route.unshift(cardBoundary(source,route[0]));route.push(cardBoundary(target,route[route.length-1]));
  const turns=[];
  for(const point of route){
    while(turns.length>1){
      const a=turns[turns.length-2],b=turns[turns.length-1];
      if(Math.abs((b.x-a.x)*(point.y-b.y)-(b.y-a.y)*(point.x-b.x))>.001)break;
      turns.pop();
    }
    turns.push(point);
  }
  let path=`M ${turns[0].x} ${turns[0].y}`;
  const routePoints=[turns[0]];
  for(let index=1;index<turns.length-1;index++){
    const a=turns[index-1],b=turns[index],c=turns[index+1];
    const incoming=Math.hypot(b.x-a.x,b.y-a.y),outgoing=Math.hypot(c.x-b.x,c.y-b.y),radius=Math.min(12,incoming/3,outgoing/3);
    const before={x:b.x+(a.x-b.x)/incoming*radius,y:b.y+(a.y-b.y)/incoming*radius};
    const after={x:b.x+(c.x-b.x)/outgoing*radius,y:b.y+(c.y-b.y)/outgoing*radius};
    path+=` L ${before.x} ${before.y} Q ${b.x} ${b.y} ${after.x} ${after.y}`;
    routePoints.push(before,...Array.from({length:8},(_,step)=>quadraticPoint(before,b,after,(step+1)/8)));
  }
  const last=turns[turns.length-1];path+=` L ${last.x} ${last.y}`;routePoints.push(last);
  let placement=null;
  for(let index=1;index<turns.length;index++){
    const a=turns[index-1],b=turns[index],midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const candidate=placeCurveLabel(a,midpoint,b,label,nodes,usedLabels);
    const score=candidate.score+(Math.hypot(b.x-a.x,b.y-a.y)<label.width?18:0);
    if(!placement||score<placement.score)placement={...candidate,score};
  }
  return {path,extent:turns,routePoints,labelPoint:placement.point,labelAnchor:placement.anchor,labelRect:placement.rect,crossed:0,covered:placement.covered};
}

function geometryFor(nodes,relationships){
  const nodeMap=new Map(nodes.map(node=>[node.id,node]));
  const valid=relationships.filter(edge=>nodeMap.has(edge.source)&&nodeMap.has(edge.target));
  const groups=new Map();
  for(const edge of valid){
    const key=JSON.stringify([edge.source,edge.target].sort());
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(edge);
  }
  for(const group of groups.values())group.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const usedLabels=[];
  const edges=valid.map(edge=>{
    const source=nodeMap.get(edge.source),target=nodeMap.get(edge.target);
    const group=groups.get(JSON.stringify([edge.source,edge.target].sort()));
    const lane=group.findIndex(item=>item.id===edge.id),label=edgeLabel(edge.relationship);
    if(source.id===target.id){
      const offset=lane*32;
      const start={x:source.x+source.width+2,y:source.y+source.height*.55};
      const end={x:source.x+source.width*.55,y:source.y-2};
      const control1={x:source.x+source.width+90+offset,y:start.y};
      const control2={x:end.x,y:source.y-86-offset};
      const labelPoint={x:source.x+source.width+30+offset,y:source.y-34-offset};
      usedLabels.push({x:labelPoint.x-label.width/2,y:labelPoint.y-label.height/2,width:label.width,height:label.height});
      return {...edge,label,labelPoint,path:`M ${start.x} ${start.y} C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${end.x} ${end.y}`,extent:[start,end,control1,control2]};
    }
    // Use the same normal for both directions, keeping reciprocal and parallel edges apart.
    const direction=String(source.id).localeCompare(String(target.id))<=0?1:-1;
    const offset=(lane-(group.length-1)/2)*68;
    const route=routeCurve(source,target,nodes,label,offset,direction,usedLabels);
    const {start,end,control,labelPoint,labelAnchor,labelRect,routePoints}=route;
    usedLabels.push(labelRect);
    return {...edge,label,labelPoint,labelAnchor,routePoints,path:route.path||`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,extent:route.extent||[start,end,control]};
  });
  const xs=nodes.flatMap(node=>[node.x,node.x+node.width]);
  const ys=nodes.flatMap(node=>[node.y,node.y+node.height]);
  for(const edge of edges){
    xs.push(...edge.extent.map(point=>point.x),edge.labelPoint.x-edge.label.width/2,edge.labelPoint.x+edge.label.width/2);
    ys.push(...edge.extent.map(point=>point.y),edge.labelPoint.y-edge.label.height/2,edge.labelPoint.y+edge.label.height/2);
  }
  const padding=44;
  const minimum=values=>values.reduce((current,value)=>Math.min(current,value),Infinity);
  const maximum=values=>values.reduce((current,value)=>Math.max(current,value),-Infinity);
  const left=xs.length?minimum(xs)-padding:0,top=ys.length?minimum(ys)-padding:0;
  const width=xs.length?maximum(xs)-left+padding:900,height=ys.length?maximum(ys)-top+padding:560;
  return {nodeMap,edges,bounds:{x:left,y:top,width,height,cx:left+width/2,cy:top+height/2}};
}

function svgPoint(svg,clientX,clientY){
  const matrix=svg?.getScreenCTM();
  if(!matrix)return null;
  const point=svg.createSVGPoint();point.x=clientX;point.y=clientY;
  return point.matrixTransform(matrix.inverse());
}

/** x/y are each card's top-left layout coordinates; the parent owns data and layout. */
export function RelationshipGraph({nodes=[],relationships=[],selectedNodeId=null,selectedRelationshipId=null,onSelectNode,onSelectRelationship,layoutKey}){
  const [view,setView]=useState(initialView),[dragging,setDragging]=useState(false);
  const svgRef=useRef(null),dragStart=useRef(null);
  const uniqueId=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const markerId=`ls-relation-arrow-${uniqueId}`,activeMarkerId=`${markerId}-active`,helpId=`ls-graph-help-${uniqueId}`;
  const normalizedNodes=useMemo(()=>nodes.map(node=>({...node,x:finite(node.x,0),y:finite(node.y,0),width:size(node.width,DEFAULT_WIDTH),height:size(node.height,DEFAULT_HEIGHT)})),[nodes]);
  const {nodeMap,edges,bounds}=useMemo(()=>geometryFor(normalizedNodes,relationships),[normalizedNodes,relationships]);
  const selectedEdge=edges.find(edge=>edge.id===selectedRelationshipId);
  const focusNode=selectedEdge?null:nodeMap.has(selectedNodeId)?selectedNodeId:null;
  const highlighted=useMemo(()=>{
    if(selectedEdge)return {nodes:new Set([selectedEdge.source,selectedEdge.target]),edges:new Set([selectedEdge.id])};
    if(!focusNode)return null;
    const adjacent=edges.filter(edge=>edge.source===focusNode||edge.target===focusNode);
    return {nodes:new Set([focusNode,...adjacent.flatMap(edge=>[edge.source,edge.target])]),edges:new Set(adjacent.map(edge=>edge.id))};
  },[selectedEdge,focusNode,edges]);
  const geometryKey=normalizedNodes.map(node=>`${node.id}:${node.x},${node.y},${node.width},${node.height}`).join('|');
  const boundsKey=`${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;

  const stopDragging=useCallback(()=>{
    const current=dragStart.current;dragStart.current=null;setDragging(false);
    if(current&&svgRef.current?.hasPointerCapture?.(current.pointerId))svgRef.current.releasePointerCapture(current.pointerId);
  },[]);
  const reset=useCallback(()=>{stopDragging();setView(initialView());},[stopDragging]);
  useEffect(()=>{reset();},[layoutKey,geometryKey,boundsKey,reset]);
  useEffect(()=>{
    // Pointer capture keeps dragging correct outside the SVG; window handlers cover interrupted gestures.
    const finish=event=>{if(dragStart.current?.pointerId===event.pointerId)stopDragging();};
    window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);window.addEventListener('blur',stopDragging);
    return()=>{window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);window.removeEventListener('blur',stopDragging);dragStart.current=null;};
  },[stopDragging]);

  const zoomAt=useCallback((factor,anchor={x:bounds.cx,y:bounds.cy})=>{
    setView(current=>{
      const zoom=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,Number((current.zoom*factor).toFixed(3))));
      const ratio=zoom/current.zoom;
      return {zoom,pan:{x:anchor.x-bounds.cx-(anchor.x-bounds.cx-current.pan.x)*ratio,y:anchor.y-bounds.cy-(anchor.y-bounds.cy-current.pan.y)*ratio}};
    });
  },[bounds.cx,bounds.cy]);
  useEffect(()=>{
    const svg=svgRef.current;if(!svg)return;
    const wheel=event=>{
      if(event.ctrlKey||event.metaKey||dragStart.current)return;
      event.preventDefault();
      const anchor=svgPoint(svg,event.clientX,event.clientY);
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?300:1);
      zoomAt(Math.exp(-Math.max(-500,Math.min(500,delta))*.0015),anchor||undefined);
    };
    svg.addEventListener('wheel',wheel,{passive:false});
    return()=>svg.removeEventListener('wheel',wheel);
  },[zoomAt]);

  function startPan(event){
    if(event.button!==0||dragStart.current||event.target.closest?.('[data-graph-selectable]'))return;
    const point=svgPoint(svgRef.current,event.clientX,event.clientY);if(!point)return;
    event.preventDefault();svgRef.current.focus({preventScroll:true});
    dragStart.current={pointerId:event.pointerId,x:point.x,y:point.y,panX:view.pan.x,panY:view.pan.y};setDragging(true);
    svgRef.current.setPointerCapture(event.pointerId);
  }
  function movePan(event){
    const start=dragStart.current;if(!start||start.pointerId!==event.pointerId)return;
    const point=svgPoint(svgRef.current,event.clientX,event.clientY);if(!point)return;
    setView(current=>({...current,pan:{x:start.panX+point.x-start.x,y:start.panY+point.y-start.y}}));
  }
  function canvasKeys(event){
    if(event.target!==event.currentTarget||event.ctrlKey||event.metaKey||event.altKey)return;
    const shifts={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(shifts[event.key]){
      event.preventDefault();const [x,y]=shifts[event.key],step=Math.min(bounds.width,bounds.height)*.06*(event.shiftKey?2:1);
      setView(current=>({...current,pan:{x:current.pan.x+x*step,y:current.pan.y+y*step}}));
    }else if(['+','='].includes(event.key)){event.preventDefault();zoomAt(1.2);}
    else if(['-','_'].includes(event.key)){event.preventDefault();zoomAt(1/1.2);}
    else if(['Home','0'].includes(event.key)){event.preventDefault();reset();}
    else if(event.key==='Escape'){event.preventDefault();stopDragging();}
  }
  function selectionKeys(event,callback,id){
    if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();callback?.(id);}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();svgRef.current?.focus({preventScroll:true});}
  }

  return <section className="ls-relationship-graph" aria-label="关系图谱工作区">
    <div className="ls-graph-toolbar">
      <div className="ls-graph-heading"><strong>关系图谱</strong><span>{normalizedNodes.length} 个对象 · {edges.length} 条关系</span></div>
      <div className="ls-graph-controls">
        <button type="button" onClick={()=>zoomAt(1.2)} disabled={view.zoom>=MAX_ZOOM} aria-label="放大" title="放大关系图"><Plus size={15}/></button>
        <output aria-label="相对适配比例" aria-live="polite">{Math.round(view.zoom*100)}%</output>
        <button type="button" onClick={()=>zoomAt(1/1.2)} disabled={view.zoom<=MIN_ZOOM} aria-label="缩小" title="缩小关系图"><Minus size={15}/></button>
        <button type="button" onClick={reset} aria-label="回到中心，适配全部对象" title="适配全部对象（Home / 0）"><LocateFixed size={15}/><span>回到中心</span></button>
      </div>
    </div>
    <div className="ls-graph-viewport">
      <svg ref={svgRef} className={`ls-graph-canvas ${dragging?'is-dragging':''}`} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="业务对象与关系画布" aria-describedby={helpId} tabIndex={0} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={event=>{if(dragStart.current?.pointerId===event.pointerId)stopDragging();}} onPointerCancel={stopDragging} onLostPointerCapture={stopDragging} onKeyDown={canvasKeys}>
        <defs>
          <marker id={markerId} markerWidth="8" markerHeight="8" viewBox="0 0 8 8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="#a3a3a3"/></marker>
          <marker id={activeMarkerId} markerWidth="9" markerHeight="9" viewBox="0 0 8 8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="#171717"/></marker>
        </defs>
        <g transform={`translate(${bounds.cx+view.pan.x} ${bounds.cy+view.pan.y}) scale(${view.zoom}) translate(${-bounds.cx} ${-bounds.cy})`}>
          {edges.map(edge=>{
            const active=highlighted?.edges.has(edge.id)||false,dimmed=!!highlighted&&!active,selected=selectedEdge?.id===edge.id;
            return <g key={edge.id} className={`ls-graph-edge ${active?'is-active':''} ${selected?'is-selected':''} ${dimmed?'is-dimmed':''}`} data-graph-selectable="relationship" tabIndex={0} role="button" aria-label={`${edge.label.text}：${nodeMap.get(edge.source)?.title||edge.source} → ${nodeMap.get(edge.target)?.title||edge.target}`} aria-pressed={selected} onClick={event=>{event.stopPropagation();onSelectRelationship?.(edge.id);}} onKeyDown={event=>selectionKeys(event,onSelectRelationship,edge.id)}>
              <title>{`${edge.label.text}\n${edge.source} → ${edge.target}\n${edge.id}`}</title>
              <path className="ls-graph-edge-hit" d={edge.path}/>
              <path className="ls-graph-edge-line" d={edge.path} markerEnd={`url(#${active?activeMarkerId:markerId})`}/>
              {edge.labelAnchor&&Math.hypot(edge.labelPoint.x-edge.labelAnchor.x,edge.labelPoint.y-edge.labelAnchor.y)>1&&<path className="ls-graph-label-leader" d={`M ${edge.labelAnchor.x} ${edge.labelAnchor.y} L ${edge.labelPoint.x} ${edge.labelPoint.y}`}/>}
              <g className="ls-graph-edge-label" transform={`translate(${edge.labelPoint.x} ${edge.labelPoint.y})`}>
                <rect x={-edge.label.width/2} y={-edge.label.height/2} width={edge.label.width} height={edge.label.height} rx="4"/>
                <text textAnchor="middle">{edge.label.lines.map((line,index)=><tspan key={index} x="0" y={(index-(edge.label.lines.length-1)/2)*15+4}>{line.text}</tspan>)}</text>
              </g>
            </g>;
          })}
          {normalizedNodes.map(node=>{
            const active=highlighted?.nodes.has(node.id)||false,dimmed=!!highlighted&&!active,selected=!selectedEdge&&focusNode===node.id;
            const kind=['top-level','related','reference'].includes(node.kind)?node.kind:'related';
            return <g key={node.id} transform={`translate(${node.x} ${node.y})`} className={`ls-graph-node kind-${kind} ${active?'is-active':''} ${selected?'is-selected':''} ${dimmed?'is-dimmed':''}`} data-graph-selectable="node" tabIndex={0} role="button" aria-label={`${node.title||node.id}${node.typeLabel?`，${node.typeLabel}`:''}，${node.id}`} aria-pressed={selected||!!selectedEdge&&active} onClick={event=>{event.stopPropagation();onSelectNode?.(node.id);}} onKeyDown={event=>selectionKeys(event,onSelectNode,node.id)}>
              <title>{`${node.title||node.id}\n${node.id}`}</title>
              <rect className="ls-graph-node-focus" x="-4" y="-4" width={node.width+8} height={node.height+8} rx="10"/>
              <rect className="ls-graph-node-card" width={node.width} height={node.height} rx="6"/>
              <foreignObject width={node.width} height={node.height}>
                <div className="ls-graph-node-content" title={`${node.title||node.id} · ${node.id}`}>
                  <div className="ls-graph-node-type"><i aria-hidden="true"/>{node.typeLabel||'业务对象'}</div>
                  <div className="ls-graph-node-title">{node.title||node.id}</div>
                  {node.subtitle&&<div className="ls-graph-node-subtitle">{node.subtitle}</div>}
                </div>
              </foreignObject>
            </g>;
          })}
        </g>
      </svg>
      {!normalizedNodes.length&&<div className="ls-graph-empty" role="status"><strong>当前没有可见对象</strong><span>选择业务对象或调整目录范围后查看关系。</span></div>}
    </div>
    <div className="ls-graph-legend">
      <span>选择对象查看关联</span><span>选择关系查看起终点</span>
      <small>拖动画布 · 滚轮缩放 · Tab / Enter 选择</small>
      <p id={helpId} className="ls-graph-sr-only">聚焦画布后，方向键平移，加减键缩放，Home 或 0 适配全部对象。使用 Tab 切换节点与关系，Enter 或空格选择，Escape 返回画布。</p>
    </div>
  </section>;
}

export default RelationshipGraph;
