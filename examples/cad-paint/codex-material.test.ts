import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {codexMaterialTurn} from './codex-material.js';
import {codexFixture} from './codex-fixture.test-helper.js';
import {verifyMaterial} from './verify-material.js';

// Explicit integration suite: requires the qualified CLI on PATH, no login or model key.
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
      } finally {await fixture.close();}
    });
  }
});
