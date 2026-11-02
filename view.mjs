// The application owns the document revision and the actual visual change.
// A port is attached only after the host and the user select this view.
export function parameterView({source, parameters, readSource, paint}) {
  const identity = {document: source.document, epoch: source.epoch};
  const allowed = new Set(parameters);
  let revision = source.revision, generation = 0, editing = false, closed = false;
  let binding = null;

  function matchesSource(value) {
    return value?.document === identity.document && value.epoch === identity.epoch &&
      value.revision === revision;
  }
  function target() {
    if (!binding || editing || closed) return null;
    return {...identity, revision, view: binding.view, edit_generation: generation};
  }
  function matchesTarget(value) {
    return !closed && !editing && binding && value?.view === binding.view &&
      value.edit_generation === generation && matchesSource(value);
  }
  function disconnect() {
    if (binding) {
      binding.port.postMessage({type: 'view.closed', view: binding.view});
      binding.port.close();
      binding = null;
    }
    paint(null);
  }
  function connect(port) {
    if (binding || closed || editing) return null;
    const view = crypto.randomUUID();
    binding = {view, port};
    const receipts = new Map();
    let tail = Promise.resolve();

    async function receive(command) {
      if (binding?.port !== port) return;
      const id = command?.operation_id;
      const reject = reason => ({operation_id: id, status: 'rejected', reason});
      if (typeof id !== 'string' || !id.length || id.length > 128) {
        port.postMessage({status:'rejected', reason:'invalid_operation_id'});
        return;
      }
      if (command.tool === 'observe_view') {
        port.postMessage({operation_id:id, status:'observed', target:target()});
        return;
      }
      if (command.tool !== 'highlight_parameter' || !allowed.has(command.parameter)) {
        port.postMessage(reject('unsupported_action')); return;
      }
      const t = command.target;
      if (t?.view !== view) { port.postMessage(reject('wrong_view')); return; }
      const signature = JSON.stringify([t.document, t.epoch, t.revision, t.edit_generation, command.parameter]);
      const previous = receipts.get(id);
      if (previous) {
        port.postMessage(previous.signature === signature ? previous.reply : reject('operation_conflict'));
        return;
      }
      // Refuse new work at the limit; eviction could execute a retried ID again.
      if (receipts.size >= 256) { port.postMessage(reject('rebind_required')); return; }
      let reply = reject('stale_view');
      if (matchesTarget(t)) {
        let fresh;
        try { fresh = await readSource(); } catch { reply = reject('source_unavailable'); }
        if (binding?.port !== port) return;
        // No await between the final edit fence and the DOM mutation.
        if (matchesTarget(t) && matchesSource(fresh)) {
          paint(command.parameter);
          reply = {operation_id:id, status:'applied', target:target(), parameter:command.parameter};
        } else if (matchesTarget(t)) {
          paint(null);
        }
      }
      receipts.set(id, {signature, reply});
      port.postMessage(reply);
    }
    port.onmessage = ({data}) => {
      tail = tail.then(() => receive(data)).catch(() => {
        // After an unexpected failure the caller must treat an outstanding call as unknown.
        if (binding?.port === port) disconnect();
      });
    };
    return target();
  }

  return {
    connect, disconnect,
    beginEdit() {
      editing = true;
      generation++;
      paint(null);
      return generation;
    },
    acceptEdit(ticket, saved) {
      if (closed || !editing || ticket !== generation || saved?.document !== identity.document ||
          saved.epoch !== identity.epoch || !Number.isSafeInteger(saved.revision) || saved.revision <= revision) return false;
      revision = saved.revision;
      editing = false;
      return true;
    },
    close() { closed = true; disconnect(); },
  };
}
