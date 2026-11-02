import {isRecord, isViewTarget, type Receipt, type SourceVersion, type ViewTarget} from './protocol.js';

interface ViewOptions<Field extends string> {
  source: SourceVersion;
  parameters: readonly Field[];
  readSource(): Promise<SourceVersion | null>;
  paint(parameter: Field | null): void;
}

// The application owns the document revision and the actual visual change.
// A port is attached only after the host and the user select this view.
export function parameterView<Field extends string>({source, parameters, readSource, paint}: ViewOptions<Field>) {
  const identity = {document: source.document, epoch: source.epoch};
  const allowed: ReadonlySet<string> = new Set(parameters);
  let revision = source.revision, generation = 0, editing = false, closed = false;
  let binding: {view: string; port: MessagePort} | null = null;

  function isAllowed(value: unknown): value is Field {
    return typeof value === 'string' && allowed.has(value);
  }
  function matchesSource(value: SourceVersion | null) {
    return value !== null && value.document === identity.document &&
      value.epoch === identity.epoch && value.revision === revision;
  }
  function stamp(view: string): ViewTarget {
    return {...identity, revision, view, edit_generation: generation};
  }
  function target(): ViewTarget | null {
    return binding && !editing && !closed ? stamp(binding.view) : null;
  }
  function matchesTarget(value: ViewTarget) {
    return !closed && !editing && value.view === binding?.view &&
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
  function connect(port: MessagePort): ViewTarget | null {
    if (binding || closed || editing) return null;
    const view = crypto.randomUUID();
    binding = {view, port};
    const receipts = new Map<string, {signature: string; reply: Receipt<Field>}>();
    let tail = Promise.resolve();
    const send = (reply: Receipt<Field>) => port.postMessage(reply);

    async function receive(command: unknown) {
      if (binding?.port !== port) return;
      if (!isRecord(command) || typeof command.operation_id !== 'string' ||
          !command.operation_id.length || command.operation_id.length > 128) {
        port.postMessage({status: 'rejected', reason: 'invalid_operation_id'});
        return;
      }
      const id = command.operation_id;
      const reject = (reason: string): Receipt<Field> => ({operation_id: id, status: 'rejected', reason});
      if (command.tool === 'observe_view') {
        return send({operation_id: id, status: 'observed', target: target()});
      }
      const parameter = command.parameter;
      if (command.tool !== 'highlight_parameter' || !isAllowed(parameter)) return send(reject('unsupported_action'));
      const t = command.target;
      if (!isRecord(t) || t.view !== view) return send(reject('wrong_view'));
      if (!isViewTarget(t)) return send(reject('stale_view'));
      const signature = JSON.stringify([t.document, t.epoch, t.revision, t.edit_generation, parameter]);
      const previous = receipts.get(id);
      if (previous) return send(previous.signature === signature ? previous.reply : reject('operation_conflict'));
      // Refuse new work at the limit; eviction could execute a retried ID again.
      if (receipts.size >= 256) return send(reject('rebind_required'));
      let reply = reject('stale_view');
      if (matchesTarget(t)) {
        let fresh: SourceVersion | null = null;
        try { fresh = await readSource(); } catch { reply = reject('source_unavailable'); }
        if (binding?.port !== port) return;
        // No await between the final edit fence and the DOM mutation.
        if (matchesTarget(t) && matchesSource(fresh)) {
          paint(parameter);
          reply = {operation_id: id, status: 'applied', target: stamp(view), parameter};
        } else if (matchesTarget(t)) {
          paint(null);
        }
      }
      receipts.set(id, {signature, reply});
      send(reply);
    }
    port.onmessage = ({data}: MessageEvent<unknown>) => {
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
    acceptEdit(ticket: number, saved: SourceVersion) {
      if (closed || !editing || ticket !== generation || saved.document !== identity.document ||
          saved.epoch !== identity.epoch || !Number.isSafeInteger(saved.revision) || saved.revision <= revision) return false;
      revision = saved.revision;
      editing = false;
      return true;
    },
    close() { closed = true; disconnect(); },
  };
}
