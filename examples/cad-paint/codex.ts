import {createReadStream} from 'node:fs';
// Domain client: delegate one approved proposal to the host's finite harness.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {daemonApproved,daemonRequest,resolveBinary,waitTask} from './daemon.js';
export const codexVersion='0.166.0';
interface Task {
  name:'material-codex'|'material-completion-codex';prompt:string;schema:object;scope:object;
  mcp?:{url:string;token:string};
}
export async function runCodex(folder:string,task:Task,signal:AbortSignal):Promise<unknown> {
  signal.throwIfAborted();
  const job=resolve(folder,task.name);
  await mkdir(job,{mode:0o700}); // Client fence persists even if the submission reply is lost.
  const binary=await resolveBinary(process.env.CAD_MATERIAL_CODEX_BIN ?? 'codex');
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(binary))digest.update(chunk);
  const submitted=await daemonApproved({op:'harness',task:{label:task.name,binary,
    binary_sha256:digest.digest('hex'),
    prompt:task.prompt,schema:task.schema,scope:task.scope,mcp:task.mcp ?? null,
    model:process.env.CAD_MATERIAL_CODEX_MODEL ?? null}});
  const receipt={schema:'cad-material-codex-v1',version:'codex-cli '+codexVersion,scope:task.scope,
    status:'submitted',service:process.env.AN_AGENT_DAEMON_ROOT,task:submitted.id};
  await writeFile(join(job,'receipt.json'),JSON.stringify(receipt),{mode:0o600,flag:'wx'});
  const completed=await waitTask(submitted.id,signal);
  if(completed.outcome!=='succeeded') throw Error('Codex material task failed; inspect service task '+submitted.id);
  const result=await daemonRequest<{proposal:unknown}>({op:'harness-result',id:submitted.id});
  signal.throwIfAborted();
  await writeFile(join(job,'receipt.json'),JSON.stringify({...receipt,status:'completed'}),{mode:0o600});
  return result.proposal;
}
