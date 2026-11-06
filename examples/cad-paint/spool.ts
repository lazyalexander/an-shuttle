// Studio host adapter. The package owns intent interpretation and rendering.
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyFile, mkdir, realpath, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {benchVise,type Model,type SavedDrawing} from '@an-shuttle/cad/drawing.js';
import {paintRequest} from '@an-shuttle/cad/shuttle.js';
import {renderWithHost,type MaterialEvidence} from './host.js';
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
export type Quality='preview'|'final';
/** A preview asks the spool for the same part layers with fewer beauty samples. */
export interface PaintOptions {quality?:Quality;signal?:AbortSignal}

async function prepare(scene:SavedDrawing, revision:number, folder:string, drawing:Model, epoch:string, direction:string,
                       reused?:MaterialEvidence, quality:Quality='final') {
  // A final request stays byte-compatible with spools that predate the quality field.
  const request={...paintRequest(drawing,scene,epoch,revision,direction),
    ...(reused ? {material_evidence:reused} : {}),
    ...(quality==='preview' ? {quality} : {})};
  const root=resolve(folder);
  await writeFile(join(root,'saved.json'),JSON.stringify(request),{flag:'wx'});
  const model=process.env.OLLAMA_MODEL ?? 'qwen3:8b';
  const missing=Object.fromEntries(Object.entries(request.parts).filter(([p])=>!request.scene.materials[p])
    .map(([p,spec])=>[p,{label:spec.label}]));
  const modelMissing=Object.fromEntries(Object.entries(missing).filter(([part])=>!reused||part!==reused.part));
  const needsModel=Object.keys(modelMissing).length!==0;
  const code=await planKit({...request.context,supplied:request.scene.materials,missing},async brief=>{
    const proposal=needsModel ? await ollama({...brief,missing:modelMissing},model) : {};
    if (!reused) return proposal;
    if (!proposal || typeof proposal!=='object' || Array.isArray(proposal) ||
        Object.keys(proposal).some(part=>!Object.hasOwn(modelMissing,part)))
      throw Error('Unexpected material proposal');
    return {...proposal,[reused.part]:reused.material};
  });
  const candidate=join(root,'appearance.py');
  if (code!==null) await writeFile(candidate,code,{flag:'wx'});
  const input=join(root,'request.json');
  await writeFile(input,JSON.stringify({...request,agent:{model:needsModel?model:null}}),{flag:'wx'});
  return {root, input, candidate:code===null ? null : candidate};
}

export async function paint(scene:SavedDrawing, revision:number, folder:string, drawing:Model=benchVise,
                            epoch:string=randomUUID(), direction='', waiting=()=>{}, reused?:MaterialEvidence,
                            {quality='final'}:PaintOptions={}) {
  // The supervised attempt is not aborted here; a superseded result is simply not delivered.
  const runtime=process.env.CAD_PAINT_RUNTIME;
  if (!runtime) throw Error('Set CAD_PAINT_RUNTIME to the selected native Python runtime JSON.');
  const binding=await realpath(runtime);
  const {root,input,candidate}=await prepare(scene,revision,await realpath(folder),drawing,epoch,direction,reused,quality);
  return renderWithHost(root,input,candidate,binding,waiting);
}

// Explicit standalone mode for operators with a local renderer outside the managed macOS profile.
export async function paintStandalone(scene:SavedDrawing, revision:number, folder:string, drawing:Model=benchVise,
                                      epoch:string=randomUUID(), direction='', _waiting=()=>{}, _reused?:MaterialEvidence,
                                      {quality='final',signal}:PaintOptions={}) {
  const {root,input,candidate}=await prepare(scene,revision,folder,drawing,epoch,direction,undefined,quality);
  // CAD_PAINT_SPOOL_DIR selects an unreleased spool checkout for standalone development only.
  const local=process.env.CAD_PAINT_SPOOL_DIR;
  const entry=local ? join(resolve(local),'silk','main.py') : fileURLToPath(import.meta.resolve('@an-loom/cad-paint-spool/entry'));
  const silk=dirname(entry), kit=join(root,'kit');
  await mkdir(kit);
  await copyFile(candidate ?? join(silk,'../kit/appearance.py'),join(kit,'appearance.py'));
  const {stderr}=await promisify(execFile)(process.env.PYTHON_BIN ?? 'python3',['-B',entry],{
    cwd:root, timeout:240_000, maxBuffer:4*1024*1024, signal,
    env:{...process.env,AN_SPOOL_INPUT:input,AN_SPOOL_SILK_DIR:silk,AN_SPOOL_KIT_DIR:kit},
  });
  const diagnostics=stderr.trim().split('\n').at(-1);
  if (diagnostics?.startsWith('{')) console.log('paint revision',revision,diagnostics);
  return join(root,'painting.ora');
}
