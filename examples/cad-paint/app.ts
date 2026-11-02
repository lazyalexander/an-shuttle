import {vise,polygons,parts,defaultCamera,type Scene,type Material,type Vec} from '@an-shuttle/cad/scene.js';
const byId=(id:string)=>document.getElementById(id)!;
const input=(id:string)=>document.querySelector<HTMLInputElement>('#'+id)!;
const controls=document.querySelector<HTMLFieldSetElement>('#controls')!;
const canvas=document.querySelector('canvas')!;
const ctx=canvas.getContext('2d')!;
const palette:Material[]=[{finish:'petrol enamel',color:'#23615d'},{finish:'ground steel',color:'#bdc9cb'},{finish:'brushed brass',color:'#b68c55'}];
const labels={base:'底座',rail:'传动与五金',fixedJaw:'固定钳口',movingJaw:'活动钳口'};
for (const part of parts) {
  const label=document.createElement('label'), select=document.createElement('select');
  label.textContent=labels[part];select.id=part;
  select.add(new Option('让模型生成',''));
  for(const [i,name] of ['青绿烤漆','磨削钢','黄铜'].entries()) select.add(new Option(name,String(i)));
  label.append(select);byId('materials').append(label);
}
const choice=(p:string)=>document.querySelector<HTMLSelectElement>('#'+p)!;
function draft(): Scene {
  const s:Scene={gap:input('gap').valueAsNumber,materials:{}};
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
  const faces=vise(s.gap).flatMap(solid=>polygons(solid).flatMap(poly=>{
    const delta=(p:Vec):Vec=>[p[0]-poly[0][0],p[1]-poly[0][1],p[2]-poly[0][2]];
    const a=delta(poly[1]),b=delta(poly[2]),n:Vec=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    if(dot(n,eye)<=0)return [];
    const intensity=.63+.37*Math.max(0,dot(n,[.8*Math.cos(sun),.8*Math.sin(sun),.6])/Math.hypot(...n));
    const c=s.materials[solid.part]?.color ?? '#9da9a3';
    const rgb=[1,3,5].map(i=>Math.round(parseInt(c.slice(i,i+2),16)*intensity));
    return [{poly,depth:poly.reduce((v,p)=>v+dot(p,eye),0)/poly.length,fill:'rgb('+rgb.join(',')+')'}];
  }));
  ctx.clearRect(0,0,960,680);
  for(const face of faces.sort((a,b)=>a.depth-b.depth)) {
    ctx.beginPath();
    face.poly.forEach(([x,y,z],i)=>{
      const u=480+6.15*(-Math.sin(yaw)*(x-4)+Math.cos(yaw)*y);
      const v=340+6.15*(Math.sin(elev)*(Math.cos(yaw)*(x-4)+Math.sin(yaw)*y)-Math.cos(elev)*(z-18));
      if(i===0)ctx.moveTo(u,v);else ctx.lineTo(u,v);
    });
    ctx.closePath();ctx.fillStyle=face.fill;ctx.fill();ctx.strokeStyle=face.fill;ctx.stroke();
  }
  byId('gapValue').textContent=s.gap+' mm';
}
interface State {epoch:string;revision:number;scene:Scene;locked:boolean;artifact:string|null;message:string;canCut:boolean;cutStatus:string}
let state:State|null=null, posting=false, connected=false;
const cut = document.querySelector<HTMLButtonElement>('#cut')!;
function lock(){
  controls.disabled=posting||!connected||!state||state.locked;
  cut.disabled=controls.disabled||state?.cutStatus!=='ready';
}
function update(next:State) {
  if(!state || state.epoch!==next.epoch || state.revision!==next.revision) {
    input('gap').value=String(next.scene.gap);
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
  state=next;lock();byId('status').textContent=next.message;byId('version').textContent='CAD · 修订 '+next.revision;
  const link=document.querySelector<HTMLAnchorElement>('#download')!;
  cut.hidden=!next.artifact||!next.canCut;
  cut.textContent=next.cutStatus==='sent'?'已送交切割 spool':next.cutStatus==='sending'?'正在送交…':'送交切割 spool';
  link.hidden=!next.artifact;byId('delivery').hidden=!next.artifact;
  if(next.artifact){link.href=next.artifact+'/painting.ora';document.querySelector<HTMLImageElement>('#asset')!.src=next.artifact+'/beauty.png';}
}
controls.addEventListener('input',preview);
const events=new EventSource('/events');
events.onmessage=e=>{connected=true;update(JSON.parse(e.data));};
events.onerror=()=>{connected=false;lock();byId('status').textContent='连接中断 · CAD 已锁定';};
byId('save').onclick=async()=>{
  if(controls.disabled || !state)return;
  const request={epoch:state.epoch,revision:state.revision,scene:draft()};
  posting=true;lock();byId('error').textContent='';
  try{
    const reply=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    if(!reply.ok)throw Error(await reply.text());
    // The event stream owns shared state across all open CAD windows.
  }catch(error){byId('error').textContent=String(error);}
  finally{posting=false;lock();}
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
