// Step 3: Local WebSocket Bridge (ws://127.0.0.1:11436) for Browser Extension & Web AI Chats
import http from 'node:http';
import { CortexMcpServer } from '../mcp/cortex-mcp-server.js';

export function startBrowserBridgeServer(port = 11436, repoRoot = process.cwd()) {
  const mcp = new CortexMcpServer(repoRoot);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/sync') {
      const packet = await mcp.pullDeltaSync('web_chat');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(packet));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[CortexOS Bridge] Listening on http://127.0.0.1:${port}`);
  });

  return server;
}
