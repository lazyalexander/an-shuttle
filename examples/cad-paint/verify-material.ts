import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import type {MaterialEvidence} from './host.js';

export type MaterialScope={document:string;part:string;revision:number};
export type MaterialProof=MaterialScope & {evidence_id:string;artifact_revision:string;material:MaterialEvidence['material']};
export type MaterialTurn=(scope:MaterialScope,read:(args:unknown)=>Promise<MaterialProof>,signal:AbortSignal)=>Promise<unknown>;

// The harness owns planning and tool use. The application owns authority and adoption.
export async function verifyMaterial(scope:MaterialScope,read:()=>Promise<MaterialEvidence>,
                                     signal:AbortSignal,turn:MaterialTurn) {
  signal.throwIfAborted();
  scope=Object.freeze({...scope});
  let called=false,failed=false,issued:MaterialEvidence|undefined;
  const evidenceId=randomUUID();
  const decision=await turn(scope,async args=>{
    signal.throwIfAborted();
    if (failed || called || !isDeepStrictEqual(args,scope)) {
      failed=true;
      throw Error('Material lookup exceeded the approved scope or repeated a read');
    }
    called=true;
    const evidence=await read().catch(error=>{failed=true;throw error;});
    signal.throwIfAborted();
    if (evidence.source.document!==scope.document || evidence.part!==scope.part || evidence.source.revision!==scope.revision) {
      failed=true;
      throw Error('Material evidence does not match the approved scope');
    }
    issued=evidence;
    return {...scope,evidence_id:evidenceId,artifact_revision:evidence.artifact.revision,material:evidence.material};
  },signal);
  signal.throwIfAborted();
  if (failed || !issued || !isDeepStrictEqual(decision,{adopt:true,evidence_id:evidenceId}))
    throw Error('The harness did not adopt the evidence issued for this lookup');
  return issued;
}
