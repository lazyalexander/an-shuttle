import {randomInt} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {bounded,defaultCamera,material,parts,record,vise,type Material,type Part,type Scene} from '@an-shuttle/cad/scene.js';
import {packPainting} from '@an-shuttle/krita/document.js';

type Surface = Material & {metallic:number; roughness:number};
const ids = {base:'#ff0000',rail:'#00ff00',fixedJaw:'#0000ff',movingJaw:'#ffff00'};
function surface(v: unknown): v is Surface {
  return record(v) && material(v) && bounded(v.metallic,0,1) && bounded(v.roughness,0,1);
}
export async function generateMaterials(missing: Part[], scene: Scene): Promise<Record<string,unknown>> {
  const property = {type:'object',required:['finish','color','metallic','roughness'],properties:{
    finish:{type:'string'},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},
    metallic:{type:'number',minimum:0,maximum:1},roughness:{type:'number',minimum:0,maximum:1},
  }};
  const response = await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
    signal:AbortSignal.timeout(120_000),body:JSON.stringify({model:process.env.OLLAMA_MODEL ?? 'gemma4:e4b',stream:false,think:false,
      prompt:'Design plausible physically based materials for a small vintage bench vise. Art direction: petrol enamel, machined steel and restrained warm accents. Keep supplied finishes. Return only missing parts. '+JSON.stringify({missing,supplied:scene.materials}),
      format:{type:'object',required:missing,additionalProperties:false,properties:Object.fromEntries(missing.map(p=>[p,property]))},
    })});
  if (!response.ok) throw Error('Local material model returned HTTP '+response.status);
  const data = JSON.parse((await response.json()).response);
  if (!record(data)) throw Error('Invalid material plan');
  return data;
}
export async function recipe(scene: Scene, revision: number, generate=generateMaterials) {
  const missing = parts.filter(p=>!scene.materials[p]);
  const generated = missing.length ? await generate(missing,scene) : {};
  const materials = {} as Record<Part,Surface>;
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
  return {revision,scene,solids:vise(scene.gap),light:scene.light ?? randomInt(-180,180),camera:scene.camera ?? defaultCamera,
    materials,ids,generated:missing,model:missing.length ? process.env.OLLAMA_MODEL ?? 'gemma4:e4b' : null};
}
export async function paint(scene: Scene, revision: number, folder: string) {
  await writeFile(join(folder,'saved.json'),JSON.stringify({revision,scene},null,2),{flag:'wx'});
  const job = await recipe(scene,revision);
  await writeFile(join(folder,'scene.json'),JSON.stringify(job,null,2),{flag:'wx'});
  const worker=fileURLToPath(new URL('../render.py',import.meta.url));
  await promisify(execFile)(process.env.PYTHON_BIN ?? 'python3',[worker,folder],{timeout:240_000,maxBuffer:4*1024*1024});
  return packPainting(folder);
}
