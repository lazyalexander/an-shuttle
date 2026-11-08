import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {runCodex} from './codex.js';
import type {MaterialTurn} from '@an-spool/cad-material-policy';
import {verificationTask} from '@an-spool/cad-material-policy';

export function codexMaterialTurn(folder:string):MaterialTurn {
  return async(scope,read,signal)=>{
    signal.throwIfAborted();
    const token=randomBytes(32).toString('hex');
    let checkPermission: (()=>Promise<void>) | undefined;
    const server=createServer(async(req,res)=>{
      if (req.url!=='/mcp' || req.headers.authorization!=='Bearer '+token || signal.aborted) {
        res.writeHead(403);res.end();return;
      }
      const mcp=new McpServer({name:'approved-cad-material',version:'1.0.0'});
      const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      res.on('close',()=>{void transport.close();void mcp.close();});
      try {
        mcp.registerTool('read_approved_material',{
          description:'Read the single approved historical material. Arguments must equal the permitted scope. Call once.',
          inputSchema:z.object({document:z.string(),part:z.string(),revision:z.number().int()}).strict(),
          annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
        },async args=>{
          if(!checkPermission)throw Error('Material task permission is unavailable');
          await checkPermission();
          const evidence=await read(args);
          await checkPermission();
          return {content:[{type:'text',text:JSON.stringify(evidence)}]};
        });
        let body='';
        for await (const chunk of req) {
          body+=chunk;
          if (Buffer.byteLength(body)>16_384) throw Error('MCP request too large');
        }
        await mcp.connect(transport);
        await transport.handleRequest(req,res,body ? JSON.parse(body) : undefined);
      } catch {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      }
    });
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const address=server.address();
    if (!address || typeof address==='string') throw Error('Missing material MCP address');
    const abort=()=>server.closeAllConnections();
    signal.addEventListener('abort',abort,{once:true});
    try {
      return await runCodex(folder,{...verificationTask(scope),
        onPermission:check=>{checkPermission=check;},
        mcp:{url:'http://127.0.0.1:'+address.port+'/mcp',token}},signal);
    } finally {
      signal.removeEventListener('abort',abort);server.closeAllConnections();
      await new Promise<void>(done=>server.close(()=>done()));
    }
  };
}
