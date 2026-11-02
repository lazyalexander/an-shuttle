import {bounded, polygons, readAppearance, record, snapshot, vise, type Appearance, type Scene, type Solid, type Vec} from './scene.js';

export interface Mesh { vertices: Vec[]; faces: [number,number,number][] }
export type Geometry = Solid | (Mesh & {shape:'mesh'; part:string});
export type SavedDrawing = Scene | (Appearance & {value:number});
interface DrawingSettings {
  id:string;
  title:string;
  description:string;
  focus:Vec;
  width:number;
  parameter:{label:string; min:number; max:number; initial:number; unit:string};
  parts:Record<string,{label:string; color:string; rotates?:boolean}>;
  materials:Appearance['materials'];
}
export interface MeshDrawing extends DrawingSettings {
  axis:'x'|'y'|'z';
  pivot:Vec;
  meshes:Record<string,Mesh>;
}
export type Model = DrawingSettings | MeshDrawing;
export const benchVise:DrawingSettings = {
  id:'vise', title:'台钳', description:'A small vintage bench vise with petrol enamel, machined steel and restrained warm accents.',
  focus:[4,0,18], width:155,
  parameter:{label:'钳口开度',min:2,max:48,initial:18,unit:' mm'},
  parts:{
    base:{label:'底座',color:'#ff0000'},rail:{label:'传动与五金',color:'#00ff00'},
    fixedJaw:{label:'固定钳口',color:'#0000ff'},movingJaw:{label:'活动钳口',color:'#ffff00'},
  },
  materials:{rail:{finish:'ground steel',color:'#bdc9cb'}},
};
export function saveDrawing(input:unknown, model:Model):SavedDrawing {
  if (!('meshes' in model)) return snapshot(input);
  if (!record(input) || !bounded(input.value,model.parameter.min,model.parameter.max)) throw Error('Invalid CAD parameter');
  return {value:input.value,...readAppearance(input,Object.keys(model.parts))};
}
export function parameterOf(scene:SavedDrawing):number { return 'gap' in scene ? scene.gap : scene.value; }
export function parameterInput(value:number, model:Model) { return 'meshes' in model ? {value} : {gap:value}; }

export function geometry(model:Model,value:number):Geometry[] {
  if (!('meshes' in model)) return vise(value);
  const pivot=model.pivot;
  const axis='xyz'.indexOf(model.axis), u=(axis+1)%3, v=(axis+2)%3;
  const angle=value*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  function rotate(p:Vec):Vec {
    const out:Vec=[...p], a=p[u]-pivot[u], b=p[v]-pivot[v];
    out[u]=pivot[u]+c*a-s*b;
    out[v]=pivot[v]+s*a+c*b;
    return out;
  }
  return Object.entries(model.parts).map(([part,spec])=>{
    const mesh=model.meshes[part];
    return {shape:'mesh',part,faces:mesh.faces,vertices:spec.rotates ? mesh.vertices.map(rotate) : mesh.vertices};
  });
}
export function facesOf(s:Geometry):Vec[][] {
  return s.shape==='mesh' ? s.faces.map(face=>face.map(i=>s.vertices[i])) : polygons(s);
}
