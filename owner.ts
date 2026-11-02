import {isReceipt, isRecord, isViewTarget, type Command, type Operation, type Receipt} from './protocol.js';
import {readFinding, type Parameter} from './plate-data.js';

interface Binding {
  port: MessagePort;
  pending: Map<string, {resolve(value: Receipt): void; reject(error: Error): void}>;
}

const status = document.getElementById('result')!;
const opened = new Set<Window>();
let active: Binding | null = null;
document.getElementById('open')!.onclick = () => {
  for (const view of opened) if (view.closed) opened.delete(view);
  const view = window.open('/plate', '_blank');
  if (view) opened.add(view);
};

function release(binding: Binding) {
  for (const {reject} of binding.pending.values()) reject(Error('View disconnected; outstanding outcome unknown'));
  binding.pending.clear();
  binding.port.close();
  if (active === binding) active = null;
}
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const {source, data, ports} = event;
  if (event.origin !== location.origin || !source || !('closed' in source) || !opened.has(source) ||
      !isRecord(data) || data.type !== 'view.bound' || !isViewTarget(data.target) || ports.length !== 1) return;
  if (active) release(active);
  const binding: Binding = {port: ports[0], pending: new Map()};
  active = binding;
  binding.port.onmessage = ({data}: MessageEvent<unknown>) => {
    if (isRecord(data) && data.type === 'view.closed') {
      release(binding);
      status.textContent = 'View disconnected.';
      return;
    }
    if (isReceipt(data)) binding.pending.get(data.operation_id)?.resolve(data);
  };
  status.textContent = 'View bound.';
});
function call(binding: Binding, operation: Operation<Parameter>): Promise<Receipt> {
  const operation_id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      binding.pending.delete(operation_id);
      reject(Error('No receipt; outcome unknown'));
    }, 5000);
    binding.pending.set(operation_id, {
      resolve(value) { clearTimeout(timer); binding.pending.delete(operation_id); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    binding.port.postMessage({operation_id, ...operation} satisfies Command<Parameter>);
  });
}
document.getElementById('check')!.onclick = async () => {
  const binding = active;
  try {
    const observation = binding ? await call(binding, {tool: 'observe_view'}) : null;
    const target = observation?.status === 'observed' ? observation.target : null;
    const check = await readFinding(await fetch('/api/check'));
    const label = 'Saved check · revision ' + check.revision + ' · ' + (check.parameter ?? 'clear');
    if (!binding || !check.parameter) { status.textContent = label; return; }
    if (binding !== active || !target || target.document !== check.document ||
        target.revision !== check.revision || target.epoch !== check.epoch) {
      status.textContent = label + ' · view stale'; return;
    }
    const receipt = await call(binding, {tool: 'highlight_parameter', target, parameter: check.parameter});
    status.textContent = label + ' · ' + (receipt.status === 'rejected' ? receipt.reason : receipt.status);
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
};
