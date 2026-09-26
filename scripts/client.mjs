import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

export async function connect(env = {}, launch = {}) {
  const transport = new StdioClientTransport({
    command: launch.command || process.execPath,
    args: launch.args || [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { ...process.env, ...env }, stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'board-games-protocol-client', version: '1.0.0' });
  try { await client.connect(transport); } catch (error) { await transport.close(); throw new Error(`${error.message}\n${stderr}`); }
  return {
    client, transport,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(result.content.map(c => c.text || '').join('\n'));
      return result.structuredContent || JSON.parse(result.content[0].text);
    },
    close: () => client.close(), stderr: () => stderr
  };
}
