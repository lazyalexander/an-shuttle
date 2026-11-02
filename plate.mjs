import {parameterView} from './view.mjs';
import {trailingEdits} from './trailing-edits.mjs';

const el = id => document.getElementById(id);
const parameters = ['bore','thickness'];
const readSource = async () => {
  const response = await fetch('/api/plate');
  if (!response.ok) throw Error('Saved plate unavailable');
  return response.json();
};
async function start() {
  let saved = await readSource();
  const view = parameterView({source:saved, parameters, readSource, paint(field) {
    for (const key of parameters) el(key+'-label').toggleAttribute('data-inspected',key === field);
    el('mark').textContent = field ? 'Check '+field : '';
  }});
  let bound = false;
  let owner = window.opener;
  try { if (owner?.location.origin !== location.origin) owner = null; } catch { owner = null; }
  const bind = el('bind');
  bind.hidden = !owner;
  bind.disabled = false;
  bind.onclick = () => {
    if (bound) {
      view.disconnect(); bound = false; bind.textContent = 'Bind this view'; return;
    }
    const {port1, port2} = new MessageChannel();
    const target = view.connect(port1);
    if (!target) { port1.close(); port2.close(); return; }
    owner.postMessage({type:'view.bound',target},location.origin,[port2]);
    bound = true;
    bind.textContent = 'Disconnect view';
  };
  const savedMessage = () => { el('status').textContent = 'Saved revision '+saved.revision; };
  const queue = trailingEdits({delay:180, async save({ticket, values}) {
    const response = await fetch('/api/plate',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({document:saved.document, epoch:saved.epoch, revision:saved.revision, ...values})});
    if (!response.ok) throw Error(await response.text());
    saved = await response.json(); // the next serialized save needs this base even if this ticket expired
    if (view.acceptEdit(ticket,saved)) { bind.disabled=false; savedMessage(); }
  }, failed(error) { el('status').textContent = 'Edit unconfirmed. '+error.message+'. Reload to read the saved plate.'; }});
  function showValue(key) { el(key+'-value').textContent = el(key).value+' mm'; }
  for (const key of parameters) {
    const input = el(key);
    input.value = saved[key];
    input.disabled = false;
    showValue(key);
    input.addEventListener('input', () => {
      const ticket = view.beginEdit();
      showValue(key);
      bind.disabled = !bound;
      el('status').textContent = 'Editing · waiting for save';
      queue.push({ticket, values:{bore:Number(el('bore').value), thickness:Number(el('thickness').value)}});
    });
  }
  window.addEventListener('pagehide', () => { queue.close(); view.close(); }, {once:true});
  savedMessage();
}
start().catch(error => { el('status').textContent = error.message; });
