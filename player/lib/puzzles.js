const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { applyBranding } = require('./branding');
const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validKey = value => typeof value === 'string' && keyPattern.test(value);
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const audioTypes = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac' };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
function requireText(text, label) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${label} must be nonempty text`);
}
function validateGame(game) {
  if (!idPattern.test(game.id) || !idPattern.test(game.revision) || !Array.isArray(game.puzzles) || !Array.isArray(game.assets) || game.chapters.length) throw new Error('Invalid puzzle game');
  const puzzleKeys = new Set(), ids = new Set(), assetIds = new Set();
  for (const asset of game.assets) {
    if (!idPattern.test(asset.id) || assetIds.has(asset.id) || !audioTypes[asset.ext]) throw new Error('Invalid asset');
    assetIds.add(asset.id);
  }
  for (const puzzle of game.puzzles) {
    if (!idPattern.test(puzzle.id) || !validKey(puzzle.key) || puzzleKeys.has(puzzle.key) || ids.has(puzzle.id) || !Array.isArray(puzzle.clues)) throw new Error('Invalid puzzle');
    puzzleKeys.add(puzzle.key); ids.add(puzzle.id);
    const clueKeys = new Set();
    for (const clue of puzzle.clues) {
      if (!idPattern.test(clue.id) || !validKey(clue.key) || clueKeys.has(clue.key) || ids.has(clue.id)) throw new Error('Invalid clue');
      clueKeys.add(clue.key); ids.add(clue.id);
      if (clue.audioAssetId && !assetIds.has(clue.audioAssetId)) throw new Error('Unknown or cross-game asset');
    }
  }
}
function importGame(data, source, dataDir, options = {}) {
  if (source.type !== 'puzzle_clue' || !validKey(source.key) || !Array.isArray(source.puzzles) || source.key === 'legacy') throw new Error('Invalid puzzle manifest');
  requireText(source.title, 'Game title');
  let game = data.games.find(g => g.key === source.key);
  if (game && game.type !== 'puzzle_clue') throw new Error('Content type cannot change');
  if (!game) {
    game = { id: options.gameId || randomUUID(), key: source.key, type: 'puzzle_clue', title: source.title, description: '', published: false, listed: false, chapters: [], puzzles: [], assets: [] };
    data.games.push(game);
  }
  for (const asset of options.assets || []) if (!game.assets.some(a => a.id === asset.id)) game.assets.push(asset);
  const previousRevision = game.revision;
  for (const field of ['description', 'published', 'listed']) if (Object.hasOwn(source, field)) game[field] = source[field];
  applyBranding(game, source);
  game.revision = randomUUID();
  const snapshot = path.join(dataDir, 'games', game.id, 'revisions', game.revision);
  const previous = previousRevision ? path.join(dataDir, 'games', game.id, 'revisions', previousRevision) : null;
  // Content snapshots are immutable. The registry switches revision only after validation.
  if (previous) fs.cpSync(previous, snapshot, { recursive: true });
  function replaceContent(relative, content) {
    const dest = path.join(snapshot, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(dest, JSON.stringify(content, null, 2) + '\n', { mode: 0o600 });
  }
  replaceContent('game.json', { title: game.title, displayName: game.displayName, tagline: game.tagline, description: game.description });
  const puzzleKeys = new Set();
  for (const puzzle of game.puzzles) puzzle.published = false;
  for (const input of source.puzzles) {
    if (!validKey(input.key) || puzzleKeys.has(input.key) || !Array.isArray(input.clues)) throw new Error('Invalid or duplicate puzzle key');
    puzzleKeys.add(input.key);
    requireText(input.title, 'Puzzle title'); requireText(input.surface, 'Puzzle surface');
    let puzzle = game.puzzles.find(p => p.key === input.key);
    if (!puzzle) { puzzle = { id: randomUUID(), key: input.key, published: false, clues: [] }; game.puzzles.push(puzzle); }
    puzzle.published = input.published === true;
    replaceContent(`puzzles/${puzzle.id}/puzzle.json`, { title: input.title, surface: input.surface });
    if (Object.hasOwn(input, 'hostNotes')) {
      const privateFile = path.join(dataDir, 'host-only', game.id, puzzle.id, `${game.revision}.json`);
      write(privateFile, { notes: input.hostNotes });
      puzzle.hostNotesRevision = game.revision;
    }
    const clueKeys = new Set();
    for (const clue of puzzle.clues) clue.published = false;
    for (const item of input.clues) {
      if (!validKey(item.key) || clueKeys.has(item.key)) throw new Error('Invalid or duplicate clue key');
      clueKeys.add(item.key); requireText(item.text, 'Clue text');
      if (item.scene !== undefined && typeof item.scene !== 'string') throw new Error('Invalid scene');
      let clue = puzzle.clues.find(c => c.key === item.key);
      if (!clue) { clue = { id: randomUUID(), key: item.key, published: false }; puzzle.clues.push(clue); }
      clue.published = item.published === true;
      clue.audioAssetId = item.audioAssetId || null;
      replaceContent(`puzzles/${puzzle.id}/clues/${clue.id}.json`, { text: item.text, scene: item.scene || '' });
      if (!data.entries.some(e => e.gameId === game.id && e.puzzleId === puzzle.id && e.clueId === clue.id)) {
        let code;
        do { code = randomBytes(16).toString('base64url'); } while (data.entries.some(e => e.code === code));
        data.entries.push({ code, type: 'puzzle_clue', gameId: game.id, puzzleId: puzzle.id, clueId: clue.id });
      }
    }
  }
  validateGame(game);
}
function readPage(data, route, dataDir, allowDraft = false) {
  const game = data.games.find(g => g.type === 'puzzle_clue' && g.key === route.gameKey);
  const puzzle = game?.puzzles.find(p => p.key === route.puzzleKey);
  const clue = puzzle?.clues.find(c => c.key === route.clueKey);
  if (!clue) return null;
  const published = game.published === true && puzzle.published === true && clue.published === true;
  if (!published && !allowDraft) return null;
  const snapshot = path.join(dataDir, 'games', game.id, 'revisions', game.revision);
  const publicGame = json(path.join(snapshot, 'game.json'));
  const publicPuzzle = json(path.join(snapshot, 'puzzles', puzzle.id, 'puzzle.json'));
  const publicClue = json(path.join(snapshot, 'puzzles', puzzle.id, 'clues', `${clue.id}.json`));
  const asset = game.assets.find(a => a.id === clue.audioAssetId);
  // Deliberate allowlist: never spread storage records into player responses.
  return { type: 'puzzle_clue', contentType: 'puzzle_clue', preview: !published,
    game: { key: game.key, displayName: publicGame.displayName, tagline: publicGame.tagline },
    puzzle: { key: puzzle.key, title: publicPuzzle.title, surface: publicPuzzle.surface },
    clue: { key: clue.key, text: publicClue.text, scene: publicClue.scene },
    audio: asset ? { url: `/assets/${game.id}/${asset.id}`, mime: audioTypes[asset.ext] } : null };
}
function addAsset(data, gameKey, sourceFile, storageDir) {
  const game = data.games.find(g => g.key === gameKey && g.type === 'puzzle_clue');
  const ext = path.extname(sourceFile).toLowerCase();
  if (!game || !audioTypes[ext] || !fs.statSync(sourceFile).isFile()) throw new Error('Expected a puzzle game and supported audio file');
  const asset = { id: randomUUID(), ext };
  const directory = path.join(storageDir, game.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, asset.id + ext);
  fs.copyFileSync(sourceFile, destination, fs.constants.COPYFILE_EXCL); fs.chmodSync(destination, 0o600);
  game.assets.push(asset);
  return { id: asset.id, url: `/assets/${game.id}/${asset.id}` };
}
function assetFile(data, gameId, assetId, storageDir, allowDraft = false) {
  const game = data.games.find(g => g.id === gameId && g.type === 'puzzle_clue');
  const asset = game?.assets.find(a => a.id === assetId);
  if (!asset) return null;
  const usable = game.puzzles.some(p => (allowDraft || p.published === true) && p.clues.some(c => c.audioAssetId === asset.id && (allowDraft || c.published === true)));
  if ((!allowDraft && game.published !== true) || !usable) return null;
  return { path: path.join(storageDir, game.id, asset.id + asset.ext), mime: audioTypes[asset.ext] };
}
module.exports = { validateGame, importGame, readPage, addAsset, assetFile };
