import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {kritaLive,protocol,KritaRefusal,type KritaLive} from '@an-shuttle/krita/live.js';
import {studio} from './server.js';

const digest='a'.repeat(64);

async function fakeKrita(t:test.TestContext, answer:(request:Record<string,unknown>)=>object) {
  const folder=await mkdtemp(join(tmpdir(),'krita-live-'));
  const socket=join(folder,'krita.sock');
  const requests:Record<string,unknown>[]=[];
  const server:Server=createServer(connection=>{
    let text='';
    connection.setEncoding('utf8');
    connection.on('data',(chunk:string)=>{
      text+=chunk;
      if(!text.includes('\n')) return;
      const request=JSON.parse(text.slice(0,text.indexOf('\n')));
      requests.push(request);
      connection.end(JSON.stringify({protocol,...answer(request)})+'\n');
    });
  });
  server.listen(socket); await once(server,'listening');
  t.after(async()=>{await new Promise<void>(done=>server.close(()=>done()));await rm(folder,{recursive:true,force:true});});
  return {socket,requests};
}

test('the Krita client checks receipts and reports refusals',async t=>{
  let mode='ok';
  const {socket,requests}=await fakeKrita(t,request=>mode==='ok'
    ? {ok:true,document:request.document,revision:request.revision,stage:request.stage,layers:{base:digest},preserved:[],created:true}
    : mode==='wrong' ? {ok:true,document:request.document,revision:request.revision,stage:'preview',layers:{},preserved:[],created:false}
    : {ok:false,code:'stale-revision',message:'document already at revision 5'});
  const krita=kritaLive(socket);
  const receipt=await krita.apply('/work/vise.kra',3,'/out/painting.ora');
  assert.deepEqual(receipt,{document:'/work/vise.kra',revision:3,stage:'final',layers:{base:digest},preserved:[],created:true});
  assert.deepEqual(requests[0],{protocol,method:'apply',document:'/work/vise.kra',revision:3,ora:'/out/painting.ora',stage:'final'});
  mode='wrong';
  await assert.rejects(krita.apply('/work/vise.kra',3,'/out/painting.ora'),/does not match/);
  mode='refuse';
  await assert.rejects(krita.apply('/work/vise.kra',3,'/out/painting.ora'),
    (error:unknown)=>error instanceof KritaRefusal && error.code==='stale-revision');
  await assert.rejects(kritaLive(join(tmpdir(),'missing-krita.sock')).pending('/work/vise.kra',1));
});

async function liveStudio(t:test.TestContext, live:KritaLive, preview=false) {
  const output=await mkdtemp(join(tmpdir(),'shuttle-live-'));
  // Gates are keyed by revision (final) or 'revision:preview'.
  const gates=new Map<number|string,()=>void>(), renders:(number|string)[]=[], aborted:(number|string)[]=[];
  const server=studio(0,{output,live,preview,render:async(_scene,revision,folder,_d,_e,_dir,_w,_r,options)=>{
    const key=options?.quality==='preview' ? revision+':preview' : revision;
    renders.push(key);
    await new Promise<void>((done,fail)=>{
      if(options?.signal?.aborted) {aborted.push(key);return fail(Error('aborted'));}
      gates.set(key,done);
      options?.signal?.addEventListener('abort',()=>{aborted.push(key);fail(Error('aborted'));});
    });
    return join(folder,'painting.ora');
  },open:async()=>{throw Error('live mode must not open a new document');}});
  await once(server,'listening');
  t.after(async()=>{
    for(const done of gates.values()) done();
    server.closeAllConnections();
    await new Promise<void>(done=>server.close(()=>done()));
    await rm(output,{recursive:true,force:true});
  });
  const addr=server.address();assert.ok(addr&&typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port;
  const state=async()=>(await fetch(url+'/state')).json();
  const save=(input:{epoch:string;revision:number;scene:unknown})=>fetch(url+'/save',{method:'POST',
    headers:{origin:url,'content-type':'application/json'},body:JSON.stringify(input)});
  async function until(check:(s:any)=>boolean) {
    for(let i=0;i<200;i++){const s=await state(); if(check(s)) return s; await new Promise(r=>setTimeout(r,10));}
    assert.fail('state never reached: '+JSON.stringify(await state()));
  }
  const release=async(key:number|string)=>{await until(()=>gates.has(key)); gates.get(key)!();};
  return {state,save,until,release,renders,aborted};
}

test('CAD stays editable while painting and only the newest revision reaches Krita',{timeout:10_000},async t=>{
  const applied:number[]=[], pending:number[]=[];
  const {state,save,until,release,renders,aborted}=await liveStudio(t,{
    async pending(_document,revision){pending.push(revision);},
    async apply(document,revision){applied.push(revision);return {document,revision,stage:'final',layers:{},preserved:[],created:applied.length===1};},
  });
  const initial=await state();
  assert.equal(initial.live,true);
  let reply=await save(initial); assert.equal(reply.status,200);
  const first=await reply.json();
  assert.equal(first.locked,false); assert.equal(first.revision,1);
  // Two more confirmations while revision 1 renders: 3 replaces the queued 2.
  const second=await (await save(first)).json(); assert.equal(second.revision,2);
  const third=await (await save(second)).json(); assert.equal(third.revision,3);
  assert.equal((await save(first)).status,409,'a stale CAD base is still refused');
  // Each newer confirmation stops the render in flight; revision 2 may or may not have started.
  await until(s=>s.rendering===3);
  assert.equal(aborted[0],1);
  assert.match((await state()).message,/已停止 · 被修订 3 取代/);
  await release(3);
  const done=await until(s=>s.rendering===null && s.krita===3);
  assert.deepEqual(renders.filter(r=>r!==2),[1,3]);
  assert.deepEqual(aborted.filter(r=>r!==2),[1]);
  assert.deepEqual(applied,[3]);
  assert.deepEqual(pending.filter(r=>r!==2),[1,3]);
  assert.match(done.message,/Krita 已更新到修订 3/);
  assert.ok(done.artifact);
});

test('an unavailable Krita leaves the accepted painting archived and CAD free',{timeout:10_000},async t=>{
  const {state,save,until,release}=await liveStudio(t,{
    async pending(){throw Error('no Krita');},
    async apply(){throw new KritaRefusal('render-layer-missing','render group was deleted');},
  });
  const first=await (await save(await state())).json();
  await release(1);
  const after=await until(s=>s.rendering===null);
  assert.equal(after.krita,null);
  assert.match(after.message,/修订 1 已归档 · Krita 未更新：render group was deleted/);
  assert.ok(after.artifact);
  assert.equal((await save(first)).status,200);
});

test('without a Krita shuttle the qualified locked save is unchanged',{timeout:10_000},async t=>{
  const output=await mkdtemp(join(tmpdir(),'shuttle-locked-'));
  const server=studio(0,{output,render:async(_s,_r,folder)=>join(folder,'painting.ora'),open:async()=>{}});
  await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(d=>server.close(()=>d()));await rm(output,{recursive:true,force:true});});
  const addr=server.address();assert.ok(addr&&typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port;
  const initial=await (await fetch(url+'/state')).json();
  assert.equal(initial.live,false);
  const reply=await fetch(url+'/save',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify(initial)});
  const saved=await reply.json();
  assert.equal(saved.revision,1); assert.equal(saved.locked,false); assert.match(saved.message,/素材已生成/);
});

test('a preview reaches Krita first, then the final render of the same revision',{timeout:10_000},async t=>{
  const applied:string[]=[];
  const {state,save,until,release,renders,aborted}=await liveStudio(t,{
    async pending(){},
    async apply(document,revision,_ora,stage='final',session){assert.ok(session);applied.push(revision+':'+stage);
      return {document,revision,stage,layers:{},preserved:[],created:false};},
  },true);
  const initial=await state();
  assert.equal(initial.preview,true);
  const first=await (await save(initial)).json();
  await release('1:preview');
  const shown=await until(s=>s.krita===1 && s.kritaStage==='preview');
  assert.match(shown.message,/（预览）· 正在精绘/);
  assert.equal(shown.artifact,null,'only a final render becomes the downloadable artifact');
  // A new confirmation while revision 1 is being finished stops that final render.
  await save(first);
  await until(()=>aborted.length===1);
  await release('2:preview');
  await release(2);
  const done=await until(s=>s.rendering===null && s.krita===2 && s.kritaStage==='final');
  assert.deepEqual(renders,['1:preview',1,'2:preview',2]);
  assert.deepEqual(aborted,[1]);
  assert.deepEqual(applied,['1:preview','2:preview','2:final']);
  assert.ok(done.artifact);
});
