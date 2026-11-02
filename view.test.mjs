import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {plateStore} from './server.mjs';
import {parameterView} from './view.mjs';
import {trailingEdits} from './trailing-edits.mjs';

test('old result rejected at 179 ms, new saved revision admitted at 180 ms', async t => {
  const store = plateStore(), original = store.read();
  let marked = null, now = 0, scheduled;
  const clock = {clearTimeout(){scheduled=null;},setTimeout(fn,delay){scheduled={at:now+delay,fn};return 1;}};
  function advance(ms) { now+=ms; if(scheduled && now>=scheduled.at){const {fn}=scheduled; scheduled=null; fn();} }
  const view = parameterView({source:original, parameters:['bore'],readSource:async()=>store.read(),paint:key=>{marked=key;}});
  const {port1,port2} = new MessageChannel();
  t.after(()=>{view.close();port2.close();});
  const target=view.connect(port1);
  async function call(id,target) {
    const reply=once(port2,'message');
    port2.postMessage({tool:'highlight_parameter',operation_id:id,parameter:'bore',target});
    return (await reply)[0];
  }
  assert.equal((await call('initial',target)).status,'applied');
  const queue=trailingEdits({delay:180,clock,save:({ticket,bore})=>{
    assert.ok(view.acceptEdit(ticket,store.save({...original,bore})));
  },failed:assert.fail});
  queue.push({ticket:view.beginEdit(),bore:22});
  assert.equal(marked,null);
  advance(150);
  queue.push({ticket:view.beginEdit(),bore:original.bore});
  advance(179);
  assert.equal(store.read().revision,original.revision);
  assert.equal((await call('late',target)).reason,'stale_view');
  advance(1);
  assert.equal(store.read().revision,original.revision+1);
  assert.equal((await call('still-late',target)).reason,'stale_view');
  const observed=once(port2,'message');port2.postMessage({operation_id:'observe',tool:'observe_view'});
  assert.equal((await call('new',(await observed)[0].target)).status,'applied');
});

test('input while a source read is pending fences the result',async t=>{
  const source=plateStore().read(); let release,started;
  const reading=new Promise(r=>{started=r;});
  let mark=null;
  const view=parameterView({source,parameters:['bore'],paint:v=>{mark=v;},readSource:()=>{started();return new Promise(r=>{release=r;});}});
  const {port1,port2}=new MessageChannel();t.after(()=>{view.close();port2.close();});
  const target=view.connect(port1),result=once(port2,'message');
  port2.postMessage({tool:'highlight_parameter',operation_id:'check',parameter:'bore',target});
  await reading;view.beginEdit();release(source);
  assert.equal((await result)[0].reason,'stale_view');assert.equal(mark,null);
});

test('saving a document with no views computes a versioned finding',()=>{
  const store=plateStore(),saved=store.save({...store.read(),thickness:4});
  assert.equal(store.check().parameter,'thickness');
  assert.equal(store.check().revision,saved.revision);
});
