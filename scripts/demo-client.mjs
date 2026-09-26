import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from './client.mjs';

// Always isolated: inherited production BOARD_GAMES_ROOT is deliberately overridden.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-games-demo-'));
const connection = await connect({ BOARD_GAMES_ROOT: root, BOARD_GAMES_READ_ONLY: '0', BOARD_GAMES_IMPORT_ROOT: '', BOARD_GAMES_PUBLIC_ORIGIN: 'http://127.0.0.1:3000' });
try {
  console.log('Tools:', (await connection.client.listTools()).tools.map(t => t.name));
  const patch = JSON.parse(fs.readFileSync(new URL('../examples/observatory.json', import.meta.url), 'utf8'));
  console.log('Validation:', await connection.call('validate_import', { patch }));
  const saved = await connection.call('save_draft', { patch, expectedDraftVersion: null });
  console.log('Draft:', saved);
  console.log('Before publishing:', await connection.call('export_links'));
  console.log('Publish:', await connection.call('publish_draft', { gameKey: patch.key, draftVersion: saved.draftVersion, expectedPublishedVersion: saved.basePublishedVersion }));
  console.log('After publishing:', await connection.call('export_links'));
  console.log('Temporary demo data:', root);
} finally { await connection.close(); }
