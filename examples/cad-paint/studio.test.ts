import test from 'node:test';
import assert from 'node:assert/strict';
import {parts,snapshot,defaultCamera,type Part} from '@an-shuttle/cad/scene.js';
import {recipe,paint} from './spool.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const steel={color:'#acb8bc',finish:'ground steel'};
test('freeze CAD input and request exactly the missing parts',async()=>{
  const input={gap:23,materials:{rail:{...steel}},light:0};
  const scene=snapshot(input);
  input.materials.rail.color='#000000';
  const job=await recipe(scene,4,async missing=>{
    assert.deepEqual(missing,['base','fixedJaw','movingJaw']);
    return Object.fromEntries(missing.map(p=>[p,{...steel,metallic:0.8,roughness:0.25}]));
  });
  assert.deepEqual(job.camera,defaultCamera);
  assert.equal(job.light,0);
  assert.equal(job.materials.rail.color,steel.color);
  await assert.rejects(recipe(scene,4,async()=>({})),/Invalid generated material/);
  assert.throws(()=>snapshot({...scene,gap:81}));
});
test('closed geometry can be rendered and delivered without a model when every finish is supplied',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'shuttle-render-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const materials=Object.fromEntries(parts.map(p=>[p,steel])) as Record<Part,typeof steel>;
  const file=await paint({gap:12,materials,camera:{yaw:40,elevation:30},light:60},1,folder);
  assert.equal((await readFile(file)).subarray(0,2).toString(),'PK');
  const job=JSON.parse(await readFile(join(folder,'scene.json'),'utf8'));
  assert.deepEqual(job.generated,[]);
  assert.equal(job.model,null);
  assert.equal(job.camera.yaw,40);
});
