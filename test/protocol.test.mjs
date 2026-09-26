import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { connect } from '../scripts/client.mjs';
import player from '../player/app.js';
import catalog from '../player/lib/catalog.js';

const fixture = name => JSON.parse(fs.readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
function snapshot(root) {
  const result = {};
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else result[path.relative(root, file)] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  walk(root);
  return result;
}
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-games-test-'));
  const imports = fs.mkdtempSync(path.join(os.tmpdir(), 'board-games-import-'));
  const env = { BOARD_GAMES_ROOT: root, BOARD_GAMES_IMPORT_ROOT: imports, BOARD_GAMES_READ_ONLY: '0', BOARD_GAMES_PUBLIC_ORIGIN: 'https://games.example.org' };
  let connection = await connect(env);
  const http = player.createApp({ root }).listen(0, '127.0.0.1');
  await once(http, 'listening');
  const origin = `http://127.0.0.1:${http.address().port}`;
  t.after(async () => {
    await connection.close();
    await new Promise(resolve => http.close(resolve));
    for (const directory of [root, imports]) fs.rmSync(directory, { recursive: true, force: true });
  });
  return { root, imports, env, get connection() { return connection; },
    call: (...args) => connection.call(...args),
    get: url => fetch(origin + (url.startsWith('http') ? new URL(url).pathname : url)),
    async restart() { await connection.close(); connection = await connect(env); },
    async publish(patch) {
      const current = (await connection.call('list_games')).games.find(g => g.gameKey === patch.key);
      const saved = await connection.call('save_draft', { patch, expectedDraftVersion: current?.latestDraftVersion || null });
      return connection.call('publish_draft', { gameKey: patch.key, draftVersion: saved.draftVersion, expectedPublishedVersion: saved.basePublishedVersion });
    }
  };
}

test('official SDK stdio workflow: draft isolation, explicit release and stable NFC', async t => {
  const f = await setup(t), patch = fixture('observatory');
  const { tools } = await f.connection.client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['list_games', 'get_game', 'validate_import', 'save_draft', 'preview_clue', 'publish_draft', 'import_asset', 'export_links'].sort());
  assert.equal(tools.find(t => t.name === 'publish_draft').annotations.destructiveHint, true);
  const before = snapshot(f.root);
  const validated = await f.call('validate_import', { patch });
  assert.equal(validated.clues, 4);
  assert.deepEqual(snapshot(f.root), before);
  const saved = await f.call('save_draft', { patch, expectedDraftVersion: null });
  assert.equal((await f.call('export_links')).count, 0);
  assert.equal((await f.get('/g/observatory/p/missing-star/clues/first')).status, 404);
  const registry = JSON.parse(fs.readFileSync(path.join(f.root, 'state/catalog.json')));
  assert.equal(registry.games.length, 0);
  assert.equal(registry.entries.length, 0);
  const preview = await f.call('preview_clue', { gameKey: patch.key, draftVersion: saved.draftVersion, puzzleKey: 'missing-star', clueKey: 'first' });
  assert.equal(preview.page.clue.text, patch.puzzles[0].clues[0].text);
  for (const secret of [patch.puzzles[0].hostNotes, patch.puzzles[0].clues[1].text, patch.puzzles[1].surface]) assert.ok(!JSON.stringify(preview).includes(secret));
  const first = await f.call('publish_draft', { gameKey: patch.key, draftVersion: saved.draftVersion, expectedPublishedVersion: null });
  const links = (await f.call('export_links')).links;
  assert.equal(links.length, 4);
  const firstFiles = snapshot(f.root);
  assert.equal((await f.call('publish_draft', { gameKey: patch.key, draftVersion: saved.draftVersion, expectedPublishedVersion: null })).alreadyPublished, true);
  assert.deepEqual(snapshot(f.root), firstFiles);
  for (const link of links) {
    assert.equal((await f.get(link.directUrl)).status, 200);
    assert.equal((await f.get(link.nfcUrl)).status, 200);
  }
  const update = await f.call('save_draft', { expectedDraftVersion: saved.draftVersion, patch: {
    key: patch.key, puzzles: [{ key: 'missing-star', clues: [{ key: 'first', text: '仅更新这一条。' }, { key: 'third', scene: '露台', text: '新增的第三条。' }] }]
  } });
  assert.equal(update.clues, 5);
  assert.equal((await f.get('/g/observatory/p/missing-star/clues/third')).status, 404);
  assert.ok((await (await f.get(links[0].directUrl)).text()).includes(patch.puzzles[0].clues[0].text));
  await assert.rejects(f.call('publish_draft', { gameKey: patch.key, draftVersion: saved.draftVersion, expectedPublishedVersion: first.publishedVersion }), /CONFLICT/);
  await f.call('publish_draft', { gameKey: patch.key, draftVersion: update.draftVersion, expectedPublishedVersion: first.publishedVersion });
  const updated = (await f.call('export_links')).links;
  assert.equal(updated.length, 5);
  for (const old of links) assert.deepEqual(updated.find(n => n.directUrl === old.directUrl), old);
  assert.ok((await (await f.get(links[0].nfcUrl)).text()).includes('仅更新这一条。'));
  const files = snapshot(f.root);
  await f.restart();
  assert.deepEqual((await f.call('export_links')).links, updated);
  assert.deepEqual(snapshot(f.root), files);
});

test('public HTML/API/static paths never expose sibling clues, host notes or drafts', async t => {
  const f = await setup(t), patch = fixture('observatory');
  patch.puzzles[0].clues[0].text = '<script>window.leaked=true</script> & current';
  await f.publish(patch);
  const link = (await f.call('export_links')).links[0];
  for (const route of [link.directUrl, link.nfcUrl, '/api/games/observatory/puzzles/missing-star/clues/first', '/api/entries/' + link.nfcUrl.split('/').at(-1)]) {
    const response = await f.get(route);
    assert.equal(response.status, 200);
    const text = await response.text();
    for (const secret of [patch.puzzles[0].hostNotes, patch.puzzles[0].clues[1].text, patch.puzzles[1].surface]) assert.ok(!text.includes(secret));
    if (!route.startsWith('/api')) {
      assert.ok(!text.includes('<script>window.leaked'));
      assert.ok(text.includes('&lt;script&gt;'));
    }
  }
  const info = await f.call('get_game', { gameKey: patch.key });
  assert.ok(!JSON.stringify(info).includes(patch.puzzles[0].hostNotes));
  assert.ok(JSON.stringify(await f.call('get_game', { gameKey: patch.key, includeHostNotes: true })).includes(patch.puzzles[0].hostNotes));
  for (const route of ['/state/catalog.json', '/data/host-only', '/storage/assets', '/src/server.mjs', '/index.html', '/n/aaaaaaaaaaaaaaaaaaaaaa', '/test']) assert.equal((await f.get(route)).status, 404, route);
  for (const route of ['/', '/api/games', '/api/index', '/media/index.json', '/g/observatory']) {
    const text = await (await f.get(route)).text();
    for (const secret of [patch.puzzles[0].hostNotes, ...patch.puzzles.flatMap(p => p.clues.map(c => c.text))]) assert.ok(!text.includes(secret), route);
  }
});

test('invalid imports and failed version checks leave no partial state or NFC', async t => {
  const f = await setup(t), patch = fixture('observatory');
  const cases = [
    { ...patch, key: '../escape' },
    { key: 'new-game', puzzles: patch.puzzles },
    { ...patch, puzzles: [patch.puzzles[0], patch.puzzles[0]] },
    { ...patch, puzzles: [{ ...patch.puzzles[0], clues: [patch.puzzles[0].clues[0], patch.puzzles[0].clues[0]] }] },
    { ...patch, puzzles: [{ key: 'missing', title: 'Incomplete', clues: [{ key: 'first', text: 'x' }] }] },
    { ...patch, puzzles: [{ ...patch.puzzles[0], clues: [{ key: 'first' }] }] },
    { ...patch, puzzles: [{ ...patch.puzzles[0], clues: [{ key: 'first', text: 'x', audioAssetId: randomUUID() }] }] },
    { ...patch, published: true }
  ];
  for (const invalid of cases) {
    const before = snapshot(f.root);
    await assert.rejects(f.call('validate_import', { patch: invalid }));
    await assert.rejects(f.call('save_draft', { patch: invalid, expectedDraftVersion: null }));
    assert.deepEqual(snapshot(f.root), before);
  }
  const saved = await f.call('save_draft', { patch, expectedDraftVersion: null });
  const before = snapshot(f.root);
  await assert.rejects(f.call('save_draft', { patch: { key: patch.key, title: 'stale' }, expectedDraftVersion: null }), /CONFLICT/);
  await assert.rejects(f.call('publish_draft', { gameKey: patch.key, draftVersion: saved.draftVersion, expectedPublishedVersion: 'a'.repeat(64) }), /CONFLICT/);
  assert.deepEqual(snapshot(f.root), before);
});

test('same puzzle/clue keys across games remain isolated', async t => {
  const f = await setup(t);
  await f.publish(fixture('observatory'));
  await f.publish(fixture('harbor'));
  const links = (await f.call('export_links')).links;
  assert.equal(links.length, 8);
  assert.equal(new Set(links.map(l => l.nfcUrl)).size, 8);
  assert.equal(new Set(links.map(l => l.clueId)).size, 8);
  const a = links.find(l => l.gameKey === 'observatory'), b = links.find(l => l.gameKey === 'harbor');
  assert.notEqual(a.puzzleId, b.puzzleId);
  const page = await (await f.get(b.nfcUrl)).text();
  assert.ok(page.includes(fixture('harbor').puzzles[0].surface));
  assert.ok(!page.includes(fixture('observatory').puzzles[0].surface));
});

test('withdraw and republish one clue preserves IDs and sibling visibility', async t => {
  const f = await setup(t), patch = fixture('observatory');
  await f.publish(patch);
  const links = (await f.call('export_links')).links;
  await f.publish({ key: patch.key, puzzles: [{ key: 'missing-star', clues: [{ key: 'first', enabled: false }] }] });
  assert.equal((await f.call('export_links')).count, 3);
  assert.equal((await f.get(links[0].nfcUrl)).status, 404);
  assert.equal((await f.get(links[1].nfcUrl)).status, 200);
  await f.publish({ key: patch.key, puzzles: [{ key: 'missing-star', clues: [{ key: 'first', enabled: true }] }] });
  assert.deepEqual((await f.call('export_links')).links, links);
});

test('controlled audio import, missing/cross-game references and public gating', async t => {
  const f = await setup(t), patch = fixture('observatory');
  let saved = await f.call('save_draft', { patch, expectedDraftVersion: null });
  // Small valid mono PCM WAV, generated solely for this test.
  const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  fs.writeFileSync(path.join(f.imports, 'tone.wav'), wav);
  fs.writeFileSync(path.join(f.imports, 'bad.txt'), 'not audio');
  for (const relativePath of ['../tone.wav', path.join(f.imports, 'tone.wav'), 'missing.wav', 'bad.txt']) {
    const before = snapshot(f.root);
    await assert.rejects(f.call('import_asset', { gameKey: patch.key, relativePath }));
    assert.deepEqual(snapshot(f.root), before);
  }
  // Directory junctions work without symlink privilege on Windows.
  fs.symlinkSync(f.root, path.join(f.imports, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.call('import_asset', { gameKey: patch.key, relativePath: 'outside/state/catalog.json' }), /outside/);
  const asset = await f.call('import_asset', { gameKey: patch.key, relativePath: 'tone.wav' });
  const beforeReuse = snapshot(f.root);
  assert.equal((await f.call('import_asset', { gameKey: patch.key, relativePath: 'tone.wav' })).assetId, asset.assetId);
  assert.deepEqual(snapshot(f.root), beforeReuse);
  const audioPath = `/assets/${saved.gameId}/${asset.assetId}`;
  assert.equal((await f.get(audioPath)).status, 404);
  saved = await f.call('save_draft', { expectedDraftVersion: saved.draftVersion, patch: { key: patch.key, puzzles: [{ key: 'missing-star', clues: [{ key: 'first', audioAssetId: asset.assetId }] }] } });
  const other = fixture('harbor'); other.puzzles[0].clues[0].audioAssetId = asset.assetId;
  const before = snapshot(f.root);
  await assert.rejects(f.call('save_draft', { patch: other, expectedDraftVersion: null }), /cross-game/);
  assert.deepEqual(snapshot(f.root), before);
  const assetFile = path.join(f.root, 'storage/assets', saved.gameId, asset.assetId + '.wav');
  fs.renameSync(assetFile, assetFile + '.hidden');
  const absent = snapshot(f.root);
  await assert.rejects(f.call('publish_draft', { gameKey: patch.key, draftVersion: saved.draftVersion, expectedPublishedVersion: null }), /Missing audio/);
  assert.deepEqual(snapshot(f.root), absent);
  fs.renameSync(assetFile + '.hidden', assetFile);
  await f.call('publish_draft', { gameKey: patch.key, draftVersion: saved.draftVersion, expectedPublishedVersion: null });
  const audio = await f.get(audioPath);
  assert.equal(audio.status, 200); assert.equal(audio.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wav);
  await f.publish({ key: patch.key, puzzles: [{ key: 'missing-star', clues: [{ key: 'first', audioAssetId: null }] }] });
  assert.equal((await f.get(audioPath)).status, 404);
});

test('competing clients cannot overwrite drafts or publish stale content', async t => {
  const f = await setup(t), patch = fixture('observatory');
  await f.publish(patch);
  const original = await f.call('get_game', { gameKey: patch.key });
  const second = await connect(f.env); t.after(() => second.close());
  const results = await Promise.allSettled([f.call('save_draft', { patch: { key: patch.key, title: 'writer-a' }, expectedDraftVersion: original.latestDraftVersion }), second.call('save_draft', { patch: { key: patch.key, title: 'writer-b' }, expectedDraftVersion: original.latestDraftVersion })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const draft = results.find(r => r.status === 'fulfilled').value;
  const store = catalog.createStore(path.join(f.root, 'state/catalog.json'));
  store.transaction(data => { data.games[0].title = 'external update'; });
  const before = snapshot(f.root);
  await assert.rejects(f.call('publish_draft', { gameKey: patch.key, draftVersion: draft.draftVersion, expectedPublishedVersion: original.publishedVersion }), /CONFLICT/);
  const now = await f.call('get_game', { gameKey: patch.key });
  await assert.rejects(f.call('publish_draft', { gameKey: patch.key, draftVersion: draft.draftVersion, expectedPublishedVersion: now.publishedVersion }), /CONFLICT/);
  assert.deepEqual(snapshot(f.root), before);
  const rebased = await f.call('save_draft', { patch: { key: patch.key, description: 'explicitly reconciled' }, expectedDraftVersion: draft.draftVersion, fromPublishedVersion: now.publishedVersion });
  const newDraft = await f.call('get_game', { gameKey: patch.key, view: 'draft' });
  assert.equal(newDraft.manifest.title, 'external update');
  await f.call('publish_draft', { gameKey: patch.key, draftVersion: rebased.draftVersion, expectedPublishedVersion: now.publishedVersion });
});

test('read-only MCP connects without writes and blocks all management mutations', async t => {
  const f = await setup(t);
  await f.publish(fixture('observatory'));
  const before = snapshot(f.root), info = await f.call('get_game', { gameKey: 'observatory' });
  const readOnly = await connect({ ...f.env, BOARD_GAMES_READ_ONLY: '1' }); t.after(() => readOnly.close());
  assert.equal((await readOnly.call('list_games')).readOnly, true);
  assert.equal((await readOnly.call('export_links')).count, 4);
  for (const [name, args] of [
    ['save_draft', { patch: fixture('harbor'), expectedDraftVersion: null }],
    ['publish_draft', { gameKey: 'observatory', draftVersion: info.latestDraftVersion, expectedPublishedVersion: info.publishedVersion }],
    ['import_asset', { gameKey: 'observatory', relativePath: 'none.wav' }]
  ]) await assert.rejects(readOnly.call(name, args), /READ_ONLY/);
  assert.deepEqual(snapshot(f.root), before);
});

test('legacy audio chapter player and NFC exports remain compatible', async t => {
  const f = await setup(t);
  const media = path.join(f.root, 'media'); fs.mkdirSync(media, { recursive: true });
  const tracks = ['1.1', '1.2', '2.1'].map(id => ({ id, title: `Demo ${id}`, audio: `/media/audio/${id}.mp3` }));
  fs.writeFileSync(path.join(media, 'index.json'), JSON.stringify(tracks));
  catalog.createStore(path.join(f.root, 'state/catalog.json'), path.join(media, 'index.json')).syncLegacy();
  const before = (await f.call('export_links')).links;
  assert.equal(before.length, 3);
  assert.equal((await f.get('/1.1')).status, 200);
  assert.equal((await f.get(before[1].nfcUrl)).status, 200);
  const page = await (await f.get('/api/games/legacy/chapters/1.2')).json();
  assert.deepEqual(page.tracks.map(t => t.id), ['1.1', '1.2']);
  await f.publish(fixture('observatory'));
  assert.deepEqual((await f.call('export_links', { gameKey: 'legacy' })).links, before);
  await assert.rejects(f.call('save_draft', { patch: { key: 'legacy', title: 'oops' }, expectedDraftVersion: null }), /TYPE/);
});
