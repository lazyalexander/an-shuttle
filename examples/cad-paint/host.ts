import {execFile} from 'node:child_process';
import {mkdir, realpath, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const run = 'paint';
const products = ['beauty.png', 'painting.ora'] as const;
interface Identity { instance: string; release: string }
interface RunStatus extends Identity { run: string; phase: string; termination_confirmed: boolean; execution_status: string }
interface Result extends Identity { run: string; status: string; workspace?: {termination_confirmed: boolean} }
interface Output { path: string; binding: {revision: string; content_sha256: string} }
interface Inventory extends Identity { run: string; catalog: string; outputs: Output[] }

type Host = <T>(...args: string[]) => Promise<T>;

async function command<T>(binary: string, args: string[]): Promise<T> {
  try {
    const {stdout} = await execute(binary,args,{encoding:'utf8',maxBuffer:4*1024*1024});
    return JSON.parse(stdout) as T;
  } catch (error) {
    if (error instanceof Error && 'stderr' in error && typeof error.stderr==='string' && error.stderr.trim())
      throw new Error(args[0]+' — '+error.stderr.trim(),{cause:error});
    throw error;
  }
}

async function selectHost(): Promise<Host> {
  const selected=process.env.AN_AGENT_HOST_BIN ?? 'an-agent-host';
  // The supervisor binds its own executable. Resolve operator-provided launchers before the preview.
  const located=selected.includes('/') ? selected : (await execute('/usr/bin/which',[selected])).stdout.trim();
  const binary=await realpath(located);
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
  const args = await approval(host,['spool-supervisor','start',instance,run,input,'120']);
  // Once submitted the independent owner may outlive its CLI. Never replay the start.
  const result = await host<Result>(...args).catch(() => undefined);
  if (result && sameRun(result, loaded) && result.workspace?.termination_confirmed === true) return result.status;
  waiting();
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
