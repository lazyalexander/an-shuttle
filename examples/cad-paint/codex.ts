import {createReadStream} from 'node:fs';
// Domain client: delegate one approved proposal to the host's finite harness.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {daemonApproved,daemonRequest,daemonTaskRequest,resolveBinary,waitTask,type TaskGrant,type TaskScope} from './daemon.js';
export const codexVersion='0.166.0';
interface Task {
  name:'material-codex'|'material-completion-codex';prompt:string;schema:object;scope:object;
  mcp?:{url:string;token:string};
  onPermission?:(check:()=>Promise<void>)=>void;
}
export async function runCodex(folder:string,task:Task,signal:AbortSignal):Promise<unknown> {
  signal.throwIfAborted();
  const job=resolve(folder,task.name);
  await mkdir(job,{mode:0o700}); // Client fence persists even if the submission reply is lost.
  const binary=await resolveBinary(process.env.CAD_MATERIAL_CODEX_BIN ?? 'codex');
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(binary))digest.update(chunk);
  const parent=createHash('sha256').update(resolve(folder)).digest('hex');
  const selected={label:task.name,binary,
    binary_sha256:digest.digest('hex'),
    prompt:task.prompt,schema:task.schema,scope:task.scope,mcp:task.mcp ?? null,
    model:process.env.CAD_MATERIAL_CODEX_MODEL ?? null};
  const permission=await daemonRequest<object>({op:'harness-permission',task:selected});
  const scope:TaskScope={task:parent,subject:'cad-shuttle',expires_ms:Date.now()+240_000,
    delegate:true,permissions:[permission]};
  const root=await daemonApproved<TaskGrant>({op:'grant',scope});
  try {
    const child=await daemonApproved<TaskGrant>({op:'derive-grant',scope:{...scope,
      subject:task.name,delegate:false}},root.credential);
    task.onPermission?.(async()=>{
      const status=await daemonTaskRequest<{active:boolean}>(child.credential,{op:'grant-status'});
      if(!status.active)throw Error('Material task permission expired or was revoked');
    });
    const submitted=await daemonApproved({op:'delegate',parent,task:selected},child.credential);
    const receipt={schema:'cad-material-codex-v1',version:'codex-cli '+codexVersion,scope:task.scope,
      status:'submitted',service:process.env.AN_AGENT_DAEMON_ROOT,task:submitted.id,
      authorization:{root:root.grant.id,grant:child.grant.id}};
    await writeFile(join(job,'receipt.json'),JSON.stringify(receipt),{mode:0o600,flag:'wx'});
    const completed=await waitTask(submitted.id,signal,child.credential);
    if(completed.outcome!=='succeeded') throw Error('Codex material task failed; inspect service task '+submitted.id);
    const inbox=await daemonTaskRequest<{messages:{id:string;proposal?:unknown}[]}>(child.credential,{op:'delegation-inbox',parent});
    const result=inbox.messages.find(message=>message.id===submitted.id);
    if(!result || !Object.hasOwn(result,'proposal')) throw Error('Completed delegation has no returned proposal');
    signal.throwIfAborted();
    await writeFile(join(job,'receipt.json'),JSON.stringify({...receipt,status:'completed'}),{mode:0o600});
    return result.proposal;
  } finally {
    await daemonApproved({op:'revoke-grant',id:root.grant.id},root.credential);
  }
}
