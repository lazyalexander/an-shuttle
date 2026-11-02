import test from 'node:test';
import assert from 'node:assert/strict';
import {parts,snapshot,type Part} from '@an-shuttle/cad/scene.js';
import {paintStandalone} from './spool.js';
import {packPainting} from '@an-shuttle/krita/document.js';
import {planKit} from '@an-loom/cad-paint-spool/agent';
import {paintRequest} from '@an-shuttle/cad/shuttle.js';
import {benchVise} from '@an-shuttle/cad/drawing.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
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
  assert.equal(await packPainting(folder),file);
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
