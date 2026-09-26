import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import catalog from '../player/lib/catalog.js';
import puzzles from '../player/lib/puzzles.js';
import branding from '../player/lib/branding.js';
import render from '../player/lib/render.js';
import { patch as patchSchema } from './schemas.mjs';

const audioTypes = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac' };
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export class DomainError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new DomainError(code, message); };
const requireValue = (value, message) => { if (!value) fail('VALIDATION', message); };
function unique(items, label) {
  const seen = new Set();
  for (const item of items || []) {
    requireValue(!seen.has(item.key), `Duplicate ${label} key: ${item.key}`);
    seen.add(item.key);
  }
}
function mergeChildren(previous = [], incoming = [], nested) {
  const result = clone(previous);
  for (const item of incoming) {
    const index = result.findIndex(p => p.key === item.key);
    const old = index < 0 ? { enabled: true } : result[index];
    const next = { ...old, ...item };
    if (nested) next[nested] = mergeChildren(old[nested], item[nested]);
    if (index < 0) result.push(next); else result[index] = next;
  }
  return result;
}
const summary = manifest => ({ puzzles: manifest.puzzles.length, clues: manifest.puzzles.reduce((n, p) => n + p.clues.length, 0) });
function redact(manifest, includeHostNotes) {
  const result = clone(manifest);
  if (!includeHostNotes) for (const puzzle of result.puzzles || []) delete puzzle.hostNotes;
  return result;
}

export class Manager {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.BOARD_GAMES_ROOT || fileURLToPath(new URL('../runtime', import.meta.url)));
    this.filename = path.join(this.root, 'state', 'catalog.json');
    this.store = catalog.createStore(this.filename);
    this.readOnly = options.readOnly ?? process.env.BOARD_GAMES_READ_ONLY === '1';
    this.importRoot = options.importRoot || process.env.BOARD_GAMES_IMPORT_ROOT;
    const origin = new URL(options.publicOrigin || process.env.BOARD_GAMES_PUBLIC_ORIGIN || 'http://127.0.0.1:3000');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) fail('CONFIG', 'Public origin must be an http(s) origin without credentials, path, query or fragment');
    this.origin = origin.origin;
  }
  read() { return fs.existsSync(this.filename) ? this.store.read() : { version: 1, games: [], entries: [] }; }
  game(data, key) { return data.games.find(g => g.key === key); }
  record(data, key) { return data.management?.games.find(g => g.key === key); }
  publishedVersion(game) {
    if (!game) return null;
    // Unreferenced asset registration does not change the player content version.
    const { assets, ...content } = game;
    return hash(content);
  }
  draftFile(key, version) { return path.join(this.root, 'data', 'drafts', key, `${version}.json`); }
  draft(data, key) {
    const record = this.record(data, key);
    return record?.latestVersion ? readJSON(this.draftFile(key, record.latestVersion)) : null;
  }
  publishedManifest(game) {
    if (game.type !== 'puzzle_clue') return clone(game);
    const base = path.join(this.root, 'data', 'games', game.id, 'revisions', game.revision);
    const manifest = { key: game.key, type: 'puzzle_clue', title: game.title, description: game.description || '', listed: game.listed === true, enabled: game.published === true, puzzles: [] };
    if (game.theme) manifest.theme = game.theme;
    for (const field of ['displayName', 'tagline']) if (game[field] && game[`${field}Generated`] !== true) manifest[field] = game[field];
    for (const puzzle of game.puzzles) {
      const content = readJSON(path.join(base, 'puzzles', puzzle.id, 'puzzle.json'));
      const item = { key: puzzle.key, title: content.title, surface: content.surface, enabled: puzzle.published === true, clues: [] };
      const notesFile = path.join(this.root, 'data', 'host-only', game.id, puzzle.id, `${puzzle.hostNotesRevision || game.revision}.json`);
      if (fs.existsSync(notesFile)) item.hostNotes = readJSON(notesFile).notes;
      for (const clue of puzzle.clues) {
        const text = readJSON(path.join(base, 'puzzles', puzzle.id, 'clues', `${clue.id}.json`));
        item.clues.push({ key: clue.key, text: text.text, scene: text.scene || '', enabled: clue.published === true, audioAssetId: clue.audioAssetId || null });
      }
      manifest.puzzles.push(item);
    }
    return manifest;
  }
  assets(data, key) {
    const all = [...(this.game(data, key)?.assets || []), ...(this.record(data, key)?.assets || [])];
    return all.filter((a, i) => all.findIndex(b => a.id === b.id) === i);
  }
  validateManifest(data, manifest) {
    patchSchema.parse(manifest);
    requireValue(manifest.key !== 'legacy', 'The legacy game is read-only');
    requireValue(manifest.title?.trim(), 'A new game requires title');
    requireValue(manifest.puzzles?.length, 'A game requires at least one puzzle');
    unique(manifest.puzzles, 'puzzle');
    const assets = this.assets(data, manifest.key);
    const gameId = this.game(data, manifest.key)?.id || this.record(data, manifest.key)?.gameId;
    for (const puzzle of manifest.puzzles) {
      requireValue(puzzle.title?.trim() && puzzle.surface?.trim(), `Puzzle ${puzzle.key} requires title and surface`);
      requireValue(puzzle.clues?.length, `Puzzle ${puzzle.key} requires at least one clue`);
      unique(puzzle.clues, 'clue');
      for (const clue of puzzle.clues) {
        requireValue(clue.text?.trim(), `Clue ${puzzle.key}/${clue.key} requires text`);
        if (clue.audioAssetId) {
          const asset = assets.find(a => a.id === clue.audioAssetId);
          requireValue(asset, `Unknown or cross-game audioAssetId for ${puzzle.key}/${clue.key}`);
          requireValue(fs.existsSync(path.join(this.root, 'storage', 'assets', gameId, asset.id + asset.ext)), `Missing audio file for ${puzzle.key}/${clue.key}`);
        }
      }
    }
    return manifest;
  }
  merge(data, patch, fromPublished = false) {
    patch = patchSchema.parse(patch);
    unique(patch.puzzles, 'puzzle');
    for (const puzzle of patch.puzzles || []) unique(puzzle.clues, 'clue');
    const game = this.game(data, patch.key);
    if (game && game.type !== 'puzzle_clue') fail('TYPE', 'Audio games support inspection and export only');
    const draft = fromPublished ? null : this.draft(data, patch.key);
    const previous = draft?.manifest || (game ? this.publishedManifest(game) : { key: patch.key, type: 'puzzle_clue', enabled: true, listed: false, puzzles: [] });
    const manifest = { ...previous, ...patch, puzzles: mergeChildren(previous.puzzles, patch.puzzles, 'clues') };
    return this.validateManifest(data, manifest);
  }
  write(operation) {
    if (this.readOnly) fail('READ_ONLY', 'This MCP instance is read-only');
    const cleanup = [];
    let result;
    try { this.store.transaction(data => { result = operation(data, cleanup); }); }
    catch (error) {
      // Only paths created by this operation; live immutable snapshots are never removed.
      for (const file of cleanup.reverse()) fs.rmSync(file, { recursive: true, force: true });
      if (error.code === 'EEXIST') fail('BUSY', 'Store is locked; retry after the other writer finishes');
      throw error;
    }
    return result;
  }
  createRecord(data, key) {
    data.management ||= { version: 1, games: [] };
    let record = this.record(data, key);
    if (!record) {
      record = { key, gameId: this.game(data, key)?.id || randomUUID(), latestVersion: null, publishedDraftVersion: null, assets: [] };
      data.management.games.push(record);
    }
    return record;
  }
  versions(data, key) {
    const game = this.game(data, key), record = this.record(data, key);
    return { gameKey: key, gameId: game?.id || record?.gameId || null, publishedVersion: this.publishedVersion(game), latestDraftVersion: record?.latestVersion || null, publishedDraftVersion: record?.publishedDraftVersion || null };
  }
  list_games() {
    const data = this.read();
    const keys = new Set([...data.games.map(g => g.key), ...(data.management?.games || []).map(g => g.key)]);
    return { readOnly: this.readOnly, games: [...keys].map(key => {
      const game = this.game(data, key), draft = this.draft(data, key);
      return { ...this.versions(data, key), title: game?.title || draft?.manifest.title, type: game?.type || 'puzzle_clue', published: game?.published === true };
    }) };
  }
  get_game({ gameKey, view = 'published', includeHostNotes = false }) {
    const data = this.read(), game = this.game(data, gameKey), draft = this.draft(data, gameKey);
    const manifest = view === 'draft' ? draft?.manifest : game && this.publishedManifest(game);
    if (!manifest) fail('NOT_FOUND', `No ${view} game`);
    return { ...this.versions(data, gameKey), view, basePublishedVersion: view === 'draft' ? draft.basePublishedVersion : undefined, manifest: redact(manifest, includeHostNotes), assets: this.assets(data, gameKey) };
  }
  validate_import({ patch }) {
    const data = this.read(), manifest = this.merge(data, patch);
    return { valid: true, ...this.versions(data, patch.key), ...summary(manifest), mode: 'incremental', publicChanged: false };
  }
  save_draft(args) {
    const { patch, expectedDraftVersion } = args;
    return this.write((data, cleanup) => {
      const record = this.record(data, patch.key);
      if ((record?.latestVersion || null) !== expectedDraftVersion) fail('CONFLICT', 'Draft changed; get_game(view=draft) and merge again');
      const fromPublished = Object.hasOwn(args, 'fromPublishedVersion');
      const currentPublished = this.publishedVersion(this.game(data, patch.key));
      if (fromPublished && args.fromPublishedVersion !== currentPublished) fail('CONFLICT', 'Published version changed before rebasing');
      const manifest = this.merge(data, patch, fromPublished);
      const previous = this.draft(data, patch.key);
      const basePublishedVersion = fromPublished || !previous || record.publishedDraftVersion === previous.version ? currentPublished : previous.basePublishedVersion;
      const version = randomUUID();
      const envelope = { version, basePublishedVersion, manifest };
      const file = this.draftFile(patch.key, version);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      cleanup.push(file);
      fs.writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      this.createRecord(data, patch.key).latestVersion = version;
      return { ...this.versions(data, patch.key), draftVersion: version, basePublishedVersion, ...summary(manifest), publicChanged: false };
    });
  }
  preview_clue({ gameKey, draftVersion, puzzleKey, clueKey }) {
    const data = this.read(), draft = this.draft(data, gameKey);
    if (!draft || draft.version !== draftVersion) fail('CONFLICT', 'Preview requires the latest draft version');
    const manifest = draft.manifest, puzzle = manifest.puzzles.find(p => p.key === puzzleKey), clue = puzzle?.clues.find(c => c.key === clueKey);
    if (!clue) fail('NOT_FOUND', 'Clue not found');
    const branded = branding.applyBranding({ type: 'puzzle_clue' }, manifest);
    const page = { type: 'puzzle_clue', contentType: 'puzzle_clue', preview: true,
      game: { key: gameKey, displayName: branded.displayName, tagline: branded.tagline },
      puzzle: { key: puzzleKey, title: puzzle.title, surface: puzzle.surface },
      clue: { key: clueKey, text: clue.text, scene: clue.scene || '' }, audio: null };
    const css = fs.readFileSync(fileURLToPath(new URL('../player/public/puzzle.css', import.meta.url)), 'utf8');
    return { draftVersion, page, html: render.renderPuzzle(page, css), audioAssetId: clue.audioAssetId || null, note: 'Draft audio is not exposed by the public player' };
  }
  publish_draft({ gameKey, draftVersion, expectedPublishedVersion }) {
    return this.write((data, cleanup) => {
      const record = this.record(data, gameKey), draft = this.draft(data, gameKey);
      if (!draft || draft.version !== draftVersion) fail('CONFLICT', 'Only the latest draft can be published');
      const current = this.publishedVersion(this.game(data, gameKey));
      if (record.publishedDraftVersion === draftVersion && record.lastPublishedVersion === current) {
        return { ...this.versions(data, gameKey), alreadyPublished: true };
      }
      if (current !== expectedPublishedVersion || current !== draft.basePublishedVersion) fail('CONFLICT', 'Published content changed; inspect and reconcile before publishing');
      const manifest = this.validateManifest(data, draft.manifest);
      const source = { ...manifest, published: manifest.enabled !== false, puzzles: manifest.puzzles.map(p => ({ ...p, published: p.enabled !== false, clues: p.clues.map(c => ({ ...c, published: c.enabled !== false })) })) };
      const before = this.game(data, gameKey)?.revision;
      try {
        puzzles.importGame(data, source, path.join(this.root, 'data'), { gameId: record.gameId, assets: this.assets(data, gameKey) });
      } finally {
        const game = this.game(data, gameKey);
        if (game?.revision && game.revision !== before) {
          cleanup.push(path.join(this.root, 'data', 'games', game.id, 'revisions', game.revision));
          for (const puzzle of game.puzzles) if (puzzle.hostNotesRevision === game.revision) cleanup.push(path.join(this.root, 'data', 'host-only', game.id, puzzle.id, `${game.revision}.json`));
        }
      }
      record.publishedDraftVersion = draftVersion;
      record.lastPublishedVersion = this.publishedVersion(this.game(data, gameKey));
      return { ...this.versions(data, gameKey), alreadyPublished: false, ...summary(manifest) };
    });
  }
  import_asset({ gameKey, relativePath }) {
    if (this.readOnly) fail('READ_ONLY', 'This MCP instance is read-only');
    if (!this.importRoot) fail('CONFIG', 'Set BOARD_GAMES_IMPORT_ROOT to enable asset imports');
    requireValue(!path.isAbsolute(relativePath) && !relativePath.split(/[\\/]/).includes('..'), 'Use a relative path inside the import directory');
    const base = fs.realpathSync(this.importRoot), file = fs.realpathSync(path.resolve(base, relativePath));
    const relative = path.relative(base, file);
    requireValue(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), 'Asset resolves outside the import directory');
    const ext = path.extname(file).toLowerCase(), stat = fs.statSync(file);
    requireValue(audioTypes[ext] && stat.isFile() && stat.size > 0 && stat.size <= 64 * 1024 * 1024, 'Audio must be a nonempty supported file of at most 64 MiB');
    const bytes = fs.readFileSync(file), sha256 = hash(bytes);
    return this.write((data, cleanup) => {
      const game = this.game(data, gameKey), existing = this.record(data, gameKey);
      requireValue(game?.type === 'puzzle_clue' || existing?.latestVersion, 'Save a puzzle game draft before importing audio');
      const reused = this.assets(data, gameKey).find(a => a.sha256 === sha256 && a.ext === ext);
      if (reused) return { gameKey, assetId: reused.id, reused: true, publicChanged: false };
      const record = this.createRecord(data, gameKey), asset = { id: randomUUID(), ext, sha256, bytes: bytes.length };
      const destination = path.join(this.root, 'storage', 'assets', record.gameId, asset.id + ext);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      cleanup.push(destination);
      fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
      record.assets.push(asset);
      return { gameKey, assetId: asset.id, reused: false, publicChanged: false };
    });
  }
  export_links({ gameKey } = {}) {
    const data = this.read(), links = [];
    for (const game of data.games.filter(g => g.published === true && (!gameKey || g.key === gameKey))) {
      for (const entry of data.entries.filter(e => e.gameId === game.id)) {
        let directPath, fields;
        if (entry.type === 'puzzle_clue') {
          const puzzle = game.puzzles.find(p => p.id === entry.puzzleId), clue = puzzle?.clues.find(c => c.id === entry.clueId);
          if (!puzzle?.published || !clue?.published) continue;
          directPath = `/g/${game.key}/p/${puzzle.key}/clues/${clue.key}`;
          fields = { puzzleKey: puzzle.key, puzzleId: puzzle.id, clueKey: clue.key, clueId: clue.id };
        } else {
          const chapter = game.chapters.find(c => c.uid === entry.chapterId);
          if (!chapter?.published) continue;
          directPath = `/g/${game.key}/c/${chapter.key}`;
          fields = { chapterKey: chapter.key, chapterId: chapter.uid };
        }
        links.push({ gameKey: game.key, gameId: game.id, type: game.type, ...fields, directUrl: this.origin + directPath, nfcUrl: `${this.origin}/n/${entry.code}` });
      }
    }
    return { count: links.length, links };
  }
}
