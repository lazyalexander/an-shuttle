// Test-only Responses peer. The real Codex binary still performs MCP discovery,
// tool dispatch and completion. This fixture is not evidence of model quality.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function codexFixture(folder:string,realBinary:string,mode:'adopt'|'outside-scope'='adopt') {
  let calls=0,reads=0,adoptions=0;
  const tools=new Set<string>();
  const server=createServer(async(req,res)=>{
    try {
      if (req.headers.authorization) throw Error('The protocol fixture must not receive credentials');
      if (req.method==='GET' && req.url?.startsWith('/v1/models?')) {
        const model={slug:'gpt-6-sol',display_name:'Fixture',description:'Protocol test only',
          supported_reasoning_levels:[],shell_type:'disabled',visibility:'list',supported_in_api:true,
          priority:0,upgrade:null,support_verbosity:false,default_verbosity:null,apply_patch_tool_type:null,
          truncation_policy:{mode:'bytes',limit:10000},experimental_supported_tools:[],context_window:32000,
          base_instructions:'Use the approved material tool.',tool_mode:'direct',multi_agent_version:'disabled'};
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({models:[model]}));return;
      }
      if (req.method!=='POST' || req.url!=='/v1/responses') throw Error('Unexpected protocol fixture route');
      let body='';for await (const chunk of req) body+=chunk;
      const data=JSON.parse(body);calls++;

      const collect=(values:any[],namespace?:string):void=>{for(const tool of values ?? []) {
        if(tool.tools) collect(tool.tools,tool.name);
        else if(tool.name) tools.add(namespace ? namespace+'.'+tool.name : tool.name);
      }};
      collect(data.tools);
      for (const entry of data.input ?? []) if (entry.tools) collect(entry.tools);
      const output=data.input.findLast((item:any)=>item.type==='function_call_output');
      const id='fixture-'+calls;
      let item:object;
      if (output) {
        const evidence=(value:any):string|undefined=>{
          if (typeof value==='string') {try{return evidence(JSON.parse(value));}catch{return undefined;}}
          if (!value || typeof value!=='object') return undefined;
          if (typeof value.evidence_id==='string') return value.evidence_id;
          for (const entry of Object.values(value)) {const found=evidence(entry);if(found) return found;}
        };
        const proof=evidence(output);
        if (mode==='outside-scope') {
          item={type:'message',role:'assistant',id:'decline-'+calls,
            content:[{type:'output_text',text:JSON.stringify({adopt:false,evidence_id:''})}]};
        } else {
          if (!proof) throw Error('Missing current evidence in Codex tool output');
          adoptions++;
          item={type:'message',role:'assistant',id:'adoption-'+calls,
            content:[{type:'output_text',text:JSON.stringify({adopt:true,evidence_id:proof})}]};
        }
      } else {
        // Parse the final user prompt, which carries the bounded scope as data.
        const text=data.input.flatMap((entry:any)=>entry.role==='user' ? entry.content.map((v:any)=>v.text ?? '') : []).join('');
        const match=text.match(/permitted scope is (\{[^}]+\})/);
        if (!match) throw Error('Missing permitted scope');
        const name=[...tools].find(name=>name.includes('read_approved_material'));
        if (!name) throw Error('Codex did not discover the approved MCP tool: '+[...tools].join(','));
        reads++;
        const scope=JSON.parse(match[1]);
        if (mode==='outside-scope') scope.revision++;
        const pieces=name.split('.');
        item={type:'function_call',call_id:'material-'+calls,name:pieces.at(-1),
          ...(pieces.length>1 ? {namespace:pieces[0]} : {}),arguments:JSON.stringify(scope)};
      }
      res.writeHead(200,{'content-type':'text/event-stream'});
      for (const event of [{type:'response.created',response:{id}},
        {type:'response.output_item.done',item},
        {type:'response.completed',response:{id,usage:{input_tokens:10,output_tokens:5,total_tokens:15}}}])
        res.write('data: '+JSON.stringify(event)+'\n\n');
      res.end();
    } catch(error) {console.error('Codex fixture request failed',req.url,String(error));res.writeHead(500);res.end(String(error));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if (!address || typeof address==='string') throw Error('No fixture address');
  const binary=join(folder,'codex-fixture');
  // Paths are operator/test inputs. Quote shell words rather than interpolating JSON.
  const quote=(value:string)=>"'"+value.replaceAll("'", "'\"'\"'")+"'";
  const provider='{name="fixture",base_url="http://127.0.0.1:'+address.port+'/v1",wire_api="responses",requires_openai_auth=false,request_max_retries=0,stream_max_retries=0}';
  await writeFile(binary,'#!/bin/sh\nexec '+quote(realBinary)+' -c '+quote('model_provider="material_fixture"')+
    ' -c '+quote('model_providers.material_fixture='+provider)+' -c '+quote('model="gpt-6-sol"')+' "$@"\n',{mode:0o700});
  return {binary,tools,get reads(){return reads;},get adoptions(){return adoptions;},
    close:()=>{server.closeAllConnections();return new Promise<void>(done=>server.close(()=>done()));}};
}
