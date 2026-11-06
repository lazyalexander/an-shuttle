import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import type {MaterialEvidence} from './host.js';

export async function verifyMaterial(document:string, part:string, revision:number,
                                     read:()=>Promise<MaterialEvidence>, cancelled?:AbortSignal):Promise<MaterialEvidence> {
  const endpoint=new URL('/api/chat',process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434');
  if (endpoint.protocol!=='http:' || !['127.0.0.1','[::1]','localhost'].includes(endpoint.hostname))
    throw Error('Historical material lookup requires a loopback Ollama endpoint');
  const model=process.env.OLLAMA_MODEL ?? 'qwen3:8b';
  const name='read_approved_material';
  const scope={document,part,revision};
  const tool={type:'function',function:{name,description:'Read the one approved historical CAD material record.',
    parameters:{type:'object',properties:{document:{type:'string'},part:{type:'string'},revision:{type:'integer'}},
      required:Object.keys(scope),additionalProperties:false}}};
  const messages:object[]=[
    {role:'system',content:'Call read_approved_material exactly once with the specified scope. Then return a JSON object with adopt (boolean) and evidence_id (string). Use only the evidence ID supplied by the tool.'},
    {role:'user',content:JSON.stringify(scope)},
  ];
  type Message={role:string;content:string;tool_calls?:{function:{name:string;arguments:unknown}}[]};
  const deadline=AbortSignal.timeout(120_000);
  const signal=cancelled ? AbortSignal.any([deadline,cancelled]) : deadline;
  signal.throwIfAborted();
  const chat=async(tools:object[],format?:object):Promise<Message>=>{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal,
      body:JSON.stringify({model,messages,tools,format,think:false,stream:false,options:{temperature:0,num_ctx:4096,num_predict:384}})});
    if (!response.ok) throw Error('Local evidence model returned HTTP '+response.status);
    return (await response.json()).message;
  };

  const action=await chat([tool]);
  const calls=action.tool_calls;
  if (calls?.length!==1 || calls[0].function.name!==name || !isDeepStrictEqual(calls[0].function.arguments,scope))
    throw Error('Material lookup exceeded the approved scope');

  return adoptMaterial(scope,read,signal,async proof=>{
    messages.push(action,{role:'tool',tool_name:name,content:JSON.stringify(proof)});
    const result=await chat([],{type:'object',required:['adopt','evidence_id'],additionalProperties:false,
      properties:{adopt:{type:'boolean'},evidence_id:{type:'string'}}});
    if (result.tool_calls?.length) throw Error('Unexpected additional material tool call');
    return JSON.parse(result.content);
  });
}

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
