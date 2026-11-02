export interface SourceVersion {
  document: string;
  epoch: string;
  revision: number;
}

export interface ViewTarget extends SourceVersion {
  view: string;
  edit_generation: number;
}

export type Operation<Field extends string = string> =
  | {tool: 'observe_view'}
  | {tool: 'highlight_parameter'; target: ViewTarget; parameter: Field};

export type Command<Field extends string = string> = Operation<Field> & {operation_id: string};

export type Receipt<Field extends string = string> =
  | {operation_id: string; status: 'observed'; target: ViewTarget | null}
  | {operation_id: string; status: 'applied'; target: ViewTarget; parameter: Field}
  | {operation_id: string; status: 'rejected'; reason: string};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isSourceVersion(value: unknown): value is SourceVersion {
  return isRecord(value) && typeof value.document === 'string' &&
    typeof value.epoch === 'string' && isCounter(value.revision);
}

export function isViewTarget(value: unknown): value is ViewTarget {
  return isSourceVersion(value) && 'view' in value && typeof value.view === 'string' &&
    'edit_generation' in value && isCounter(value.edit_generation);
}

export function isReceipt(value: unknown): value is Receipt {
  if (!isRecord(value) || typeof value.operation_id !== 'string') return false;
  switch (value.status) {
    case 'observed': return value.target === null || isViewTarget(value.target);
    case 'applied': return isViewTarget(value.target) && typeof value.parameter === 'string';
    case 'rejected': return typeof value.reason === 'string';
    default: return false;
  }
}
