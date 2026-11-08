import {daemonApproved,daemonRequest,selectedHost} from './daemon.js';
import {execFile} from 'node:child_process';
import {mkdir, readFile, realpath, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {promisify,isDeepStrictEqual} from 'node:util';

const execute = promisify(execFile);
const run = 'paint';
const products = ['beauty.png', 'painting.ora'] as const;
interface Identity { instance: string; release: string }
interface RunStatus extends Identity { run: string; phase: string; termination_confirmed: boolean; execution_status: string }
interface Output { path: string; binding: {revision: string; content_sha256: string} }
interface Inventory extends Identity { run: string; catalog: string; outputs: Output[] }

type Host = <T>(...args: string[]) => Promise<T>;

async function command<T>(binary: string, args: string[], signal?: AbortSignal): Promise<T> {
  try {
    const {stdout} = await execute(binary,args,{encoding:'utf8',maxBuffer:4*1024*1024,signal});
    return JSON.parse(stdout) as T;
  } catch (error) {
    if (error instanceof Error && 'stderr' in error && typeof error.stderr==='string' && error.stderr.trim())
      throw new Error(args[0]+' — '+error.stderr.trim(),{cause:error});
    throw error;
  }
}

async function selectHost(): Promise<Host> {
  const binary=await selectedHost();
  return <T>(...args: string[]) => command<T>(binary,args);
}

async function approval(host: Host, args: string[]) {
  const preview = await host<{approval_sha256: string}>(...args);
  if (!/^[0-9a-f]{64}$/.test(preview.approval_sha256)) throw Error('Host returned an invalid approval digest');
  return [...args, '--approve', preview.approval_sha256];
}

function sameRun(record: Identity & {run: string}, loaded: Identity) {
  return record.instance === loaded.instance && record.release === loaded.release && record.run === run;
}

async function executeAttempt(host: Host, instance: string, loaded: Identity, input: string, waiting: () => void) {
  await daemonRequest({op:'register',instance});
  try {
    const task=await daemonApproved({op:'submit',instance,run,input,seconds:120});
    await writeFile(join(instance,'daemon-task.json'),JSON.stringify(task),{flag:'wx',mode:0o600});
  } catch {
    // Submission may already be durable. Only original native evidence can
    // release the CAD lock; do not submit again or turn reply loss into failure.
  }
  waiting();
  // Queue completion never substitutes for the exact original native receipt.
  return observeTermination(loaded,() => host<RunStatus>('spool-status',instance,run));
}

// Only evidence for this exact run can release the caller's CAD lock.
export async function observeTermination(loaded: Identity, readStatus: () => Promise<RunStatus>,
                                         wait = () => delay(2000)) {
  for (;;) {
    const status = await readStatus().catch(() => undefined);
    if (status && sameRun(status, loaded)) {
      if (status.termination_confirmed === true) return status.execution_status;
      // After the submitting CLI exits, a preview with no supervisor reservation admitted no worker.
      if (status.phase === 'prepared') throw Error('The host did not reserve this paint attempt');
    }
    await wait();
  }
}

export async function renderWithHost(folder: string, input: string, candidate: string | null,
                                     runtime: string, waiting: () => void) {
  const host = await selectHost();
  const archive = fileURLToPath(import.meta.resolve('@an-loom/cad-paint-spool/archive'));
  const delivery = join(folder,'native-release'), instance = join(folder,'instance');
  await command(process.env.AN_LOOM_BIN ?? 'an-loom',['export-native-spool-v3',archive,delivery]);
  const loaded = await host<Identity>('spool-load',delivery,instance,'--runtime',runtime);
  if (candidate) await host(...await approval(host,['spool-kit-update',instance,'appearance.py',candidate]));
  const status = await executeAttempt(host,instance,loaded,input,waiting);
  if (status !== 'succeeded') throw Error('Host paint attempt ended: '+status);
  await host(...await approval(host,['spool-accept',instance,run]));
  const accepted = await host<Inventory>('spool-artifacts',instance,run);
  if (!sameRun(accepted, loaded) || accepted.outputs.length !== products.length)
    throw Error('Unexpected accepted painting inventory');

  const staged = join(folder,'checkout');
  await mkdir(staged);
  for (const name of products) {
    const binding = accepted.outputs.find(item => item.path === name)?.binding;
    if (!binding || !/^[0-9a-f]{64}$/.test(binding.revision)) throw Error('Missing accepted output: '+name);
    await host('artifact-checkout',accepted.catalog,binding.revision,join(staged,name));
  }
  await writeFile(join(folder,'accepted.json'),JSON.stringify(accepted),{flag:'wx'});
  // The download route requires the ORA. Move it last, only after both fixed checkouts succeeded.
  for (const name of products) await rename(join(staged,name),join(folder,name));
  return join(folder,'painting.ora');
}

export type {MaterialEvidence} from '@an-spool/cad-material-policy';
import type {MaterialEvidence} from '@an-spool/cad-material-policy';

export async function authorizeMaterialDisclosure(reader:string,document:string,part:string,signal:AbortSignal) {
  signal.throwIfAborted();
  const disclosure='codex-selected-material';
  const grant=await command<{document:string;part:string;disclosure:string}>(process.env.PYTHON_BIN ?? 'python3',
    ['-B',reader,'--check-delegation','--document',document,'--part',part,'--disclosure',disclosure],signal);
  if (!isDeepStrictEqual(grant,{document,part,disclosure}))
    throw Error('Reader did not authorize Codex material disclosure');
  signal.throwIfAborted();
}

export async function readPreviousMaterial(reader:string, folder:string, document:string,
                                       epoch:string, revision:number, part:string, delegated=false, signal?:AbortSignal):Promise<MaterialEvidence> {
  const accepted:Inventory=JSON.parse(await readFile(join(folder,'accepted.json'),'utf8'));
  const selected=accepted.outputs.find(output=>output.path==='painting.ora')?.binding.revision;
  if (!selected) throw Error('Missing accepted ORA revision');
  const result=await command<MaterialEvidence>(process.env.PYTHON_BIN ?? 'python3',
    ['-B',reader,'--host',await selectedHost(),'--instance',join(folder,'instance'),'--run',run,
      '--paint-release',accepted.release,'--artifact-revision',selected,
      '--document',document,'--epoch',epoch,'--revision',String(revision),'--part',part,...(delegated ? ['--delegated','--disclosure','codex-selected-material'] : [])],signal);
  if (result.schema!=='cad-material-evidence-v1' || result.part!==part ||
      result.source.document!==document || result.source.epoch!==epoch || result.source.revision!==revision ||
      result.artifact.release!==accepted.release || result.artifact.revision!==selected)
    throw Error('Material evidence does not match the selected acceptance');
  return result;
}
