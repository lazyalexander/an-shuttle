import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import type {MaterialEvidence} from './host.js';

type Scope={document:string;part:string;revision:number};
type Proof=Scope & {evidence_id:string;artifact_revision:string;material:MaterialEvidence['material']};
type Ask=(stage:'request'|'adopt', data:object, signal:AbortSignal)=>Promise<unknown>;

export async function verifyMaterialWithHost(scope:Scope, read:()=>Promise<MaterialEvidence>,
                                             signal:AbortSignal, ask:Ask) {
  signal.throwIfAborted();
  const action=await ask('request',{intent:'Reuse the last approved material',permitted:scope},signal);
  if (!isDeepStrictEqual(action,{action:'read_approved_material',...scope}))
    throw Error('Host material lookup was declined or exceeded the approved scope');
  return adoptMaterial(scope,read,signal,proof=>ask('adopt',proof,signal));
}

async function adoptMaterial(scope:Scope, read:()=>Promise<MaterialEvidence>,
                             signal:AbortSignal, decide:(proof:Proof)=>Promise<unknown>) {
  signal.throwIfAborted();
  const evidence=await read();
  signal.throwIfAborted();
  if (evidence.source.document!==scope.document || evidence.part!==scope.part || evidence.source.revision!==scope.revision)
    throw Error('Material evidence does not match the approved scope');

  // The source remains in this invocation. An ID from another save cannot resolve here.
  const evidenceId=randomUUID();
  const proof={...scope,evidence_id:evidenceId,artifact_revision:evidence.artifact.revision,material:evidence.material};
  const decision=await decide(proof);
  signal.throwIfAborted();
  if (!isDeepStrictEqual(decision,{adopt:true,evidence_id:evidenceId}))
    throw Error('The model did not adopt the evidence issued for this lookup');
  return evidence;
}
