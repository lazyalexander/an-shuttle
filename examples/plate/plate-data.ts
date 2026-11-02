import {isRecord, isSourceVersion, type SourceVersion} from '@an-shuttle/view/protocol.js';

export const parameters = ['bore', 'thickness'] as const;
export type Parameter = typeof parameters[number];
export type Dimensions = Record<Parameter, number>;
export type Plate = SourceVersion & Dimensions;
export type Finding = SourceVersion & {parameter: Parameter | null};

export function hasDimensions(value: unknown): value is Dimensions {
  if (!isRecord(value)) return false;
  return parameters.every(key => {
    const n = value[key];
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 30;
  });
}

export async function readPlate(response: Response): Promise<Plate> {
  if (!response.ok) throw Error(await response.text() || 'Saved plate unavailable');
  const value: unknown = await response.json();
  if (!isSourceVersion(value) || !hasDimensions(value)) throw Error('Invalid saved plate');
  return value;
}

export async function readFinding(response: Response): Promise<Finding> {
  if (!response.ok) throw Error('Check unavailable');
  const value: unknown = await response.json();
  if (!isSourceVersion(value) || !('parameter' in value)) throw Error('Invalid saved check');
  const parameter = value.parameter;
  if (parameter !== null && parameter !== 'bore' && parameter !== 'thickness') throw Error('Unknown check parameter');
  return {...value, parameter};
}
