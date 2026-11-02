// Studio host adapter. The package owns intent interpretation and rendering.
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {benchVise,type Model,type SavedDrawing} from '@an-shuttle/cad/drawing.js';
import {paintRequest} from '@an-shuttle/cad/shuttle.js';
import {instructions, materialSchema, planKit, type MaterialBrief} from '@an-loom/cad-paint-spool/agent';

async function ollama(brief:MaterialBrief, model:string):Promise<unknown> {
  const parts=Object.keys(brief.missing);
  const reply=await fetch('http://127.0.0.1:11434/api/generate',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120_000),
    body:JSON.stringify({model,stream:false,think:false,prompt:instructions(brief),
      format:{type:'object',required:parts,additionalProperties:false,
        properties:Object.fromEntries(parts.map(p=>[p,materialSchema]))}}),
  });
  if (!reply.ok) throw Error('Local material model returned HTTP '+reply.status);
  return JSON.parse((await reply.json()).response);
}
export async function paint(scene:SavedDrawing, revision:number, folder:string, drawing:Model=benchVise,
                            epoch:string=randomUUID(), direction='') {
  const request=paintRequest(drawing,scene,epoch,revision,direction);
  const root=resolve(folder);
  // Persist the original event before awaiting a model. Each save owns its directory.
  await writeFile(join(root,'saved.json'),JSON.stringify(request),{flag:'wx'});
  const model=process.env.OLLAMA_MODEL ?? 'gemma4:e4b';
  const missing=Object.fromEntries(Object.entries(request.parts).filter(([p])=>!request.scene.materials[p])
    .map(([p,spec])=>[p,{label:spec.label}]));
  const candidate=await planKit({...request.context,supplied:request.scene.materials,missing},brief=>ollama(brief,model));
  const entry=fileURLToPath(import.meta.resolve('@an-loom/cad-paint-spool/entry'));
  const silk=dirname(entry), kit=join(root,'kit');
  await mkdir(kit);
  if (candidate===null) await copyFile(join(silk,'../kit/appearance.py'),join(kit,'appearance.py'));
  else await writeFile(join(kit,'appearance.py'),candidate,{flag:'wx'});
  const input=join(root,'request.json');
  await writeFile(input,JSON.stringify({...request,agent:{model:candidate===null?null:model}}),{flag:'wx'});
  await promisify(execFile)(process.env.PYTHON_BIN ?? 'python3',['-B',entry],{
    cwd:root, timeout:240_000, maxBuffer:4*1024*1024,
    env:{...process.env,AN_SPOOL_INPUT:input,AN_SPOOL_SILK_DIR:silk,AN_SPOOL_KIT_DIR:kit},
  });
  return join(root,'painting.ora');
}
