import {defaultCamera,type Material,type Vec} from '@an-shuttle/cad/scene.js';
import {facesOf,geometry,parameterInput,parameterOf,type Model,type SavedDrawing} from '@an-shuttle/cad/drawing.js';
const response = await fetch('/model.json');
if (!response.ok) throw Error('Unable to load the CAD drawing');
const drawing:Model = await response.json();
const parts=Object.keys(drawing.parts);
const byId=(id:string)=>document.getElementById(id)!;
const input=(id:string)=>document.querySelector<HTMLInputElement>('#'+id)!;
const controls=document.querySelector<HTMLFieldSetElement>('#controls')!;
const canvas=document.querySelector('canvas')!;
const ctx=canvas.getContext('2d')!;
const palette:Material[]=[{finish:'petrol enamel',color:'#23615d'},{finish:'ground steel',color:'#bdc9cb'},{finish:'brushed brass',color:'#b68c55'}];
document.title=drawing.title+' · CAD 绘画台';
byId('title').textContent=drawing.title+' / CAD 绘画台';
canvas.setAttribute('aria-label','3D '+drawing.title);
const parameter=drawing.parameter;
byId('parameterLabel').textContent=parameter.label;
input('gap').min=String(parameter.min);
input('gap').max=String(parameter.max);
input('gap').value=String(parameter.initial);
const paletteLabels=['青绿烤漆','磨削钢','黄铜'];
for (const m of Object.values(drawing.materials)) {
  if (m && !palette.some(item=>item.color===m.color && item.finish===m.finish)) {
    palette.push(m); paletteLabels.push(m.finish);
  }
}
for (const part of parts) {
  const label=document.createElement('label'), select=document.createElement('select');
  label.textContent=drawing.parts[part].label;select.id=part;
  select.add(new Option('让模型生成',''));
  for(const [i,name] of paletteLabels.entries()) select.add(new Option(name,String(i)));
  label.append(select);byId('materials').append(label);
}
const choice=(p:string)=>document.querySelector<HTMLSelectElement>('#'+p)!;
function draft(): SavedDrawing {
  const s:SavedDrawing={...parameterInput(input('gap').valueAsNumber,drawing),materials:{}};
  if(input('sendCamera').checked)s.camera={yaw:input('yaw').valueAsNumber,elevation:input('elevation').valueAsNumber};
  if(input('sendLight').checked)s.light=input('light').valueAsNumber;
  for(const part of parts) if(choice(part).value!=='')s.materials[part]=palette[Number(choice(part).value)];
  return s;
}
function preview() {
  const s=draft(), rad=Math.PI/180,yaw=input('yaw').valueAsNumber*rad,elev=input('elevation').valueAsNumber*rad;
  const sun=input('light').valueAsNumber*rad;
  const eye:Vec=[Math.cos(yaw)*Math.cos(elev),Math.sin(yaw)*Math.cos(elev),Math.sin(elev)];
  const dot=(a:Vec,b:Vec)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const faces=geometry(drawing,parameterOf(s)).flatMap(solid=>facesOf(solid).flatMap(poly=>{
    const delta=(p:Vec):Vec=>[p[0]-poly[0][0],p[1]-poly[0][1],p[2]-poly[0][2]];
    const a=delta(poly[1]),b=delta(poly[2]),n:Vec=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    if(dot(n,eye)<=0)return [];
    const intensity=.63+.37*Math.max(0,dot(n,[.8*Math.cos(sun),.8*Math.sin(sun),.6])/Math.hypot(...n));
    const c=s.materials[solid.part]?.color ?? '#9da9a3';
    const rgb=[1,3,5].map(i=>Math.round(parseInt(c.slice(i,i+2),16)*intensity));
    return [{poly,depth:poly.reduce((v,p)=>v+dot(p,eye),0)/poly.length,fill:'rgb('+rgb.join(',')+')'}];
  }));
  const [cx,cy,cz]=drawing.focus, scale=canvas.width/drawing.width;
  ctx.clearRect(0,0,960,680);
  for(const face of faces.sort((a,b)=>a.depth-b.depth)) {
    ctx.beginPath();
    face.poly.forEach(([x,y,z],i)=>{
      const u=480+scale*(-Math.sin(yaw)*(x-cx)+Math.cos(yaw)*(y-cy));
      const v=340+scale*(Math.sin(elev)*(Math.cos(yaw)*(x-cx)+Math.sin(yaw)*(y-cy))-Math.cos(elev)*(z-cz));
      if(i===0)ctx.moveTo(u,v);else ctx.lineTo(u,v);
    });
    ctx.closePath();ctx.fillStyle=face.fill;ctx.fill();ctx.strokeStyle=face.fill;ctx.stroke();
  }
  byId('gapValue').textContent=parameterOf(s)+parameter.unit;
}
interface State {drawingId:string;epoch:string;revision:number;scene:SavedDrawing;direction:string;locked:boolean;artifact:string|null;message:string;canCut:boolean;cutStatus:string;materialReference:{part:string;revision:number}|null}
let state:State|null=null, posting=false, connected=false;
const cut = document.querySelector<HTMLButtonElement>('#cut')!;
function lock(){
  controls.disabled=posting||!connected||!state||state.locked;
  cut.disabled=controls.disabled||state?.cutStatus!=='ready';
}
function update(next:State) {
  if (drawing.id!==next.drawingId) {controls.disabled=true;location.reload();return;}
  const revisionChanged=!state || state.epoch!==next.epoch || state.revision!==next.revision;
  state=next;
  lock();
  if(revisionChanged) {
    input('reuseGrip').checked=false;
    input('verifyHistory').checked=false;
    input('gap').value=String(parameterOf(next.scene));
    input('direction').value=next.direction ?? '';
    input('yaw').value=String(next.scene.camera?.yaw ?? defaultCamera.yaw);
    input('elevation').value=String(next.scene.camera?.elevation ?? defaultCamera.elevation);
    input('sendCamera').checked=!!next.scene.camera;
    input('sendLight').checked=next.scene.light!==undefined;
    input('light').value=String(next.scene.light ?? 55);
    for(const p of parts) {
      const value=palette.findIndex(m=>m.color===next.scene.materials[p]?.color);
      choice(p).value=value<0?'':String(value);
    }
    preview();
  }
  byId('reuseGripOption').hidden=next.materialReference===null;
  byId('historyOption').hidden=next.materialReference===null;
  byId('reuseGripLabel').textContent=next.materialReference
    ? '读取已获批修订 '+next.materialReference.revision+' 的'+drawing.parts[next.materialReference.part].label+'材质' : '';
  byId('status').textContent=next.message;byId('version').textContent='CAD · 修订 '+next.revision;
  const link=document.querySelector<HTMLAnchorElement>('#download')!;
  cut.hidden=!next.artifact||!next.canCut;
  cut.textContent=next.cutStatus==='sent'?'已送交切割 spool':next.cutStatus==='sending'?'正在送交…':'送交切割 spool';
  link.hidden=!next.artifact;byId('delivery').hidden=!next.artifact;
  if(next.artifact){link.download=drawing.id+'.ora';link.href=next.artifact+'/painting.ora';document.querySelector<HTMLImageElement>('#asset')!.src=next.artifact+'/beauty.png';}
}
controls.addEventListener('input',preview);
function subscribe() {
  const events=new EventSource('/events');
  events.onmessage=e=>{connected=true;update(JSON.parse(e.data));};
  events.onerror=()=>{connected=false;lock();byId('status').textContent='连接中断 · CAD 已锁定';};
  return events;
}
let events=subscribe();
input('reuseGrip').onchange=()=>{if(input('reuseGrip').checked) input('verifyHistory').checked=false;};
input('verifyHistory').onchange=()=>{if(input('verifyHistory').checked) input('reuseGrip').checked=false;};
byId('save').onclick=async()=>{
  if(controls.disabled || !state)return;
  posting=true;lock();byId('error').textContent='';
  try {
    const scene=draft();
    const reference=state.materialReference;
    const reuseMaterial=input('reuseGrip').checked ? reference?.revision : undefined;
    const materialHistory=input('verifyHistory').checked && reference ? 'last-accepted' : undefined;
    if (reference && (reuseMaterial!==undefined || materialHistory)) delete scene.materials[reference.part];
    const request={epoch:state.epoch,revision:state.revision,scene,direction:input('direction').value,reuseMaterial,materialHistory};
    const reply=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    if(!reply.ok) byId('error').textContent=await reply.text();
  } catch(error) {
    byId('error').textContent=String(error);
    // An interrupted POST may still have been admitted. Wait for the server's state.
    connected=false;
    events.close();
    events=subscribe();
  } finally {posting=false;lock();}
};

cut.onclick=async()=>{
  if (cut.disabled || !state?.artifact) return;
  cut.disabled=true;
  byId('error').textContent='';
  try {
    const reply=await fetch('/cut',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({epoch:state.epoch,artifact:state.artifact})});
    if (!reply.ok) throw Error(await reply.text());
  } catch(error) {byId('error').textContent=String(error);}
  finally {lock();}
};
