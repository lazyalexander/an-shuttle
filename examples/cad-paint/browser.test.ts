import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {studio} from './server.js';

test('saving freezes every CAD control across tabs, including a newly opened view', {timeout:60_000},async t=>{
  const output=await mkdtemp(join(tmpdir(),'shuttle-lock-'));
  let fail!:()=>void;
  const held=new Promise<void>(resolve=>{fail=resolve;});
  let jobs=0, opens=0;
  const server=studio(0,{output,render:async(_scene,_revision,folder)=>{
    if (++jobs===1) {await held;throw Error('test render failed');}
    return join(folder,'painting.ora');
  },open:async()=>{opens++;}});
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
    const c=await browser.newPage();await c.goto(url);
    for(const page of [a,b,c]){
      await page.getByText(/CAD 已锁定 · 正在绘制/).waitFor();
      assert.equal(await page.locator('input:enabled,select:enabled,button:enabled').count(),0);
    }
    const post=(data:unknown)=>b.request.post(url+'/save',{data,headers:{Origin:url}});
    assert.equal((await post({...original,revision:1})).status(),409);
    fail();
    await b.getByText(/绘制失败/).first().waitFor();
    await b.locator('#controls:enabled').waitFor();
    assert.equal((await post(original)).status(),409);
    await b.locator('#save').click();
    await c.locator('#download').waitFor();
    assert.equal(jobs,2);assert.equal(opens,1);
  }finally{fail();await browser.close();}
});
