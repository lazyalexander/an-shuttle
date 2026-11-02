import {randomInt} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {bounded,defaultCamera,material,record,type Material} from '@an-shuttle/cad/scene.js';
import {benchVise,geometry,parameterOf,type SavedDrawing,type Model} from '@an-shuttle/cad/drawing.js';
import {packPainting} from '@an-shuttle/krita/document.js';

type Surface = Material & {metallic:number; roughness:number};
function surface(v: unknown): v is Surface {
  return record(v) && material(v) && bounded(v.metallic,0,1) && bounded(v.roughness,0,1);
}
export async function generateMaterials(missing: string[], scene: SavedDrawing, drawing:Model=benchVise): Promise<Record<string,unknown>> {
  const property = {type:'object',required:['finish','color','metallic','roughness'],properties:{
    finish:{type:'string'},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},
    metallic:{type:'number',minimum:0,maximum:1},roughness:{type:'number',minimum:0,maximum:1},
  }};
  const response = await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
    signal:AbortSignal.timeout(120_000),body:JSON.stringify({model:process.env.OLLAMA_MODEL ?? 'gemma4:e4b',stream:false,think:false,
      prompt:'Design plausible physically based materials for '+drawing.description+' Keep supplied finishes. Return only missing parts. '+JSON.stringify({missing,supplied:scene.materials}),
      format:{type:'object',required:missing,additionalProperties:false,properties:Object.fromEntries(missing.map(p=>[p,property]))},
    })});
  if (!response.ok) throw Error('Local material model returned HTTP '+response.status);
  const data = JSON.parse((await response.json()).response);
  if (!record(data)) throw Error('Invalid material plan');
  return data;
}
export async function recipe(scene: SavedDrawing, revision: number, generate=generateMaterials, drawing:Model=benchVise) {
  const parts=Object.keys(drawing.parts);
  const ids=Object.fromEntries(parts.map(id=>[id,drawing.parts[id].color]));
  const missing = parts.filter(p=>!scene.materials[p]);
  const generated = missing.length ? await generate(missing,scene,drawing) : {};
  const materials = {} as Record<string,Surface>;
  for (const p of parts) {
    const m = scene.materials[p];
    if (m) {
      const metal = /steel|brass|metal/i.test(m.finish);
      materials[p] = {...m,metallic:metal?.88:.18,roughness:metal?.28:.43};
    } else {
      const candidate=generated[p];
      if (!surface(candidate)) throw Error('Invalid generated material for '+p);
      materials[p]=candidate;
    }
  }
  return {revision,scene,drawing:drawing.id,title:drawing.title,focus:drawing.focus,width:drawing.width,solids:geometry(drawing,parameterOf(scene)),light:scene.light ?? randomInt(-180,180),camera:scene.camera ?? defaultCamera,
    materials,ids,generated:missing,model:missing.length ? process.env.OLLAMA_MODEL ?? 'gemma4:e4b' : null};
}
export async function paint(scene: SavedDrawing, revision: number, folder: string, drawing:Model=benchVise) {
  await writeFile(join(folder,'saved.json'),JSON.stringify({revision,scene},null,2),{flag:'wx'});
  const job = await recipe(scene,revision,generateMaterials,drawing);
  await writeFile(join(folder,'scene.json'),JSON.stringify(job,null,2),{flag:'wx'});
  const worker=fileURLToPath(new URL('../render.py',import.meta.url));
  await promisify(execFile)(process.env.PYTHON_BIN ?? 'python3',[worker,folder],{timeout:240_000,maxBuffer:4*1024*1024});
  return packPainting(folder);
}
