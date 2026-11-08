// Local service transport only. The host owns queuing, client launch and receipts.
import {execFile} from 'node:child_process';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
const execute=promisify(execFile);

export async function selectedHost() {
  return resolveBinary(process.env.AN_AGENT_HOST_BIN ?? 'an-agent-host');
}
export async function daemonRequest<T=any>(request:object):Promise<T> {
  const root=process.env.AN_AGENT_DAEMON_ROOT;
  if(!root) throw Error('AN_AGENT_DAEMON_ROOT must select a running local an-agent service');
  const folder=await mkdtemp(join(tmpdir(),'an-daemon-request-'));
  try {
    const file=join(folder,'request.json');
    await writeFile(file,JSON.stringify(request),{mode:0o600,flag:'wx'});
    const {stdout}=await execute(await selectedHost(),['daemon','request',root,file],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:20_000});
    return JSON.parse(stdout) as T;
  } finally {await rm(folder,{recursive:true,force:true});}
}
export async function daemonApproved(request:object) {
  const preview=await daemonRequest<{approval_sha256:string}>(request);
  if(!/^[a-f0-9]{64}$/.test(preview.approval_sha256)) throw Error('Invalid local service approval');
  return daemonRequest<{id:string}>({...request,approve:preview.approval_sha256});
}
export async function waitTask(id:string,signal?:AbortSignal) {
  let sent=false;
  for(;;) {
    if(signal?.aborted && !sent) {
      try {await daemonApproved({op:'cancel',id});sent=true;} catch {await delay(500);continue;}
    }
    const state=await daemonRequest<{tasks:any[]}>({op:'show'}).catch(()=>undefined);
    if(!state) {await delay(500);continue;}
    const task=state.tasks.find(task=>task.id===id);
    if(!task) {await delay(500);continue;} // Missing evidence stays unknown.
    if(task.state==='settled') {signal?.throwIfAborted();return task;}
    // A lost service connection is an unknown result. Never submit another task.
    await delay(100);
  }
}
export async function resolveBinary(selected:string) {
  return realpath(selected.includes('/') ? selected : (await execute('/usr/bin/which',[selected])).stdout.trim());
}
