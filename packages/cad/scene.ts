// A saved vise has three independent appearance capabilities.
export const parts = ['base', 'rail', 'fixedJaw', 'movingJaw'] as const;
export type Part = typeof parts[number];
export interface Material { finish: string; color: string }
export interface Camera { yaw: number; elevation: number }
export interface Appearance {
  camera?: Camera;
  light?: number;
  materials: Partial<Record<string, Material>>;
}
export interface Scene extends Appearance {gap:number}
export type Vec = [number, number, number];
export const defaultCamera: Camera = {yaw: 38, elevation: 28};

export function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
export function bounded(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}
export function color(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}
export function material(v: unknown): v is Material {
  return record(v) && color(v.color) && typeof v.finish === 'string' && v.finish.trim().length > 0 && v.finish.length <= 80;
}
export function snapshot(input: unknown): Scene {
  if (!record(input) || !bounded(input.gap, 2, 48) || !record(input.materials)) throw Error('Invalid vise geometry or material map');
  return {gap:input.gap, ...readAppearance(input, parts)};
}
export function readAppearance(input: Record<string,unknown>, partIds: readonly string[]): Appearance {
  if (!record(input.materials)) throw Error('Invalid material map');
  const scene: Appearance = {materials:{}};
  if (input.camera !== undefined) {
    const c = input.camera;
    if (!record(c) || !bounded(c.yaw,-180,180) || !bounded(c.elevation,5,80)) throw Error('Invalid camera');
    scene.camera = {yaw:c.yaw, elevation:c.elevation};
  }
  if (input.light !== undefined) {
    if (!bounded(input.light,-180,180)) throw Error('Invalid light');
    scene.light = input.light;
  }
  for (const part of partIds) {
    const m = input.materials[part];
    if (m === undefined) continue;
    if (!material(m)) throw Error('Invalid material for '+part);
    scene.materials[part] = {color:m.color, finish:m.finish};
  }
  return scene;
}

export interface Solid {
  name: string;
  part: Part;
  shape: 'box'|'cylinder';
  center: Vec;
  size: Vec;
  axis: 'x'|'y'|'z';
  bevel: number;
}
// All dimensions are millimetres. Cylinders have the indicated world-space bounding box.
export function vise(gap: number): Solid[] {
  const solids: Solid[] = [];
  function box(name: string,part: Part,center: Vec,size: Vec,bevel=1) {
    solids.push({name,part,shape:'box',center,size,bevel,axis:'z'});
  }
  function cylinder(name: string,part: Part,center: Vec,axis: Solid['axis'],radius: number,length: number) {
    const size: Vec=[2*radius,2*radius,2*radius];
    size['xyz'.indexOf(axis)] = length;
    solids.push({name,part,shape:'cylinder',center,size,axis,bevel:Math.min(0.45,length/4)});
  }
  const slide = -25+gap+5;
  box('Cast foot','base',[0,0,3],[105,46,6],2.5);
  box('Bed','base',[0,0,10],[96,32,10],2.8);
  for(const y of [-11,11]) box('Ground guide','rail',[0,y,16],[90,5,3],0.6);
  for(const [part,x] of [['fixedJaw',-31],['movingJaw',slide]] as const) {
    box('Jaw carriage',part,[x,0,21],[19,35,9],2);
    box('Jaw tower',part,[x,0,30],[11,42,18],1.6);
    const sign=part==='fixedJaw'?1:-1;
    box('Contact pad','rail',[x+sign*5.8,0,34],[1.3,39,9],0.45);
    for(const y of [-13,13]) cylinder('Cap screw','rail',[x-sign*6,y,34],'x',2.4,1.7);
  }
  cylinder('Lead screw','rail',[slide+15,0,22],'x',3.1,31);
  cylinder('Hub','movingJaw',[slide+31,0,22],'x',5.7,8);
  cylinder('Tommy bar','rail',[slide+31,0,22],'y',1.6,43);
  for(const y of [-21,21]) cylinder('Bar stop','rail',[slide+31,y,22],'y',2.7,3.2);
  for(const x of [-46,46]) for(const y of [-17,17]) {
    cylinder('Foot washer','rail',[x,y,6.5],'z',3.2,1);
    cylinder('Anchor head','rail',[x,y,7.6],'z',2.1,1.5);
  }
  return solids;
}

export function polygons(s: Solid): Vec[][] {
  const mapped=(p: Vec): Vec=>p.map((n,i)=>s.center[i]+n*s.size[i]/2) as Vec;
  if(s.shape==='box') {
    const faces: Vec[][]=[];
    for(let axis=0;axis<3;axis++) for(const sign of [-1,1]) {
      const u=(axis+1)%3,v=(axis+2)%3;
      faces.push([[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>{
        const p:Vec=[0,0,0];p[axis]=sign;p[u]=a;p[v]=sign*b;return mapped(p);
      }));
    }
    return faces;
  }
  const axis='xyz'.indexOf(s.axis), u=(axis+1)%3,v=(axis+2)%3;
  const rings=[-1,1].map(sign=>Array.from({length:32},(_,i)=>{
    const p:Vec=[0,0,0];p[axis]=sign;p[u]=Math.cos(i*Math.PI/16);p[v]=Math.sin(i*Math.PI/16);return mapped(p);
  }));
  return [rings[0].slice().reverse(),rings[1],...rings[0].map((p,i)=>{
    const next=(i+1)%32;return [p,rings[0][next],rings[1][next],rings[1][i]];
  })];
}
