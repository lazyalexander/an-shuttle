// One finite official Codex entry for material tasks. No provider or agent loop.
import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';

const execute=promisify(execFile);
export const codexVersion='0.166.0';
interface Task {
  name:'material-codex'|'material-completion-codex';prompt:string;schema:object;scope:object;
  mcp?:{url:string;token:string};
}
export async function runCodex(folder:string,task:Task,signal:AbortSignal):Promise<unknown> {
    signal.throwIfAborted();
    const binary=process.env.CAD_MATERIAL_CODEX_BIN ?? 'codex';
    const version=(await execute(binary,['--version'],{signal})).stdout.trim();
    if (version!=='codex-cli '+codexVersion) throw Error('Material tasks require qualified Codex CLI '+codexVersion);
    const job=resolve(folder,task.name);
    await mkdir(job,{mode:0o700}); // Exclusive fence: no replay of a submitted task.
    const workspace=await mkdtemp(join(tmpdir(),'cad-material-codex-'));
    const redact=(text:string)=>task.mcp ? text.replaceAll(task.mcp.token,'[redacted]') : text;
    const receipt={schema:'cad-material-codex-v1',version,scope:task.scope,status:'submitted'};
    try {
      await writeFile(join(job,'schema.json'),JSON.stringify(task.schema),{mode:0o600,flag:'wx'});
      const settings:Record<string,unknown>={
        approval_policy:'never',default_permissions:'material',
        permissions:{material:{filesystem:{':root':'none',':project_roots':'read'},network:{enabled:false}}},
        project_doc_max_bytes:0,web_search:'disabled',
        features:{shell_tool:false,view_image:false,multi_agent:false,apps:false,plugins:false,remote_plugin:false,
          hooks:false,goals:false,skill_search:false,skip_host_skill_discovery:true,
          multi_agent_v2:{enabled:false,disable_native_tools:true}},
        ...(task.mcp ? {mcp_servers:{material:{url:task.mcp.url,
          http_headers:{Authorization:'Bearer '+task.mcp.token},enabled_tools:['read_approved_material'],required:true}}} : {}),
      };
      const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check',
        '-C',workspace,'--output-schema',join(job,'schema.json'),'--output-last-message',join(job,'decision.json'),'--json'];
      // JSON literals are valid TOML scalar values; inline tables need TOML's '=' syntax.
      const toml=(value:unknown):string=>Array.isArray(value) ? '['+value.map(toml).join(',')+']' : typeof value==='object' && value!==null
        ? '{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}' : JSON.stringify(value);
      for (const [key,value] of Object.entries(settings)) args.push('-c',key+'='+toml(value));
      if (process.env.CAD_MATERIAL_CODEX_MODEL) args.push('--model',process.env.CAD_MATERIAL_CODEX_MODEL);
      args.push(task.prompt);
      await writeFile(join(job,'receipt.json'),JSON.stringify(receipt),{mode:0o600,flag:'wx'});
      const execution=execute(binary,args,{signal,encoding:'utf8',maxBuffer:2*1024*1024,timeout:180_000});
      const closed=new Promise<void>(done=>execution.child.once('close',()=>done()));
      execution.child.stdin?.end();
      const nativeLog=(output:string)=>writeFile(join(job,'native-events.jsonl'),redact(output),{mode:0o600,flag:'wx'});
      await execution.then(({stdout})=>nativeLog(stdout),async error=>{
        await nativeLog(String(error.stdout ?? ''));
        await writeFile(join(job,'diagnostic.txt'),redact(String(error.stderr ?? '')+'\nExit: '+String(error.code)),{mode:0o600});
        throw Error('Codex material task failed; inspect '+task.name+'/diagnostic.txt');
      }).finally(()=>closed);
      signal.throwIfAborted();
      const decision=JSON.parse(await readFile(join(job,'decision.json'),'utf8'));
      await writeFile(join(job,'receipt.json'),JSON.stringify({...receipt,status:'completed'}),{mode:0o600});
      return decision;
    } finally {await rm(workspace,{recursive:true,force:true});}
}
