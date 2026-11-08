import {useDaemon} from './daemon.test-helper.js';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {once} from 'node:events';
import {codexMaterialTurn} from './codex-material.js';
import {codexFixture} from './codex-fixture.test-helper.js';
import {verifyMaterial} from '@an-spool/cad-material-policy';
import {completeMaterials} from './codex-completion.js';
import {paintStandalone} from './spool.js';
import {benchVise} from '@an-shuttle/cad/drawing.js';

// Explicit integration suite: requires the qualified CLI on PATH, no login or model key.
useDaemon();

test('real Codex performs scoped MCP adoption and fails closed on a foreign revision',{timeout:120_000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'cad-codex-contract-'));
  const selected=process.env.CAD_MATERIAL_CODEX_BIN ?? 'codex';
  t.after(async()=>{if(selected==='codex') delete process.env.CAD_MATERIAL_CODEX_BIN;
    else process.env.CAD_MATERIAL_CODEX_BIN=selected;await rm(root,{recursive:true,force:true});});
  for (const mode of ['adopt','outside-scope'] as const) {
    await t.test(mode,async()=>{
      const folder=join(root,mode);await mkdir(folder);
      const fixture=await codexFixture(folder,selected,mode);
      process.env.CAD_MATERIAL_CODEX_BIN=fixture.binary;
      const scope={document:'handwheel',part:'grip',revision:7};
      const evidence={schema:'cad-material-evidence-v1' as const,part:'grip',
        source:{document:'handwheel',epoch:'private',revision:7},
        artifact:{release:'a'.repeat(64),revision:'b'.repeat(64)},
        material:{finish:'walnut',color:'#4a2c23',metallic:0,roughness:0.8}};
      let reads=0;
      const run=()=>verifyMaterial(scope,async()=>{reads++;return evidence;},
        AbortSignal.timeout(45_000),codexMaterialTurn(folder));
      try {
        if (mode==='adopt') {
          assert.equal(await run(),evidence);assert.equal(reads,1);
          assert.equal(fixture.adoptions,1);
          await assert.rejects(run(),/EEXIST/,'A submitted folder must never be replayed');
          assert.equal(reads,1);
        } else {
          await assert.rejects(run(),/did not adopt/);assert.equal(reads,0);
        }
        assert.equal(fixture.reads,1);
        assert.ok([...fixture.tools].some(name=>name.includes('read_approved_material')));
        assert.ok(![...fixture.tools].some(name=>/exec_command|view_image|spawn_agent|apply_patch/.test(name)));
        const receipt=JSON.parse(await readFile(join(folder,'material-codex','receipt.json'),'utf8'));
        assert.equal(receipt.status,'completed');
        assert.match(await readFile(join(receipt.service,'jobs',receipt.task,'native-events.jsonl'),'utf8'),/"type":"thread.started"/);
      } finally {await fixture.close();}
    });
  }
});

test('Codex completion is scoped data and invalid proposals never enter rendering',{timeout:120_000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'cad-codex-completion-'));
  const selected=process.env.CAD_MATERIAL_CODEX_BIN;
  t.after(async()=>{if(selected===undefined) delete process.env.CAD_MATERIAL_CODEX_BIN;
    else process.env.CAD_MATERIAL_CODEX_BIN=selected;await rm(root,{recursive:true,force:true});});
  const brief={description:'Steel handwheel',direction:'Use walnut for the grip.',
    supplied:{wheel:{finish:'steel',color:'#acb8bc'}},missing:{grip:{label:'Grip'},pin:{label:'Pin'}}};
  for (const mode of ['adopt','completion-extra','completion-invalid'] as const) {
    await t.test(mode,async()=>{
      const folder=join(root,mode);await mkdir(folder);
      const fixture=await codexFixture(folder,selected ?? 'codex',mode);
      process.env.CAD_MATERIAL_CODEX_BIN=fixture.binary;
      try {
        if(mode==='adopt') {
          const result=await completeMaterials(brief,folder,AbortSignal.timeout(45_000)) as Record<string,unknown>;
          assert.deepEqual(Object.keys(result),['grip','pin']);
          assert.deepEqual(fixture.completions[0].brief,brief);
          assert.ok(!fixture.completions[0].tools.some(name=>/read_approved_material|exec_command|spawn_agent|view_image/.test(name)));
        } else {
          const scene={gap:12,camera:{yaw:40,elevation:30},light:60,
            materials:{base:{finish:'steel',color:'#acb8bc'},rail:{finish:'steel',color:'#acb8bc'},fixedJaw:{finish:'steel',color:'#acb8bc'}}};
          await assert.rejects(paintStandalone(scene,1,folder,benchVise,'e','Walnut'),
            mode==='completion-extra' ? /Unexpected material proposal/ : /Invalid generated material/);
          for(const name of ['appearance.py','request.json','painting.ora','beauty.png','instance'])
            await assert.rejects(readFile(join(folder,name)),/ENOENT/);
        }
      } finally {await fixture.close();}
    });
  }
});

test('browser cancellation closes the real Codex completion before rendering, including late valid data',{timeout:90_000},async t=>{
  const {readdir}=await import('node:fs/promises');
  const {chromium}=await import('playwright-core');
  const {loadDrawing,studio}=await import('./server.js');
  const {fileURLToPath}=await import('node:url');
  const root=await mkdtemp(join(tmpdir(),'cad-codex-cancel-completion-'));
  const selected=process.env.CAD_MATERIAL_CODEX_BIN;
  let release=()=>{},reached=()=>{},opens=0;
  const held=new Promise<void>(done=>{release=done;});
  const entered=new Promise<void>(done=>{reached=done;});
  const fixture=await codexFixture(root,selected ?? 'codex','adopt',async()=>{reached();await held;});
  process.env.CAD_MATERIAL_CODEX_BIN=fixture.binary;
  const drawing=await loadDrawing(fileURLToPath(new URL('../handwheel/',import.meta.url)));
  const output=join(root,'paintings');
  const server=studio(0,{drawing,output,render:paintStandalone,open:async()=>{opens++;}});
  await once(server,'listening');
  const address=server.address();assert.ok(address && typeof address!=='string');
  const origin='http://127.0.0.1:'+address.port;
  const browser=await chromium.launch({channel:'chrome'});
  t.after(async()=>{
    release();await browser.close();server.closeAllConnections();
    await new Promise<void>(done=>server.close(()=>done()));await fixture.close();
    if(selected===undefined) delete process.env.CAD_MATERIAL_CODEX_BIN; else process.env.CAD_MATERIAL_CODEX_BIN=selected;
    await rm(root,{recursive:true,force:true});
  });
  const page=await browser.newPage();await page.goto(origin);
  await page.locator('#controls:enabled').waitFor();
  const saved=page.waitForResponse(r=>r.url()===origin+'/save');void saved.catch(()=>{});
  await page.locator('#save').click();await entered;
  const active=await (await fetch(origin+'/state')).json();assert.equal(active.canCancelLookup,true);
  const cancelled=page.waitForResponse(r=>r.url()===origin+'/cancel-material');
  await page.locator('#cancelMaterial').click();assert.equal((await cancelled).status(),202);
  release();assert.equal((await saved).status(),500);
  const state=await (await fetch(origin+'/state')).json();
  assert.equal(state.locked,false);assert.equal(state.artifact,null);assert.equal(opens,0);
  const [attempt]=await readdir(output);
  const files=await readdir(join(output,attempt));
  for(const name of ['appearance.py','request.json','kit','painting.ora','beauty.png','instance'])
    assert.ok(!files.includes(name),name+' must not exist after cancelled completion');
  assert.equal(fixture.completions.length,1);
});
