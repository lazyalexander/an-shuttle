import test from 'node:test';
import assert from 'node:assert/strict';
import {parts,snapshot,type Part} from '@an-shuttle/cad/scene.js';
import {paintStandalone} from './spool.js';
import {observeTermination} from './host.js';
import {planKit} from '@an-loom/cad-paint-spool/agent';
import {paintRequest} from '@an-shuttle/cad/shuttle.js';
import {benchVise} from '@an-shuttle/cad/drawing.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {studio} from './server.js';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const steel={color:'#acb8bc',finish:'ground steel'};
test('freeze CAD input and request exactly the missing parts',async()=>{
  const input={gap:23,materials:{rail:{...steel}},light:0};
  const scene=snapshot(input);
  input.materials.rail.color='#000000';
  const request=paintRequest(benchVise,scene,'test-document',4,'matte wood');
  assert.equal(request.source.revision,4);
  assert.equal(request.scene.light,0);
  assert.equal(request.scene.materials.rail?.color,steel.color);
  const missing=Object.fromEntries(parts.filter(p=>!scene.materials[p]).map(p=>[p,{label:p}]));
  const brief={...request.context,supplied:scene.materials,missing};
  const candidate=await planKit(brief,async input=>{
    assert.equal(input.direction,'matte wood');
    assert.deepEqual(Object.keys(input.missing),['base','fixedJaw','movingJaw']);
    return Object.fromEntries(Object.keys(input.missing).map(p=>[p,{...steel,metallic:0.8,roughness:0.25}]));
  });
  assert.match(candidate!,/def missing_material/);
  await assert.rejects(planKit(brief,async()=>({})),/Invalid generated material/);
  await assert.rejects(planKit(brief,async()=>({rail:steel})),/Unexpected material/);
  assert.throws(()=>snapshot({...scene,gap:81}));
});
test('closed geometry can be rendered and delivered without a model when every finish is supplied',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'shuttle-render-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const materials=Object.fromEntries(parts.map(p=>[p,steel])) as Record<Part,typeof steel>;
  const file=await paintStandalone({gap:12,materials,camera:{yaw:40,elevation:30},light:60},1,folder);
  assert.equal((await readFile(file)).subarray(0,2).toString(),'PK');
  const job=JSON.parse(await readFile(join(folder,'scene.json'),'utf8'));
  assert.deepEqual(job.generated,[]);
  assert.equal(job.model,null);
  assert.equal(job.camera.yaw,40);
});

test('handwheel rotates moving groups about its CAD shaft and preserves the stationary meshes',async()=>{
  const {geometry,saveDrawing}=await import('@an-shuttle/cad/drawing.js');
  const {loadDrawing}=await import('./server.js');
  const {fileURLToPath}=await import('node:url');
  const model=await loadDrawing(fileURLToPath(new URL('../handwheel/',import.meta.url)));
  const turned=geometry(model,90);
  for(const part of turned){
    assert.ok(part.shape==='mesh');
    const neutral=model.meshes[part.part];
    if(!model.parts[part.part].rotates){
      assert.deepEqual(part.vertices,neutral.vertices);
    }else{
      const [x,y,z]=neutral.vertices[0];
      const [cx,,cz]=model.pivot;
      const actual=part.vertices[0];
      assert.ok(Math.abs(actual[0]-(cx+z-cz))<1e-8);
      assert.equal(actual[1],y);
      assert.ok(Math.abs(actual[2]-(cz-x+cx))<1e-8);
    }
  }
  assert.throws(()=>saveDrawing({value:181,materials:{}},model));
  assert.throws(()=>saveDrawing({gap:18,materials:{}},model));
});

test('an uncertain supervisor waits for the original run without starting again',async () => {
  const identity={instance:'selected',release:'fixed'};
  const pending={...identity,run:'paint',phase:'running-or-unconfirmed',termination_confirmed:false,execution_status:''};
  const failed={...pending,phase:'settled',termination_confirmed:true,execution_status:'failed'};
  let reads=0, waits=0;
  const outcomes=[{...failed,instance:'another'},pending,failed];
  const result=await observeTermination(identity,async () => {
    if (++reads===1) throw Error('temporary status loss');
    return outcomes[reads-2];
  },async () => {waits++;});
  assert.equal(result,'failed'); assert.equal(waits,3);
  await assert.rejects(observeTermination(identity,async () => ({...pending,phase:'prepared'})),/did not reserve/);
});

test('a pending Krita launch cannot hold editing or replace a later revision’s status',{timeout:5000},async t=>{
  const output=await mkdtemp(join(tmpdir(),'shuttle-slow-open-'));
  let complete!:()=>void;
  const firstOpen=new Promise<void>(done=>{complete=done;});
  let launches=0;
  const server=studio(0,{output,render:async(_scene,_rev,folder)=>join(folder,'painting.ora'),
    open:async()=>{if (++launches===1) await firstOpen; else throw Error('app unavailable');}});
  await once(server,'listening');
  t.after(async()=>{
    complete();server.closeAllConnections();
    await new Promise<void>(done=>server.close(()=>done()));
    await rm(output,{recursive:true,force:true});
  });
  const addr=server.address();assert.ok(addr&&typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port;
  const state=async()=> (await fetch(url+'/state')).json();
  async function save(input:unknown) {
    const result=await fetch(url+'/save',{method:'POST',headers:{origin:url,'content-type':'application/json'},
      body:JSON.stringify(input)});
    assert.equal(result.status,200);return result.json();
  }
  const first=await save(await state());
  assert.equal(first.locked,false);assert.equal(launches,1);
  const newer=await save(first);
  assert.equal(newer.revision,2);assert.notEqual(first.artifact,newer.artifact);
  complete();
  const current=await state();
  assert.equal(launches,2);assert.equal(current.message,newer.message);
  assert.equal(current.artifact,newer.artifact);
});

test('material adoption resolves only the current host evidence and rejects late decisions', async t => {
  const {verifyMaterial}=await import('./verify-material.js');
  const scope={document:'handwheel',part:'grip',revision:7};
  const evidence={
    schema:'cad-material-evidence-v1' as const, part:scope.part,
    source:{document:scope.document,epoch:'test-epoch',revision:scope.revision},
    artifact:{release:'a'.repeat(64),revision:'b'.repeat(64)},
    material:{finish:'walnut',color:'#4a2c23',metallic:0,roughness:0.8},
  };
  const controller=new AbortController();
  let mode='adopt', issuedId='', reads=0, decisions=0;
  const turn:import('./verify-material.js').MaterialTurn=async(permitted,read)=>{
    const proof=await read(mode==='outside-scope' ? {...permitted,revision:8} : permitted);
    decisions++;
    if (mode==='adopt') issuedId=proof.evidence_id;
    if (mode==='cancelled') controller.abort(new Error('Lookup cancelled'));
    return {adopt:true,evidence_id:issuedId};
  };
  const verify=(signal:AbortSignal=new AbortController().signal)=>verifyMaterial(scope,
    async()=>{reads++;return evidence;},signal,turn);

  assert.equal(await verify(),evidence);
  mode='previous-id';
  await assert.rejects(verify(),/did not adopt/);
  mode='outside-scope';
  await assert.rejects(verify(),/exceeded the approved scope/);
  assert.equal(reads,2);
  assert.equal(decisions,2);
  mode='wrong-source';
  await assert.rejects(verifyMaterial(scope,
    async()=>({...evidence,source:{...evidence.source,revision:8}}),new AbortController().signal,turn),/does not match the approved scope/);
  assert.equal(decisions,2);
  mode='cancelled';
  await assert.rejects(verify(controller.signal),/Lookup cancelled/);
});

test('a denied or repeated lookup cannot be repaired by returning a previously issued ID',async()=>{
  const {verifyMaterial}=await import('./verify-material.js');
  const scope={document:'handwheel',part:'grip',revision:7};
  const evidence={schema:'cad-material-evidence-v1' as const,part:'grip',
    source:{document:'handwheel',epoch:'e',revision:7},artifact:{release:'a'.repeat(64),revision:'b'.repeat(64)},
    material:{finish:'walnut',color:'#4a2c23',metallic:0,roughness:0.8}};
  let reads=0;
  for (const args of [scope,{...scope,part:'other'}]) {
    await assert.rejects(verifyMaterial(scope,async()=>{reads++;return evidence;},new AbortController().signal,
      async(permitted,read)=>{
        const proof=await read(permitted);
        await read(args).catch(()=>{});
        return {adopt:true,evidence_id:proof.evidence_id};
      }),/did not adopt/);
  }
  assert.equal(reads,2);
  let deniedReads=0;
  await assert.rejects(verifyMaterial(scope,async()=>{deniedReads++;return evidence;},new AbortController().signal,
    async(permitted,read)=>{
      await read({...permitted,revision:8}).catch(()=>{});
      await read(permitted).catch(()=>{});
      return {adopt:false,evidence_id:''};
    }),/did not adopt/);
  assert.equal(deniedReads,0,'An out-of-scope attempt revokes the remaining read grant');
});

test('save scopes the host material decision and blocks rendering after lookup cancellation', async t => {
  const output=await mkdtemp(join(tmpdir(),'shuttle-cancel-lookup-'));
  const env=['CAD_MATERIAL_READER'] as const;
  const before=env.map(key=>process.env[key]);
  process.env.CAD_MATERIAL_READER='fixture-reader';
  let mode='adopt', rendered=0, reads=0;
  let releaseDecision=()=>{};
  let reachedDecision=()=>{};
  const entered=new Promise<void>(resolve=>{reachedDecision=resolve;});
  const delayed=new Promise<void>(resolve=>{releaseDecision=resolve;});
  const evidenceFor=(document:string,epoch:string,revision:number,part:string)=>({
    schema:'cad-material-evidence-v1' as const,part,source:{document,epoch,revision},
    artifact:{release:'a'.repeat(64),revision:'b'.repeat(64)},
    material:{finish:'walnut',color:'#4a2c23',metallic:0,roughness:0.8},
  });
  const {loadDrawing}=await import('./server.js');
  const {fileURLToPath}=await import('node:url');
  const drawing=await loadDrawing(fileURLToPath(new URL('../handwheel/',import.meta.url)));
  const server=studio(0,{output,drawing,open:async()=>{},
    render:async(_scene,_revision,folder,_drawing,_epoch,_direction,_waiting,evidence)=>{
      rendered++;
      if (rendered===2) assert.equal(evidence?.material.finish,'walnut');
      return join(folder,'painting.ora');
    },
    readMaterial:async(_reader,_folder,document,epoch,revision,part,delegated)=>{
      assert.equal(delegated,true);reads++;
      return evidenceFor(document,epoch,revision,part);
    },
    authorizeMaterial:async()=>{if(mode==='deny-disclosure') throw Error('Local-only declaration');},
    materialTurn:()=>async(scope,read)=>{
      const proof=await read({...scope,revision:scope.revision+(mode==='wrong-scope' ? 1 : 0)});
      if (mode==='cancel') {reachedDecision();await delayed;}
      return {adopt:true,evidence_id:proof.evidence_id};
    },
  });
  t.after(async()=>{
    releaseDecision();
    for (const [i,key] of env.entries()) {
      if (before[i]===undefined) delete process.env[key]; else process.env[key]=before[i];
    }
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(output,{recursive:true,force:true});
  });
  await once(server,'listening');
  const addr=server.address();assert.ok(addr && typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port;
  const state=async()=> (await fetch(url+'/state')).json();
  const post=(path:string,data:unknown)=>fetch(url+path,{method:'POST',
    headers:{origin:url,'content-type':'application/json'},body:JSON.stringify(data)});
  const save=async()=>post('/save',{...await state(),materialHistory:'last-accepted'});
  assert.equal((await post('/save',await state())).status,200);
  assert.equal((await save()).status,200);
  mode='wrong-scope';
  assert.equal((await save()).status,500);
  assert.equal(reads,1);
  mode='deny-disclosure';
  assert.equal((await save()).status,500);assert.equal(reads,1);assert.equal(rendered,2);
  mode='cancel';
  const pending=save();
  await entered;
  const active=await state();
  assert.equal(active.canCancelLookup,true);
  assert.equal((await post('/cancel-material',{...active,revision:active.revision-1})).status,409);
  assert.equal((await post('/cancel-material',active)).status,202);
  releaseDecision();
  assert.equal((await pending).status,500);
  assert.equal(rendered,2);
  const final=await state();
  assert.equal(final.locked,false);
  assert.equal(final.artifact,null);
});
