import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Print a portable, machine-specific snippet; never change client config or data.
try {
  const { values } = parseArgs({ options: {
    root: { type: 'string' },
    origin: { type: 'string', default: 'http://127.0.0.1:3000' },
    imports: { type: 'string' },
    writable: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: node scripts/codex-config.mjs [--root DIR] [--origin URL] [--imports DIR] [--writable]');
    console.log('Prints local Codex TOML to stdout. Defaults to read-only and this repository\'s runtime directory.');
    console.log('Paths are resolved on this computer. Does not connect to a remote server or write files.');
  } else {
    const origin = new URL(values.origin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('--origin must be an http(s) origin without credentials, a subpath, query or fragment');
    }
    const repository = fileURLToPath(new URL('../', import.meta.url));
    const quote = value => JSON.stringify(value);
    const localPath = value => path.sep === '\\' ? path.resolve(value).replaceAll('\\', '/') : path.resolve(value);
    console.log([
      '# Merge this section into your Codex config; keep unrelated settings.',
      '# Local stdio server. Public origin only controls generated links.',
      '[mcp_servers.board_games_local]',
      `command = ${quote(localPath(process.execPath))}`,
      `args = [${quote(localPath(path.join(repository, 'src/server.mjs')))}]`,
      'startup_timeout_sec = 20',
      '',
      '[mcp_servers.board_games_local.env]',
      `BOARD_GAMES_ROOT = ${quote(localPath(values.root ?? path.join(repository, 'runtime')))}`,
      `BOARD_GAMES_PUBLIC_ORIGIN = ${quote(origin.origin)}`,
      `BOARD_GAMES_IMPORT_ROOT = ${quote(values.imports ? localPath(values.imports) : '')}`,
      `BOARD_GAMES_READ_ONLY = ${quote(values.writable ? '0' : '1')}`,
      '',
    ].join('\n'));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
