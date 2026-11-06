import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {benchVise, type Model} from '@an-shuttle/cad/drawing.js';
import {openInKrita} from '@an-shuttle/krita/document.js';
import {loadDrawing,studio} from './server.js';

test('a browser save delivers only the native host’s accepted products', {timeout:1_350_000}, async t => {
  const root = await realpath(process.env.CAD_PAINT_TEST_OUTPUT!);
  const wheel = await loadDrawing(fileURLToPath(new URL('../handwheel/',import.meta.url)));
  const fixture=process.env.CAD_PAINT_FIXTURE;
  assert.ok(['vise','handwheel','incomplete','cancelled'].includes(fixture!));
  const liveModel=process.env.CAD_PAINT_REAL_MODEL==='1';
  const hostAgent=process.env.CAD_MATERIAL_HOST_AGENT==='1';
  if (hostAgent) assert.ok(process.env.CAD_MATERIAL_READER,'Host material acceptance requires the delegated reader');
  const liveHistory=hostAgent && liveModel && fixture==='handwheel';
  const cancelOnly=liveHistory && process.env.CAD_PAINT_CANCEL_ONLY==='1';
  const direct=process.env.CAD_PAINT_DIRECT==='1';
  const upstream=process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  const direction='Use dark walnut for the grip; preserve the supplied metal finishes.';
  const materials: string[][] = [];
  let lookups=0, proofs=0;
  let holdRequest=false;
  let releaseRequest=()=>{};
  let lookupRequested=()=>{};
  let proxyFinished=(matched:boolean)=>{void matched;};
  const delayed=new Promise<void>(resolve=>{releaseRequest=resolve;});
  const requested=new Promise<void>(resolve=>{lookupRequested=resolve;});
  const sent=new Promise<boolean>(resolve=>{proxyFinished=resolve;});
  const exchanges: {request: {prompt:string;model:string;format:{required:string[]}};response:string}[] = [];
  const model = createServer(async (request, response) => {
    try {
      let message = '';
      for await (const chunk of request) message += chunk;
      const input=JSON.parse(message);
      if (request.url==='/v1/chat/completions') {
        assert.equal(hostAgent,true);
        const prefix='[external-context-untrusted] ';
        const line=input.messages.find((entry:{role:string})=>entry.role==='user')?.content
          .split('\n').find((entry:string)=>entry.startsWith(prefix));
        assert.ok(line,'Host must supply one tagged context packet');
        const packet=JSON.parse(line.slice(prefix.length));
        const data=JSON.parse(packet.text);
        const action=packet.source==='cad:material:request';
        assert.equal(packet.source,action ? 'cad:material:request' : 'cad:material:adopt');
        if (action) lookups++; else proofs++;
        const answer=action ? {action:'read_approved_material',...data.permitted}
          : {adopt:true,evidence_id:data.evidence_id};
        const holding=action && holdRequest;
        if (holding) lookupRequested();
        const result=liveModel
          ? await fetch(new URL(request.url,upstream),{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({...input,reasoning_effort:'none',temperature:0,response_format:{type:'json_object'}}),
            signal:AbortSignal.timeout(holding ? 600_000 : 300_000)}).then(async r=>{assert.equal(r.status,200);return r.text();})
          : JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}],
            usage:{prompt_tokens:10,completion_tokens:5}});
        if (liveModel) {
          const modelReply=JSON.parse(result);
          console.log(JSON.stringify({stage:packet.source,finishReason:modelReply.choices[0].finish_reason,
            usage:modelReply.usage}));
        }
        if (holding) {
          const reply=JSON.parse(JSON.parse(result).choices[0].message.content);
          assert.deepEqual(reply,answer,'The delayed real model reply must be a valid lookup proposal');
          await delayed;
          response.end(result);
          proxyFinished(true);
          return;
        }
        response.writeHead(200,{'Content-Type':'application/json'});response.end(result);
        return;
      }
      if (request.url==='/api/chat') {
        const action=input.tools.length===1;
        if (action) lookups++; else proofs++;
        const result=liveModel
          ? await fetch(new URL('/api/chat',upstream),{method:'POST',headers:{'Content-Type':'application/json'},
            body:message,signal:AbortSignal.timeout(120_000)}).then(async r=>{assert.equal(r.status,200);return r.text();})
          : JSON.stringify({message:action
            ? {role:'assistant',content:'',tool_calls:[{function:{name:'read_approved_material',arguments:JSON.parse(input.messages[1].content)}}]}
            : {role:'assistant',content:JSON.stringify({adopt:true,evidence_id:JSON.parse(input.messages.at(-1).content).evidence_id})}});
        response.writeHead(200,{'Content-Type':'application/json'});response.end(result);
        return;
      }
      materials.push(input.format.required);
      const result=liveModel
        ? await fetch(new URL('/api/generate',upstream),{method:'POST',headers:{'Content-Type':'application/json'},
          body:message,signal:AbortSignal.timeout(120_000)}).then(async r=>{assert.equal(r.status,200);return r.text();})
        : JSON.stringify({response:JSON.stringify(Object.fromEntries(input.format.required.map((part:string)=>
          [part,{finish:'walnut',color:'#4a2c23',metallic:0,roughness:0.8}])) )});
      exchanges.push({request:input,response:result});
      response.writeHead(200,{'Content-Type':'application/json'});response.end(result);
    } catch(error) {
      if (holdRequest) proxyFinished(false);
      response.writeHead(502);response.end(String(error));
    }
  });
  model.listen(0,'127.0.0.1');
  await once(model,'listening');
  const modelAddress=model.address();
  assert.ok(modelAddress && typeof modelAddress!=='string');
  process.env.OLLAMA_HOST='http://127.0.0.1:'+modelAddress.port;
  t.after(() => {model.closeAllConnections();return new Promise<void>(done => model.close(() => done()));});
  console.log('Launching Chrome for',fixture);
  const browser = await chromium.launch({channel:'chrome'});
  t.after(() => browser.close());

  const broken: Model = {...benchVise,id:'incomplete',parts:{...benchVise.parts}};
  delete broken.parts.movingJaw;
  const cancelled: Model = {...benchVise,id:'cancelled'};
  for (const drawing of [benchVise,wheel,broken,cancelled]) {
    if (drawing.id!==fixture) continue;
    await t.test(drawing.id,async () => {
      const output = join(root,drawing.id), opened: string[] = [];
      const server = studio(0,{drawing,output,open:async file => {
        opened.push(file);
        if(process.env.CAD_PAINT_REAL_KRITA==='1') await openInKrita(file);
      }});
      await once(server,'listening');
      const addr = server.address();
      assert.ok(addr && typeof addr!== 'string');
      const origin = 'http://127.0.0.1:'+addr.port;
      const context = await browser.newContext();
      context.setDefaultTimeout(15_000);
      const clicks = materials.length;
      try {
        const [first,second] = await Promise.all([context.newPage(),context.newPage()]);
        await Promise.all([first.goto(origin),second.goto(origin)]);
        for (const page of [first,second]) await page.locator('#controls:enabled').waitFor();
        if (drawing.id!=='handwheel' || direct) {
          for (const part of Object.keys(drawing.parts)) await first.locator('#'+part).selectOption('0');
        }
        if (liveHistory) await first.locator('#grip').selectOption('0');
        const before = await (await first.request.get(origin+'/state')).json();
        const post=(originHeader:string,body:unknown)=>fetch(origin+'/save',{method:'POST',
          headers:{origin:originHeader,'content-type':'application/json'},body:JSON.stringify(body)});
        assert.equal((await post('http://untrusted.invalid',before)).status,403);
        assert.equal((await post(origin,{...before,revision:before.revision+1})).status,409);
        await first.locator('#direction').fill(direction);
        const markSave=()=>first.evaluate(() => {
          const controls=document.querySelector<HTMLFieldSetElement>('#controls')!;
          document.querySelector('#save')!.addEventListener('click',() => {
            performance.mark('paint-click');
            let observedLock=false;
            const observer=new MutationObserver(() => {
              if (controls.disabled && !observedLock) {performance.mark('paint-locked');observedLock=true;}
              else if (!controls.disabled && observedLock) {performance.mark('paint-unlocked');observer.disconnect();}
            });
            observer.observe(controls,{attributes:true,attributeFilter:['disabled']});
          },{capture:true,once:true});
        });
        await markSave();
        if (direct) {
          await second.evaluate(() => {
            const controls=document.querySelector<HTMLFieldSetElement>('#controls')!;
            const observer=new MutationObserver(() => {
              if (controls.disabled) {performance.mark('other-locked');observer.disconnect();}
            });
            observer.observe(controls,{attributes:true,attributeFilter:['disabled']});
          });
        }
        console.log('Submitting',fixture);
        let started=0;
        const pending = first.waitForResponse(response => response.url()===origin+'/save',{timeout:630_000})
          .then(response=>({response,saveResponseMs:performance.now()-started}));
        void pending.catch(() => {});
        await first.bringToFront();
        started=performance.now();
        await first.locator('#save').click();
        console.log('Save clicked',fixture);
        for (const page of [first,second]) {
          await page.getByText('CAD 已锁定 · 正在绘制',{exact:true}).waitFor();
          assert.equal(await page.locator('input:enabled,select:enabled,button:enabled:not(#cancelMaterial)').count(),0);
        }
        console.log('Both tabs locked',fixture);
        const duplicate = await fetch(origin+'/save',{method:'POST',headers:{origin,'content-type':'application/json'},
          body:JSON.stringify(before),signal:AbortSignal.timeout(10_000)});
        assert.equal(duplicate.status,409);
        await duplicate.text();
        if (drawing===cancelled) {
          const execute=promisify(execFile), host=process.env.AN_AGENT_HOST_BIN ?? 'an-agent-host';
          const deadline=Date.now()+30_000;
          let instance='';
          while (Date.now()<deadline) {
            const [attempt]=await readdir(output).catch(()=>[]);
            if (attempt) {
              instance=join(output,attempt,'instance');
              if (await readFile(join(instance,'runs/paint/job/work/scene.json')).catch(()=>null)) break;
            }
            await delay(20);
          }
          assert.ok(instance && Date.now()<deadline,'actual render must start before cancellation');
          const call=async(...args:string[])=>JSON.parse((await execute(host,args,{timeout:15_000})).stdout);
          const active=await call('spool-status',instance,'paint');
          assert.equal(active.termination_confirmed,false);
          const args=['spool-supervisor','cancel',instance,'paint'];
          const preview=await call(...args);
          await call(...args,'--approve',preview.approval_sha256);
        }
        const {response,saveResponseMs} = await pending;
        console.log('Save returned',fixture,response.status());
        assert.equal(response.status(),drawing===broken || drawing===cancelled ? 500 : 200);
        const uiLockMs=await first.evaluate(() => performance.measure('paint lock','paint-click','paint-locked').duration);
        const locks=[uiLockMs];
        const measurements={drawing:drawing.id,clickToLockMs:uiLockMs,saveResponseMs,
          modelRequests:materials.length-clicks,http:response.status()};
        if (direct) {
          await first.locator('#controls:enabled').waitFor();
          const clickToDeliveryMs=await first.evaluate(() =>
            performance.measure('paint delivery','paint-click','paint-unlocked').duration);
          const clickEpochMs=await first.evaluate(() =>
            performance.timeOrigin+performance.getEntriesByName('paint-click','mark')[0].startTime);
          const otherWindowLockMs=await second.evaluate(() =>
            performance.timeOrigin+performance.getEntriesByName('other-locked','mark')[0].startTime)-clickEpochMs;
          const directMeasurements={...measurements,otherWindowLockMs,clickToDeliveryMs};
          console.log(JSON.stringify(directMeasurements));
          await writeFile(join(root,drawing.id+'-direct-timing.local.json'),JSON.stringify(directMeasurements));
        } else {
          console.log(JSON.stringify(measurements));
        }
        await second.locator('#controls:enabled').waitFor();
        const state = await (await fetch(origin+'/state',{signal:AbortSignal.timeout(10_000)})).json();
        assert.equal(state.locked,false); assert.equal(state.revision,1); assert.equal(state.epoch,before.epoch);
        assert.equal(materials.length-clicks,drawing.id==='handwheel' && !liveHistory && !direct ? 1 : 0);
        const [attempt] = await readdir(output);
        if (drawing===broken || drawing===cancelled) {
          assert.equal(state.artifact,null); assert.deepEqual(opened,[]);
          assert.match(state.message,/Host paint attempt ended/);
          for (const name of ['painting.ora','beauty.png'])
            assert.equal((await fetch(origin+'/assets/'+attempt+'/'+name,{signal:AbortSignal.timeout(10_000)})).status,404);
        } else {
          assert.equal(state.artifact,'/assets/'+attempt);
          assert.deepEqual(opened,[join(output,attempt,'painting.ora')]);
          for (const name of ['painting.ora','beauty.png']) {
            const product = await fetch(origin+state.artifact+'/'+name,{signal:AbortSignal.timeout(10_000)});
            assert.equal(product.status,200);
            assert.deepEqual(Buffer.from(await product.arrayBuffer()),await readFile(join(output,attempt,name)));
          }
        }
        if (drawing===wheel && !liveHistory && !direct) {
          const brief=JSON.parse(exchanges.at(-1)!.request.prompt.split('\n').slice(1).join('\n'));
          assert.equal(brief.description,drawing.description);assert.equal(brief.direction,direction);
          assert.deepEqual(brief.supplied,state.scene.materials);
          assert.deepEqual(brief.missing,{grip:{label:drawing.parts.grip.label}});
          assert.deepEqual(Object.keys(brief).sort(),['description','direction','missing','supplied']);
        }
        if (!direct && (drawing===wheel || drawing===benchVise) && process.env.CAD_MATERIAL_READER) {
          const part=drawing===wheel ? 'grip' : 'movingJaw';
          assert.deepEqual(state.materialReference,{part,revision:1});
          const readState=async()=> (await first.request.get(origin+'/state')).json();
          const stale=await post(origin,{...state,reuseMaterial:0});
          assert.equal(stale.status,409);
          await stale.text();

          let current=state;
          for (const mode of cancelOnly ? [] : ['complement','exact','history']) {
            const generated=materials.length;
            if (mode==='complement') await first.locator('#'+part).selectOption(drawing===wheel ? '0' : '');
            if (mode==='exact') await first.locator('#reuseGrip').check();
            if (mode==='history') await first.locator('#verifyHistory').check();
            await markSave();
            const start=performance.now();
            const reply=first.waitForResponse(r=>r.url()===origin+'/save',{timeout:630_000})
              .then(response=>({response,saveResponseMs:performance.now()-start}));
            void reply.catch(()=>{});
            await first.locator('#save').click();
            await second.getByText('CAD 已锁定 · 正在绘制',{exact:true}).waitFor();
            assert.equal(await second.locator('input:enabled,select:enabled,button:enabled:not(#cancelMaterial)').count(),0);
            const completed=await reply;
            assert.equal(completed.response.status(),200);
            await second.locator('#controls:enabled').waitFor();
            const elapsed=await first.evaluate(()=>performance.measure('paint lock','paint-click','paint-locked').duration);
            locks.push(elapsed);
            console.log(JSON.stringify({drawing:drawing.id,mode,clickToLockMs:elapsed,saveResponseMs:completed.saveResponseMs}));
            const after=await readState();
            assert.equal(after.revision,current.revision+1);
            assert.deepEqual(after.materialReference,{part,revision:after.revision});
            assert.notEqual(after.artifact,current.artifact);
            assert.equal(materials.length-generated,mode==='complement' && drawing===benchVise ? 1 : 0);
            assert.equal(lookups,mode==='history' ? 1 : 0);
            assert.equal(proofs,lookups);
            if (hostAgent && mode==='history') {
              const folder=join(output,after.artifact.split('/').at(-1));
              for (const stage of ['request','adopt']) {
                const receipt=JSON.parse(await readFile(join(folder,stage+'-agent','receipt.json'),'utf8'));
                assert.equal(receipt.status,'succeeded');
              }
            }
            const expired=await post(origin,current);
            assert.equal(expired.status,409);
            await expired.text();
            current=after;
          }
          if (liveHistory) {
            holdRequest=true;
            const priorProofs=proofs;
            const priorFolders=new Set(await readdir(output));
            const priorOpens=opened.length;
            await first.locator('#verifyHistory').check();
            const cancelledSave=first.waitForResponse(r=>r.url()===origin+'/save',{timeout:630_000});
            void cancelledSave.catch(()=>{});
            await first.locator('#save').click();
            await Promise.race([requested,delay(310_000,undefined,{ref:false}).then(()=>{throw Error('The host did not request a lookup decision');})]);
            const cancellation=first.waitForResponse(r=>r.url()===origin+'/cancel-material');
            await first.locator('#cancelMaterial').click();
            assert.equal((await cancellation).status(),202);
            releaseRequest();
            assert.equal((await cancelledSave).status(),500);
            assert.equal(await sent,true,'The real Ollama reply must arrive after cancellation');
            assert.equal(proofs,priorProofs,'The cancelled proposal must not reach evidence adoption');
            const settled=await readState();
            assert.equal(settled.artifact,null);
            assert.equal(settled.locked,false);
            assert.equal(opened.length,priorOpens);
            const created=(await readdir(output)).filter(entry=>!priorFolders.has(entry));
            assert.equal(created.length,1);
            const files=await readdir(join(output,created[0]));
            for (const product of ['painting.ora','beauty.png','accepted.json','instance','adopt-agent'])
              assert.ok(!files.includes(product),product+' was created after cancelling lookup');
            console.log('Live Ollama lookup proposal arrived after cancellation; no adoption or render started');
          }
          await writeFile(join(root,drawing.id+'-lock-timings.json'),JSON.stringify(locks));
        }
      } catch (error) {
        const route = await fetch(origin+'/state').then(r => r.json()).catch(() => null);
        console.error('CAD failure evidence',drawing.id,route?.revision,route?.locked,route?.message);
        for (const attempt of await readdir(output).catch(() => [])) {
          for (const stage of ['request','adopt']) {
            const raw=await readFile(join(output,attempt,stage+'-agent','receipt.json'),'utf8').catch(()=>null);
            if (raw) {
              const receipt=JSON.parse(raw);
              console.error('material receipt',stage,receipt.status,receipt.model_attempt);
            }
          }
          const result = await readFile(join(output,attempt,'instance/runs/paint/result.json'),'utf8').catch(() => null);
          if (result) {
            const record=JSON.parse(result);
            console.error('host receipt',record.status,record.workspace?.termination_confirmed);
          }
        }
        throw error;
      } finally {
        releaseRequest();
        await context.close();
        server.closeAllConnections();
        await new Promise<void>(done => server.close(() => done()));
      }
    });
  }
  if (direct) {
    assert.deepEqual(materials,[]);
    assert.equal(lookups+proofs,0);
  } else {
    assert.deepEqual(materials,fixture==='handwheel' && !liveHistory ? [['grip']] :
      fixture==='vise' && process.env.CAD_MATERIAL_READER ? [['movingJaw']] : []);
  }
  await writeFile(join(root,fixture+'-model-exchange.local.json'),JSON.stringify({liveModel,exchanges}));
});
