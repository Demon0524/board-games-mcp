const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { applyBranding } = require('./branding');
const chapterPattern = /^\d+(?:\.\d+)*$/;
const gamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const entryPattern = /^[A-Za-z0-9_-]{22}$/;

function compareChapters(a, b) {
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] || 0n, y = right[i] || 0n;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function sameGroup(a, b) { return BigInt(a.split('.')[0]) === BigInt(b.split('.')[0]); }
function parseRoute(urlPath) {
  if (urlPath === '/') return { type: 'home' };
  if (/^\/test\/?$/.test(urlPath)) return { type: 'test' };
  let m = urlPath.match(/^\/(\d+(?:\.\d+)*)\/?$/);
  if (m) return { type: 'chapter', gameKey: 'legacy', chapterKey: m[1] };
  m = urlPath.match(/^\/g\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if (m) return { type: 'game', gameKey: m[1] };
  m = urlPath.match(/^\/g\/([a-z0-9]+(?:-[a-z0-9]+)*)\/c\/(\d+(?:\.\d+)*)\/?$/);
  if (m) return { type: 'chapter', gameKey: m[1], chapterKey: m[2] };
  m = urlPath.match(/^\/g\/([a-z0-9]+(?:-[a-z0-9]+)*)\/p\/([a-z0-9]+(?:-[a-z0-9]+)*)\/clues\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if (m) return { type: 'puzzle_clue', gameKey: m[1], puzzleKey: m[2], clueKey: m[3] };
  m = urlPath.match(/^\/n\/([A-Za-z0-9_-]{22})\/?$/);
  return m ? { type: 'entry', code: m[1] } : null;
}
function checkResource(value, gameKey, required = false) {
  if (!value && !required) return;
  if (typeof value !== 'string' || !value.startsWith('/media/')) throw new Error('Invalid media path');
  const decoded = decodeURIComponent(value);
  if (/[?#\\\x00-\x1f]/.test(decoded) || decoded.slice(1).split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid media path');
  const prefixes = gameKey === 'legacy' ? ['/media/audio/', '/media/subtitles/'] : [`/media/games/${gameKey}/`];
  if (!prefixes.some(prefix => decoded.startsWith(prefix))) throw new Error('Media must belong to this game');
}
function validate(data) {
  if (data.version !== 1 || !Array.isArray(data.games) || !Array.isArray(data.entries)) throw new Error('Invalid catalog');
  const gameIds = new Set(), keys = new Set(), chapterIds = new Set();
  for (const game of data.games) {
    game.type ||= 'audio_chapter'; // Explicit migration of the original audio-only schema.
    if (!game.id || !gamePattern.test(game.key) || keys.has(game.key) || gameIds.has(game.id)) throw new Error('Invalid or duplicate game');
    keys.add(game.key); gameIds.add(game.id);
    if (typeof game.title !== 'string' || !Array.isArray(game.chapters)) throw new Error('Invalid game metadata');
    if (!['audio_chapter', 'puzzle_clue'].includes(game.type)) throw new Error('Invalid content type');
    if (game.type === 'puzzle_clue') require('./puzzles').validateGame(game);
    const chapterKeys = new Set();
    for (const chapter of game.chapters) {
      if (!chapter.uid || chapterIds.has(chapter.uid) || !chapterPattern.test(chapter.key) || chapterKeys.has(chapter.key)) throw new Error('Invalid or duplicate chapter');
      chapterIds.add(chapter.uid); chapterKeys.add(chapter.key);
      if (typeof chapter.title !== 'string') throw new Error('Invalid chapter title');
      checkResource(chapter.audio, game.key, true);
      checkResource(chapter.subtitle, game.key); checkResource(chapter.cover, game.key);
    }
    if (game.startChapterKey && !chapterKeys.has(game.startChapterKey)) throw new Error('Invalid start chapter');
  }
  const codes = new Set();
  for (const entry of data.entries) {
    entry.type ||= 'audio_chapter';
    const game = data.games.find(g => g.id === entry.gameId);
    const validTarget = entry.type === 'puzzle_clue'
      ? game?.type === 'puzzle_clue' && game.puzzles.some(p => p.id === entry.puzzleId && p.clues.some(c => c.id === entry.clueId))
      : entry.type === 'audio_chapter' && game?.type === 'audio_chapter' && game.chapters.some(c => c.uid === entry.chapterId);
    if (!entryPattern.test(entry.code) || codes.has(entry.code) || !validTarget) throw new Error('Invalid NFC mapping');
    codes.add(entry.code);
  }
  return data;
}
function createStore(filename, legacyIndex) {
  const writableRoot = path.dirname(path.dirname(filename));
  function read() { return validate(JSON.parse(fs.readFileSync(filename, 'utf8'))); }
  function transaction(update) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const lock = `${filename}.lock`, handle = fs.openSync(lock, 'wx', 0o600);
    const temp = `${filename}.${randomUUID()}.tmp`;
    try {
      const data = fs.existsSync(filename) ? read() : { version: 1, platform: { displayName: '游戏空间', tagline: '从一个入口，走进一个故事。' }, games: [], entries: [] };
      update(data); validate(data);
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, filename);
      return data;
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      fs.closeSync(handle); fs.unlinkSync(lock);
    }
  }
  function addEntries(data, game) {
    for (const chapter of game.chapters) {
      if (data.entries.some(e => e.gameId === game.id && e.chapterId === chapter.uid)) continue;
      let code;
      do { code = randomBytes(16).toString('base64url'); } while (data.entries.some(e => e.code === code));
      data.entries.push({ code, type: 'audio_chapter', gameId: game.id, chapterId: chapter.uid });
    }
  }
  function upsert(data, manifest) {
    if (!manifest || typeof manifest.key !== 'string' || !gamePattern.test(manifest.key) || !Array.isArray(manifest.chapters)) throw new Error('Invalid game manifest');
    let game = data.games.find(g => g.key === manifest.key);
    if (!game) {
      game = { id: randomUUID(), key: manifest.key, type: 'audio_chapter', title: manifest.key, description: '', published: false, listed: false, chapters: [] };
      data.games.push(game);
    }
    if (game.type !== 'audio_chapter') throw new Error('Content type cannot change');
    for (const field of ['title', 'description', 'published', 'listed', 'startChapterKey']) if (Object.hasOwn(manifest, field)) game[field] = manifest[field];
    applyBranding(game, manifest);
    const seen = new Set();
    for (const source of manifest.chapters) {
      if (typeof source.key !== 'string' || !chapterPattern.test(source.key) || seen.has(source.key)) throw new Error('Invalid or duplicate chapter key');
      seen.add(source.key);
    }
    for (const chapter of game.chapters) chapter.published = false;
    for (const source of manifest.chapters) {
      let chapter = game.chapters.find(c => c.key === source.key);
      if (!chapter) {
        chapter = { uid: randomUUID(), key: source.key, title: source.key, audio: '', subtitle: '', cover: '', artist: '', album: '', duration: null };
        game.chapters.push(chapter);
      }
      chapter.published = source.published !== false;
      for (const field of ['title', 'audio', 'subtitle', 'cover', 'artist', 'album', 'duration']) if (Object.hasOwn(source, field)) chapter[field] = source[field];
    }
    addEntries(data, game);
  }
  function syncLegacy() {
    const items = JSON.parse(fs.readFileSync(legacyIndex, 'utf8'));
    if (!Array.isArray(items)) throw new Error('Invalid legacy index');
    return transaction(data => {
      const exists = data.games.some(g => g.key === 'legacy');
      upsert(data, { key: 'legacy',
        ...(exists ? {} : { title: '有声故事', theme: 'audio', description: '通过章节链接或 NFC 标签打开对应内容。', published: true, listed: false, startChapterKey: items.find(t => chapterPattern.test(t.id))?.id || '' }),
        chapters: items.filter(t => chapterPattern.test(t.id)).map(t => ({ ...t, key: t.id })) });
    });
  }
  return { read, transaction, syncLegacy,
    ensure() {
      if (!fs.existsSync(filename)) {
        if (legacyIndex && fs.existsSync(legacyIndex)) syncLegacy();
        else transaction(() => {});
      }
      else {
        const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (!data.platform || data.games.some(g => !g.type || !g.displayName || !g.tagline) || data.entries.some(e => !e.type)) transaction(current => {
          current.platform ||= { displayName: '游戏空间', tagline: '从一个入口，走进一个故事。' };
          for (const game of current.games) {
            if (game.key === 'legacy' && game.title === '声册' && !game.displayName) game.title = '有声故事';
            applyBranding(game);
          }
        });
      }
      return read();
    },
    importPuzzleGame(manifest) {
      return transaction(data => require('./puzzles').importGame(data, manifest, path.join(writableRoot, 'data')));
    },
    addAsset(gameKey, file) {
      let asset;
      transaction(data => { asset = require('./puzzles').addAsset(data, gameKey, file, path.join(writableRoot, 'storage/assets')); });
      return asset;
    },
    readPuzzle(data, route, allowDraft = false) {
      return require('./puzzles').readPage(data, route, path.join(writableRoot, 'data'), allowDraft);
    },
    assetFile(data, gameId, assetId, allowDraft = false) {
      return require('./puzzles').assetFile(data, gameId, assetId, path.join(writableRoot, 'storage/assets'), allowDraft);
    },
    importGame(manifest) {
      if (manifest.key === 'legacy') throw new Error('Use sync-legacy for the original media index');
      return transaction(data => upsert(data, manifest));
    }
  };
}
function gameSummary(game) {
  const start = game.chapters.find(c => c.key === game.startChapterKey && c.published === true);
  return { key: game.key, contentType: game.type, title: game.title, displayName: game.displayName, tagline: game.tagline, description: game.description || '', startUrl: start ? `/g/${game.key}/c/${start.key}` : null };
}
function chapterPage(data, gameKey, chapterKey) {
  const game = data.games.find(g => g.key === gameKey && g.type === 'audio_chapter' && g.published === true);
  const target = game?.chapters.find(c => c.key === chapterKey && c.published === true);
  if (!target) return null;
  const tracks = game.chapters.filter(c => c.published === true && sameGroup(c.key, chapterKey) && compareChapters(c.key, chapterKey) <= 0)
    .sort((a, b) => compareChapters(a.key, b.key))
    .map(c => ({ id: c.key, title: c.title, audio: c.audio, subtitle: c.subtitle, cover: c.cover, artist: c.artist, album: c.album, duration: c.duration }));
  return { type: 'chapter', contentType: 'audio_chapter', game: gameSummary(game), chapterKey, tracks };
}
function resolvePage(data, route, testTracks = [], options = {}) {
  if (!route) return null;
  if (route.type === 'home') return { type: 'home', platform: data.platform, games: data.games.filter(g => g.published === true && g.listed === true).map(gameSummary) };
  if (route.type === 'test') {
    const game = data.games.find(g => g.key === 'legacy');
    return game ? { type: 'test', game: gameSummary(game), tracks: testTracks.filter(t => !chapterPattern.test(t.id)) } : null;
  }
  if (route.type === 'chapter') return chapterPage(data, route.gameKey, route.chapterKey);
  if (route.type === 'puzzle_clue') return options.readPuzzle?.(data, route, options.allowDraft) || null;
  if (route.type === 'game') {
    const game = data.games.find(g => g.key === route.gameKey && g.published === true);
    return game ? { type: 'game', game: gameSummary(game) } : null;
  }
  const entry = data.entries.find(e => e.code === route.code);
  const game = data.games.find(g => g.id === entry?.gameId);
  if (entry?.type === 'puzzle_clue') {
    const puzzle = game?.puzzles.find(p => p.id === entry.puzzleId);
    const clue = puzzle?.clues.find(c => c.id === entry.clueId);
    return clue ? options.readPuzzle?.(data, { type: 'puzzle_clue', gameKey: game.key, puzzleKey: puzzle.key, clueKey: clue.key }, options.allowDraft) || null : null;
  }
  const chapter = game?.chapters.find(c => c.uid === entry?.chapterId);
  return chapter ? chapterPage(data, game.key, chapter.key) : null;
}
module.exports = { createStore, parseRoute, resolvePage, compareChapters, chapterPattern };
