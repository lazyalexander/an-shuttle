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
import {appearanceKit} from '@an-spool/cad-material-policy';
import {completeMaterials} from './codex-completion.js';

async function prepare(scene:SavedDrawing, revision:number, folder:string, drawing:Model, epoch:string, direction:string, reused?:MaterialEvidence, signal:AbortSignal=new AbortController().signal) {
  signal.throwIfAborted();
  const request={...paintRequest(drawing,scene,epoch,revision,direction),
    ...(reused ? {material_evidence:reused} : {})};
  const root=resolve(folder);
  await writeFile(join(root,'saved.json'),JSON.stringify(request),{flag:'wx'});
  const model=process.env.CAD_MATERIAL_CODEX_MODEL ?? 'codex-default';
  const missing=Object.fromEntries(Object.entries(request.parts).filter(([p])=>!request.scene.materials[p])
    .map(([p,spec])=>[p,{label:spec.label}]));
  const {code,needsModel}=await appearanceKit({...request.context,supplied:request.scene.materials,missing},
    reused,brief=>completeMaterials(brief,root,signal));
  signal.throwIfAborted();
  const candidate=join(root,'appearance.py');
  if (code!==null) await writeFile(candidate,code,{flag:'wx'});
  signal.throwIfAborted();
  const input=join(root,'request.json');
  await writeFile(input,JSON.stringify({...request,agent:{model:needsModel?model:null}}),{flag:'wx'});
  return {root, input, candidate:code===null ? null : candidate};
}

// The signal covers preparation; native render settlement stays with the host.
export async function paint(scene:SavedDrawing, revision:number, folder:string, drawing:Model=benchVise,
                            epoch:string=randomUUID(), direction='', waiting=()=>{}, reused?:MaterialEvidence, signal:AbortSignal=new AbortController().signal, materialReady=()=>{}) {
  const runtime=process.env.CAD_PAINT_RUNTIME;
  if (!runtime) throw Error('Set CAD_PAINT_RUNTIME to the selected native Python runtime JSON.');
  const binding=await realpath(runtime);
  const {root,input,candidate}=await prepare(scene,revision,await realpath(folder),drawing,epoch,direction,reused,signal);
  signal.throwIfAborted();materialReady();
  return renderWithHost(root,input,candidate,binding,waiting);
}

// Explicit standalone mode for operators with a local renderer outside the managed macOS profile.
export async function paintStandalone(scene:SavedDrawing, revision:number, folder:string, drawing:Model=benchVise,
                                      epoch:string=randomUUID(), direction='', _waiting=()=>{}, reused?:MaterialEvidence,
                                      signal:AbortSignal=new AbortController().signal, materialReady=()=>{}) {
  const {root,input,candidate}=await prepare(scene,revision,folder,drawing,epoch,direction,reused,signal);
  signal.throwIfAborted();materialReady();
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
