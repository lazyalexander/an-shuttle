import test from 'node:test';
import assert from 'node:assert/strict';
import {plateStore} from './server.js';
import {parameterView} from './view.js';
import {trailingEdits} from './trailing-edits.js';
import {isReceipt, type Command, type Receipt, type ViewTarget} from './protocol.js';

async function exchange(port: MessagePort, command: unknown): Promise<Receipt> {
  const response = new Promise<unknown>(resolve => {
    port.addEventListener('message', (event: MessageEvent<unknown>) => resolve(event.data), {once: true});
  });
  port.start();
  port.postMessage(command);
  const reply = await response;
  assert.ok(isReceipt(reply));
  return reply;
}

function highlight(operation_id: string, target: ViewTarget): Command<'bore'> {
  return {operation_id, target, tool: 'highlight_parameter', parameter: 'bore'};
}

test('old result rejected at 179 ms, new saved revision admitted at 180 ms', async t => {
  const store = plateStore(), original = store.read();
  let marked: 'bore' | null = null, now = 0;
  let scheduled: {at: number; fn: () => void} | null = null;
  const clock = {
    clearTimeout() { scheduled = null; },
    setTimeout(fn: () => void, delay: number) { scheduled = {at: now + delay, fn}; return 1; },
  };
  function advance(ms: number) {
    now += ms;
    if (scheduled && now >= scheduled.at) {
      const {fn} = scheduled;
      scheduled = null;
      fn();
    }
  }
  const view = parameterView({source: original, parameters: ['bore'], readSource: async () => store.read(), paint: key => { marked = key; }});
  const {port1, port2} = new MessageChannel();
  t.after(() => { view.close(); port2.close(); });
  const target = view.connect(port1);
  assert.ok(target);
  assert.equal((await exchange(port2, highlight('initial', target))).status, 'applied');
  assert.equal(marked, 'bore');

  const queue = trailingEdits<{ticket: number; bore: number}>({
    delay: 180, clock,
    save: ({ticket, bore}) => { assert.ok(view.acceptEdit(ticket, store.save({...original, bore}))); },
    failed(error) { throw error; },
  });
  queue.push({ticket: view.beginEdit(), bore: 22});
  assert.equal(marked, null);
  advance(150);
  queue.push({ticket: view.beginEdit(), bore: original.bore});
  advance(179);
  assert.equal(store.read().revision, original.revision);
  assert.deepEqual(await exchange(port2, highlight('late', target)), {operation_id:'late', status:'rejected', reason:'stale_view'});
  advance(1);
  assert.equal(store.read().revision, original.revision + 1);
  assert.deepEqual(await exchange(port2, highlight('still-late', target)), {operation_id:'still-late', status:'rejected', reason:'stale_view'});
  const observed = await exchange(port2, {operation_id:'observe', tool:'observe_view'} satisfies Command);
  assert.ok(observed.status === 'observed' && observed.target);
  assert.equal((await exchange(port2, highlight('new', observed.target))).status, 'applied');
});

test('input while a source read is pending fences the result', async t => {
  const source = plateStore().read();
  let release!: (value: typeof source) => void, started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<typeof source>(resolve => { release = resolve; });
  let mark: 'bore' | null = null;
  const view = parameterView({
    source, parameters: ['bore'], paint: value => { mark = value; },
    readSource() { started(); return pending; },
  });
  const {port1, port2} = new MessageChannel();
  t.after(() => { view.close(); port2.close(); });
  const target = view.connect(port1);
  assert.ok(target);
  const reply = exchange(port2, highlight('check', target));
  await reading;
  view.beginEdit();
  release(source);
  assert.deepEqual(await reply, {operation_id:'check', status:'rejected', reason:'stale_view'});
  assert.equal(mark, null);
});

test('saving a document with no views computes a versioned finding', () => {
  const store = plateStore(), saved = store.save({...store.read(), thickness: 4});
  assert.equal(store.check().parameter, 'thickness');
  assert.equal(store.check().revision, saved.revision);
});

test('malformed wire revisions are rejected before a source read', async t => {
  const source = plateStore().read();
  let reads = 0;
  const view = parameterView({
    source, parameters: ['bore'], readSource: async () => { reads++; return source; },
    paint(field) { assert.equal(field, null); },
  });
  const {port1, port2} = new MessageChannel();
  t.after(() => { view.close(); port2.close(); });
  const target = view.connect(port1);
  assert.ok(target);
  const reply = await exchange(port2, {...highlight('bad', target), target: {...target, revision: String(target.revision)}});
  assert.deepEqual(reply, {operation_id:'bad', status:'rejected', reason:'stale_view'});
  assert.equal(reads, 0);
});
