// Domain policy. The caller supplies the model transport; the agent sees no live CAD handle.
interface PartBrief {label:string}
interface Finish {finish:string; color:string}
interface Surface extends Finish {metallic:number; roughness:number}
export interface MaterialBrief {
  description:string;
  direction:string;
  supplied:Partial<Record<string,Finish>>;
  missing:Record<string,PartBrief>;
}
export type Propose = (brief: MaterialBrief) => Promise<unknown>;

export const materialSchema = {
  type:'object', additionalProperties:false, required:['finish','color','metallic','roughness'],
  properties:{finish:{type:'string'},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},
    metallic:{type:'number',minimum:0,maximum:1},roughness:{type:'number',minimum:0,maximum:1}},
};
export function instructions(brief:MaterialBrief) {
  return 'Design physically plausible materials for the missing CAD parts. Respect supplied finishes and the operator direction. Return just the requested parts.\n'+JSON.stringify(brief);
}
function record(value:unknown):value is Record<string,unknown> {
  return value!==null && typeof value==='object' && !Array.isArray(value);
}
function unit(value:unknown):value is number {
  return typeof value==='number' && Number.isFinite(value) && value>=0 && value<=1;
}
function material(part:string,value:unknown):Surface {
  if (!record(value) || typeof value.finish!=='string' || !value.finish.trim() || value.finish.length>80 ||
      typeof value.color!=='string' || !/^#[0-9a-f]{6}$/i.test(value.color) || !unit(value.metallic) || !unit(value.roughness))
    throw Error('Invalid generated material for '+part);
  return {finish:value.finish,color:value.color,metallic:value.metallic,roughness:value.roughness};
}
// Emit only literals and fixed control flow. Model responses never supply executable source.
export async function planKit(brief:MaterialBrief, propose:Propose):Promise<string|null> {
  const missing=Object.keys(brief.missing);
  if (!missing.length) return null;
  const choices=await propose(brief);
  if (!record(choices) || Object.keys(choices).some(part=>!Object.hasOwn(brief.missing,part)))
    throw Error('Unexpected material proposal');
  const lines=['def missing_material(part):'];
  for (const part of missing) {
    const surface=material(part,choices[part]);
    lines.push('    if part == '+JSON.stringify(part)+':','        return '+JSON.stringify(surface));
  }
  lines.push('    raise ValueError("No proposed material for " + part)','');
  return lines.join('\n');
}
