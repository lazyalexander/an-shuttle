const status = document.getElementById('result');
const opened = new Set();
let active = null;
document.getElementById('open').onclick = () => {
  for (const view of opened) if (view.closed) opened.delete(view);
  const view = window.open('/plate','_blank');
  if (view) opened.add(view);
};

function release(binding) {
  for (const {reject} of binding.pending.values()) reject(Error('View disconnected; outstanding outcome unknown'));
  binding.pending.clear();
  binding.port.close();
  if (active === binding) active = null;
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || !opened.has(event.source) ||
      event.data?.type !== 'view.bound' || event.ports.length !== 1) return;
  if (active) release(active);
  const binding = {port:event.ports[0], pending:new Map()};
  active = binding;
  binding.port.onmessage = ({data}) => {
    if (data.type === 'view.closed') {
      release(binding);
      status.textContent = 'View disconnected.';
      return;
    }
    binding.pending.get(data.operation_id)?.resolve(data);
  };
  status.textContent = 'View bound.';
});
function call(binding, tool, args = {}) {
  const operation_id = crypto.randomUUID();
  return new Promise((resolve,reject) => {
    const timer = setTimeout(()=>{binding.pending.delete(operation_id); reject(Error('No receipt; outcome unknown'));},5000);
    binding.pending.set(operation_id,{
      resolve(value) { clearTimeout(timer); binding.pending.delete(operation_id); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    binding.port.postMessage({operation_id,tool,...args});
  });
}
document.getElementById('check').onclick = async () => {
  const binding = active;
  try {
    const target = binding ? (await call(binding,'observe_view')).target : null;
    const response = await fetch('/api/check');
    if (!response.ok) throw Error('Check unavailable');
    const check = await response.json();
    const label = 'Saved check · revision '+check.revision+' · '+(check.parameter ?? 'clear');
    if (!binding || !check.parameter) { status.textContent = label; return; }
    if (binding !== active || !target || target.document !== check.document ||
        target.revision !== check.revision || target.epoch !== check.epoch) {
      status.textContent = label+' · view stale'; return;
    }
    const receipt = await call(binding,'highlight_parameter',{target,parameter:check.parameter});
    status.textContent = label+' · '+(receipt.reason ?? receipt.status);
  } catch (error) { status.textContent = error.message; }
};
