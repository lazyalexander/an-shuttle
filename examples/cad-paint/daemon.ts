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
export interface TaskCredential { id: string; secret: string }
export interface TaskScope {
  task: string;
  subject: string;
  expires_ms: number;
  delegate: boolean;
  permissions: object[];
}
export interface TaskGrant {
  grant: {id: string; sha256: string; root: string};
  credential: TaskCredential;
}

export async function daemonRequest<T=any>(request:object):Promise<T> {
  return transport<T>('request', request);
}

export async function daemonTaskRequest<T=any>(credential:TaskCredential, request:object):Promise<T> {
  return transport<T>('task-request', {credential, request});
}

async function transport<T>(operation:string, request:object):Promise<T> {
  const root=process.env.AN_AGENT_DAEMON_ROOT;
  if(!root) throw Error('AN_AGENT_DAEMON_ROOT must select a running local an-agent service');
  const folder=await mkdtemp(join(tmpdir(),'an-daemon-request-'));
  try {
    const file=join(folder,'request.json');
    await writeFile(file,JSON.stringify(request),{mode:0o600,flag:'wx'});
    const {stdout}=await execute(await selectedHost(),['daemon',operation,root,file],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:20_000});
    return JSON.parse(stdout) as T;
  } finally {await rm(folder,{recursive:true,force:true});}
}
export async function daemonApproved<T={id:string}>(request:object, credential?:TaskCredential):Promise<T> {
  const send = <V>(value:object) => credential
    ? daemonTaskRequest<V>(credential, value)
    : daemonRequest<V>(value);
  const preview=await send<{approval_sha256:string}>(request);
  if(!/^[a-f0-9]{64}$/.test(preview.approval_sha256)) throw Error('Invalid local service approval');
  return send<T>({...request,approve:preview.approval_sha256});
}
export async function waitTask(id:string,signal?:AbortSignal,credential?:TaskCredential) {
  let sent=false;
  for(;;) {
    if(signal?.aborted && !sent) {
      try {
        await daemonApproved(credential ? {op:'revoke-grant',id:credential.id} : {op:'cancel',id}, credential);
        sent=true;
      } catch {await delay(500);continue;}
    }
    const task=await (credential ? daemonTaskRequest<any>(credential,{op:'task',id})
      : daemonRequest<any>({op:'task',id})).catch(()=>undefined);
    if(!task) {await delay(500);continue;} // Missing evidence stays unknown.
    if(task.state==='settled') {signal?.throwIfAborted();return task;}
    // A lost service connection is an unknown result. Never submit another task.
    await delay(100);
  }
}
export async function resolveBinary(selected:string) {
  return realpath(selected.includes('/') ? selected : (await execute('/usr/bin/which',[selected])).stdout.trim());
}
