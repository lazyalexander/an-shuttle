// Studio host adapter. The package owns intent interpretation and rendering.
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyFile, mkdir, realpath, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {benchVise,type Model,type SavedDrawing} from '@an-shuttle/cad/drawing.js';
import {paintRequest} from '@an-shuttle/cad/shuttle.js';
import {renderWithHost,type GripEvidence} from './host.js';
import {instructions, materialSchema, planKit, type MaterialBrief} from '@an-loom/cad-paint-spool/agent';

async function ollama(brief:MaterialBrief, model:string):Promise<unknown> {
  const parts=Object.keys(brief.missing);
  const reply=await fetch(new URL('/api/generate',process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'),{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120_000),
    body:JSON.stringify({model,stream:false,think:false,prompt:instructions(brief),
      format:{type:'object',required:parts,additionalProperties:false,
        properties:Object.fromEntries(parts.map(p=>[p,materialSchema]))}}),
  });
  if (!reply.ok) throw Error('Local material model returned HTTP '+reply.status);
  return JSON.parse((await reply.json()).response);
}
async function prepare(scene:SavedDrawing, revision:number, folder:string, drawing:Model, epoch:string, direction:string, reused?:GripEvidence) {
  const request={...paintRequest(drawing,scene,epoch,revision,direction),
    ...(reused ? {material_evidence:reused} : {})};
  const root=resolve(folder);
  await writeFile(join(root,'saved.json'),JSON.stringify(request),{flag:'wx'});
  const model=process.env.OLLAMA_MODEL ?? 'gemma4:e4b';
  const missing=Object.fromEntries(Object.entries(request.parts).filter(([p])=>!request.scene.materials[p])
    .map(([p,spec])=>[p,{label:spec.label}]));
  const modelMissing=Object.fromEntries(Object.entries(missing).filter(([part])=>!reused||part!=='grip'));
  const needsModel=Object.keys(modelMissing).length!==0;
  const code=await planKit({...request.context,supplied:request.scene.materials,missing},async brief=>{
    const proposal=needsModel ? await ollama({...brief,missing:modelMissing},model) : {};
    if (!reused) return proposal;
    if (!proposal || typeof proposal!=='object' || Array.isArray(proposal) ||
        Object.keys(proposal).some(part=>!Object.hasOwn(modelMissing,part)))
      throw Error('Unexpected material proposal');
    return {...proposal,grip:reused.material};
  });
  const candidate=join(root,'appearance.py');
  if (code!==null) await writeFile(candidate,code,{flag:'wx'});
  const input=join(root,'request.json');
  await writeFile(input,JSON.stringify({...request,agent:{model:needsModel?model:null}}),{flag:'wx'});
  return {root, input, candidate:code===null ? null : candidate};
}

export async function paint(scene:SavedDrawing, revision:number, folder:string, drawing:Model=benchVise,
                            epoch:string=randomUUID(), direction='', waiting=()=>{}, reused?:GripEvidence) {
  const runtime=process.env.CAD_PAINT_RUNTIME;
  if (!runtime) throw Error('Set CAD_PAINT_RUNTIME to the selected native Python runtime JSON.');
  const binding=await realpath(runtime);
  const {root,input,candidate}=await prepare(scene,revision,await realpath(folder),drawing,epoch,direction,reused);
  return renderWithHost(root,input,candidate,binding,waiting);
}

// Explicit standalone mode for operators with a local renderer outside the managed macOS profile.
export async function paintStandalone(scene:SavedDrawing, revision:number, folder:string, drawing:Model=benchVise,
                                      epoch:string=randomUUID(), direction='') {
  const {root,input,candidate}=await prepare(scene,revision,folder,drawing,epoch,direction);
  const entry=fileURLToPath(import.meta.resolve('@an-loom/cad-paint-spool/entry'));
  const silk=dirname(entry), kit=join(root,'kit');
  await mkdir(kit);
  await copyFile(candidate ?? join(silk,'../kit/appearance.py'),join(kit,'appearance.py'));
  await promisify(execFile)(process.env.PYTHON_BIN ?? 'python3',['-B',entry],{
    cwd:root, timeout:240_000, maxBuffer:4*1024*1024,
    env:{...process.env,AN_SPOOL_INPUT:input,AN_SPOOL_SILK_DIR:silk,AN_SPOOL_KIT_DIR:kit},
  });
  return join(root,'painting.ora');
}
