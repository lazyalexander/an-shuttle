// Test-only lifetime for the real product service; no parallel execution host.
import {before,after} from 'node:test';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {selectedHost} from './daemon.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export function useDaemon() {
  let child:ChildProcess|undefined;
  const original=process.env.AN_AGENT_DAEMON_ROOT;
  before(async()=>{
    if(original) return;
    const folder=await realpath(await mkdtemp(join('/private/tmp','cad-daemon-')));
    const root=join(folder,'service'),host=await selectedHost();
    await execute(host,['daemon','init',root,'2']);
    child=spawn(host,['daemon','serve',root],{stdio:'inherit'});
    let ready=false;
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null)throw Error('Local service failed to start');
      if(await readFile(join(root,'endpoint.json'),'utf8').then(raw=>JSON.parse(raw).pid===child!.pid,()=>false)){ready=true;break;}
      await delay(50);
    }
    if(!ready)throw Error('Local service startup deadline exceeded');
    process.env.AN_AGENT_DAEMON_ROOT=root;
  });
  after(async()=>{
    if(child && child.exitCode===null) {
      const done=new Promise<void>(resolve=>child!.once('close',()=>resolve()));
      child.kill('SIGTERM');await done;
    }
    if(original===undefined)delete process.env.AN_AGENT_DAEMON_ROOT;
    else process.env.AN_AGENT_DAEMON_ROOT=original;
  });
}
