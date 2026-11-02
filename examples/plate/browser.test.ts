import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {serve} from './server.js';

test('only the bound Chrome tab applies a current result', {timeout: 90_000}, async t => {
  const server = serve(0);
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const host = await browser.newPage();
    await host.goto('http://127.0.0.1:'+address.port);
    async function open() {
      const next = host.waitForEvent('popup');
      await host.getByText('Open plate view').click();
      const view = await next;
      await view.getByText('Saved revision 0').waitFor();
      return view;
    }
    const a=await open(), b=await open();
    await a.getByText('Bind this view').click();
    await host.getByText('View bound.').waitFor();
    const check = () => host.getByText('Show saved check').click();
    await check();
    await a.locator('#bore-label[data-inspected]').waitFor();
    assert.equal(await b.locator('[data-inspected]').count(),0);
    assert.equal(await a.locator('#bore-label').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await a.route('**/api/plate', async route => {
      if (route.request().method() === 'PUT') await held;
      await route.continue();
    });
    const saving = a.waitForRequest(request => request.method() === 'PUT');
    await a.getByRole('slider',{name:'Thickness'}).press('Home');
    await saving;
    assert.equal(await a.locator('[data-inspected]').count(),0);
    await check();
    await host.getByText(/revision 0.*view stale/).waitFor();
    const accepted=a.waitForResponse(r=>r.request().method()==='PUT' && r.ok());
    release();
    await accepted;
    await a.getByText('Saved revision 1').waitFor();
    await check();
    await a.locator('#thickness-label[data-inspected]').waitFor();
    assert.equal(await a.evaluate(()=>document.activeElement?.id),'thickness');
    await a.reload();
    await a.getByText('Saved revision 1').waitFor();
    await check();
    await host.getByText(/^Saved check · revision 1 · thickness$/).waitFor();
    assert.equal(await a.locator('[data-inspected]').count(),0);
    assert.equal(await b.locator('[data-inspected]').count(),0);
  } finally { await browser.close(); }
});
