import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile, readdir, realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {benchVise, type Model} from '@an-shuttle/cad/drawing.js';
import {loadDrawing,studio} from './server.js';

test('a browser save delivers only the native host’s accepted products', {timeout:600_000}, async t => {
  const root = await realpath(process.env.CAD_PAINT_TEST_OUTPUT!);
  const wheel = await loadDrawing(fileURLToPath(new URL('../handwheel/',import.meta.url)));
  const materials: string[][] = [];
  const model = createServer(async (request, response) => {
    let message = '';
    for await (const chunk of request) message += chunk;
    materials.push(JSON.parse(message).format.required);
    response.writeHead(200,{'Content-Type':'application/json'});
    response.end(JSON.stringify({response:JSON.stringify({grip:{finish:'walnut',color:'#4a2c23',metallic:0,roughness:0.8}})}));
  });
  model.listen(11434,'127.0.0.1');
  await once(model,'listening');
  t.after(() => new Promise<void>(done => model.close(() => done())));
  const browser = await chromium.launch({channel:'chrome'});
  t.after(() => browser.close());

  const broken: Model = {...benchVise,id:'incomplete',parts:{...benchVise.parts}};
  delete broken.parts.movingJaw;
  for (const drawing of [benchVise,wheel,broken]) {
    await t.test(drawing.id,async () => {
      const output = join(root,drawing.id), opened: string[] = [];
      const server = studio(0,{drawing,output,open:async file => {opened.push(file);}});
      await once(server,'listening');
      const addr = server.address();
      assert.ok(addr && typeof addr!== 'string');
      const origin = 'http://127.0.0.1:'+addr.port;
      const context = await browser.newContext();
      const clicks = materials.length;
      try {
        const [first,second] = await Promise.all([context.newPage(),context.newPage()]);
        await Promise.all([first.goto(origin),second.goto(origin)]);
        for (const page of [first,second]) await page.locator('#controls:enabled').waitFor();
        if (drawing.id!=='handwheel') {
          for (const part of Object.keys(drawing.parts)) await first.locator('#'+part).selectOption('0');
        }
        const before = await (await first.request.get(origin+'/state')).json();
        const pending = first.waitForResponse(response => response.url()===origin+'/save',{timeout:260_000});
        await first.locator('#save').click();
        for (const page of [first,second]) {
          await page.getByText('CAD 已锁定 · 正在绘制',{exact:true}).waitFor();
          assert.equal(await page.locator('input:enabled,select:enabled,button:enabled').count(),0);
        }
        const duplicate = await second.request.post(origin+'/save',{headers:{Origin:origin},data:before});
        assert.equal(duplicate.status(),409);
        const response = await pending;
        const detail = await response.text();
        assert.equal(response.status(),drawing===broken ? 500 : 200,detail);
        await second.locator('#controls:enabled').waitFor();
        const state = await (await first.request.get(origin+'/state')).json();
        assert.equal(state.locked,false); assert.equal(state.revision,1); assert.equal(state.epoch,before.epoch);
        assert.equal(materials.length-clicks,drawing.id==='handwheel' ? 1 : 0);
        const [attempt] = await readdir(output);
        if (drawing===broken) {
          assert.equal(state.artifact,null); assert.deepEqual(opened,[]);
          assert.match(detail,/Host paint attempt ended/);
          for (const name of ['painting.ora','beauty.png'])
            assert.equal((await first.request.get(origin+'/assets/'+attempt+'/'+name)).status(),404);
        } else {
          assert.equal(state.artifact,'/assets/'+attempt);
          assert.deepEqual(opened,[join(output,attempt,'painting.ora')]);
          for (const name of ['painting.ora','beauty.png']) {
            const product = await first.request.get(origin+state.artifact+'/'+name);
            assert.equal(product.status(),200);
            assert.deepEqual(await product.body(),await readFile(join(output,attempt,name)));
          }
        }
      } finally {
        await context.close();
        await new Promise<void>(done => server.close(() => done()));
      }
    });
  }
  assert.deepEqual(materials,[['grip']]);
});
