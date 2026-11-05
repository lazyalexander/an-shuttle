import {isDeepStrictEqual} from 'node:util';
import {materialSchema} from '@an-loom/cad-paint-spool/agent';
import type {MaterialEvidence} from './host.js';

export async function verifyMaterial(document:string, part:string, revision:number,
                                     read:()=>Promise<MaterialEvidence>):Promise<MaterialEvidence> {
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
    {role:'system',content:'Call read_approved_material exactly once with the specified scope. Then return the tool JSON exactly, without Markdown.'},
    {role:'user',content:JSON.stringify(scope)},
  ];
  type Message={role:string;content:string;tool_calls?:{function:{name:string;arguments:unknown}}[]};
  const signal=AbortSignal.timeout(120_000);
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

  const evidence=await read();
  const proof={...scope,artifact_revision:evidence.artifact.revision,material:evidence.material};
  messages.push(action,{role:'tool',tool_name:name,content:JSON.stringify(proof)});
  const result=await chat([],{type:'object',required:Object.keys(proof),additionalProperties:false,
    properties:{...tool.function.parameters.properties,artifact_revision:{type:'string'},material:materialSchema}});
  if (result.tool_calls?.length || !isDeepStrictEqual(JSON.parse(result.content),proof))
    throw Error('The model did not verify the accepted material evidence');
  return evidence;
}
