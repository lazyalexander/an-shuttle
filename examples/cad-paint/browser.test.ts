import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {fileURLToPath} from 'node:url';
import {loadDrawing,studio} from './server.js';
import {paintStandalone} from './spool.js';

test('saving freezes every CAD control across tabs, including a newly opened view', {timeout:60_000},async t=>{
  const output=await mkdtemp(join(tmpdir(),'shuttle-lock-'));
  let fail!:()=>void;
  const held=new Promise<void>(resolve=>{fail=resolve;});
  let jobs=0, opens=0;
  const deliveries:string[]=[];
  const server=studio(0,{output,render:async(_scene,_revision,folder,_drawing,_epoch,_direction,_waiting,_reused,_signal,materialReady)=>{
    materialReady?.();
    if (++jobs===1) {await held;throw Error('test render failed');}
    return join(folder,'painting.ora');
  },open:async()=>{opens++;},cut:async file=>{deliveries.push(file);}});
  await once(server,'listening');
  t.after(async()=>{fail();await new Promise<void>(r=>server.close(()=>r()));await rm(output,{recursive:true,force:true});});
  const addr=server.address();
  assert.ok(addr && typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port;
  const browser=await chromium.launch({channel:'chrome'});
  try{
    const a=await browser.newPage(), b=await browser.newPage();
    await Promise.all([a.goto(url),b.goto(url)]);
    await b.locator('#controls:enabled').waitFor();
    const original=await (await a.request.get(url+'/state')).json();
    await a.locator('#save').click();
    const c=await browser.newPage();
    await c.route('**/events',route=>route.abort());
    await c.goto(url);
    await c.getByText('连接中断 · CAD 已锁定').waitFor();
    assert.equal(await c.locator('#controls:disabled').count(),1);
    await c.unroute('**/events');
    await c.reload();
    for(const page of [a,b,c]){
      await page.getByText(/CAD 已锁定 · 正在绘制/).waitFor();
      assert.equal(await page.locator('input:enabled,select:enabled,button:enabled').count(),0);
    }
    const nativeState=await (await a.request.get(url+'/state')).json();
    assert.equal(nativeState.canCancelLookup,false);
    assert.equal((await b.request.post(url+'/cancel-material',{data:nativeState,headers:{Origin:url}})).status(),409);
    const post=(data:unknown)=>b.request.post(url+'/save',{data,headers:{Origin:url}});
    assert.equal((await post({...original,revision:1})).status(),409);
    fail();
    await b.getByText(/绘制失败/).first().waitFor();
    await b.locator('#controls:enabled').waitFor();
    assert.equal((await post(original)).status(),409);
    await b.locator('#save').click();
    await c.locator('#download').waitFor();
    await c.locator('#cut').click();
    await a.getByText('已送交切割 spool').waitFor();
    assert.equal(deliveries.length,1);
    assert.ok(deliveries[0].startsWith(output));
    assert.ok(deliveries[0].endsWith('/painting.ora'));
    await a.locator('#controls:enabled').waitFor();
    assert.equal(jobs,2);assert.equal(opens,1);
  }finally{fail();await browser.close();}
});

test('OpenSCAD handwheel uses the same editor, locks and file delivery', {timeout:90_000},async t=>{
  const drawing=await loadDrawing(fileURLToPath(new URL('../handwheel/',import.meta.url)));
  const output=await mkdtemp(join(tmpdir(),'shuttle-handwheel-'));
  const opened:string[]=[], cutFiles:string[]=[];
  const server=studio(0,{output,drawing,render:paintStandalone,open:async file=>{opened.push(file);},cut:async file=>{cutFiles.push(file);}});
  await once(server,'listening');
  t.after(async()=>{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(output,{recursive:true,force:true});
  });
  const addr=server.address();
  assert.ok(addr && typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port;
  const browser=await chromium.launch({channel:'chrome'});
  try {
    const page=await browser.newPage();
    await page.goto(url);
    await page.locator('#controls:enabled').waitFor();
    assert.equal(await page.locator('h1').innerText(),'三辐手轮 / CAD 绘画台');
    assert.equal(await page.locator('#materials select').count(),5);
    await page.getByRole('slider',{name:/手轮转角/}).press('Home');
    await page.locator('#grip').selectOption('2');
    await page.locator('#save').click();
    await page.locator('#controls:disabled').waitFor();
    await page.locator('#download').waitFor();
    assert.equal(await page.locator('#download').getAttribute('download'),'handwheel.ora');
    const state=await (await page.request.get(url+'/state')).json();
    assert.equal(state.scene.value,-180);
    const response=await page.request.get(url+state.artifact+'/painting.ora');
    assert.equal(response.status(),200);
    assert.equal((await response.body()).subarray(0,2).toString(),'PK');
    await page.locator('#cut').click();
    await page.getByText('已送交切割 spool').waitFor();
    assert.equal(opened.length,1);
    assert.deepEqual(cutFiles,opened);
  }finally{await browser.close();}
});

test('cancel a pending material lookup from the handwheel editor', {timeout:60_000},async t=>{
  const drawing=await loadDrawing(fileURLToPath(new URL('../handwheel/',import.meta.url)));
  const output=await mkdtemp(join(tmpdir(),'shuttle-browser-cancel-'));
  const variables=['CAD_MATERIAL_READER'];
  const original=variables.map(key=>process.env[key]);
  process.env.CAD_MATERIAL_READER='fixture-reader';
  let reached=()=>{};
  const entered=new Promise<void>(resolve=>{reached=resolve;});
  let release=()=>{};
  const released=new Promise<void>(resolve=>{release=resolve;});
  let renders=0;
  const server=studio(0,{drawing,output,open:async()=>{},
    render:async(_scene,_revision,folder)=>{renders++;return join(folder,'painting.ora');},
    readMaterial:async(_reader,_folder,document,epoch,revision,part)=>({
      schema:'cad-material-evidence-v1',part,source:{document,epoch,revision},
      artifact:{release:'a'.repeat(64),revision:'b'.repeat(64)},
      material:{finish:'walnut',color:'#4a2c23',metallic:0,roughness:0.8},
    }),
    authorizeMaterial:async()=>{},
    materialTurn:()=>async(scope,read)=>{
      const proof=await read(scope);
      reached();
      await released;
      return {adopt:true,evidence_id:proof.evidence_id};
    },
  });
  t.after(async()=>{
    release();
    for(const [i,key] of variables.entries()) {
      if(original[i]===undefined) delete process.env[key]; else process.env[key]=original[i];
    }
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(output,{recursive:true,force:true});
  });
  await once(server,'listening');
  const addr=server.address();assert.ok(addr&&typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port;
  const browser=await chromium.launch({channel:'chrome'});
  try {
    const page=await browser.newPage();
    await page.goto(url);
    await page.locator('#save').click();
    await page.locator('#verifyHistory').check();
    const saved=page.waitForResponse(response=>response.url()===url+'/save');
    void saved.catch(()=>{});
    await page.locator('#save').click();
    await entered;
    await page.locator('#controls:disabled').waitFor();
    const cancelled=page.waitForResponse(response=>response.url()===url+'/cancel-material');
    await page.locator('#cancelMaterial').click();
    assert.equal((await cancelled).status(),202);
    await page.locator('#cancelMaterial').waitFor({state:'hidden'});
    await page.locator('#controls:disabled').waitFor();
    release();
    assert.equal((await saved).status(),500);
    await page.locator('#controls:enabled').waitFor();
    assert.equal(await page.locator('#download').isVisible(),false);
    assert.equal(renders,1);
  } finally {release();await browser.close();}
});
