import {parameterView} from './view.js';
import {trailingEdits} from './trailing-edits.js';
import {parameters, readPlate, type Dimensions, type Parameter} from './plate-data.js';

const el = (id: string) => document.getElementById(id)!;
const inputs = {
  bore: document.querySelector<HTMLInputElement>('#bore')!,
  thickness: document.querySelector<HTMLInputElement>('#thickness')!,
};
const readSource = async () => readPlate(await fetch('/api/plate'));
async function start() {
  let saved = await readSource();
  const view = parameterView({source: saved, parameters, readSource, paint(field) {
    for (const key of parameters) el(key+'-label').toggleAttribute('data-inspected', key === field);
    el('mark').textContent = field ? 'Check '+field : '';
  }});
  let bound = false;
  let owner: Window | null = window.opener;
  try { if (owner?.location.origin !== location.origin) owner = null; } catch { owner = null; }
  const bind = document.querySelector<HTMLButtonElement>('#bind')!;
  bind.hidden = !owner;
  bind.disabled = false;
  bind.onclick = () => {
    if (!owner) return;
    if (bound) {
      view.disconnect(); bound = false; bind.textContent = 'Bind this view'; return;
    }
    const {port1, port2} = new MessageChannel();
    const target = view.connect(port1);
    if (!target) { port1.close(); port2.close(); return; }
    owner.postMessage({type: 'view.bound', target}, location.origin, [port2]);
    bound = true;
    bind.textContent = 'Disconnect view';
  };
  const savedMessage = () => { el('status').textContent = 'Saved revision '+saved.revision; };
  const queue = trailingEdits<{ticket: number; values: Dimensions}>({
    delay: 180,
    async save({ticket, values}) {
      const response = await fetch('/api/plate', {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({document: saved.document, epoch: saved.epoch, revision: saved.revision, ...values}),
      });
      // Even a superseded ticket supplies the base for the next serialized save.
      saved = await readPlate(response);
      if (view.acceptEdit(ticket, saved)) { bind.disabled = false; savedMessage(); }
    },
    failed(error) {
      const reason = error instanceof Error ? error.message : String(error);
      el('status').textContent = 'Edit unconfirmed. '+reason+'. Reload to read the saved plate.';
    },
  });
  function showValue(key: Parameter) { el(key+'-value').textContent = inputs[key].value+' mm'; }
  for (const key of parameters) {
    const input = inputs[key];
    input.value = String(saved[key]);
    input.disabled = false;
    showValue(key);
    input.addEventListener('input', () => {
      const ticket = view.beginEdit();
      showValue(key);
      bind.disabled = !bound;
      el('status').textContent = 'Editing · waiting for save';
      queue.push({ticket, values: {bore: Number(inputs.bore.value), thickness: Number(inputs.thickness.value)}});
    });
  }
  window.addEventListener('pagehide', () => { queue.close(); view.close(); }, {once: true});
  savedMessage();
}
start().catch((error: unknown) => { el('status').textContent = error instanceof Error ? error.message : String(error); });
