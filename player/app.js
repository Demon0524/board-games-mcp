const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStore, parseRoute, resolvePage } = require('./lib/catalog');
const { renderPuzzle, renderAudio } = require('./lib/render');

function createApp(options = {}) {
  const app = express();
  const root = options.root || process.env.BOARD_GAMES_ROOT || path.join(__dirname, '..', 'runtime');
  const publicDir = path.join(__dirname, 'public');
  const mediaDir = path.join(root, 'media');
  const indexFile = path.join(mediaDir, 'index.json');
  const catalogFile = options.catalogFile || process.env.CATALOG_FILE || path.join(root, 'state', 'catalog.json');
  const store = createStore(catalogFile, indexFile);
  store.ensure();
  const allowDraft = options.allowDraftPreview === true;
  if (allowDraft) app.use((req, res, next) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.status(403).end();
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.disable('x-powered-by');
  app.enable('case sensitive routing');
  app.enable('strict routing');
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const legacyTracks = async () => {
    try { return JSON.parse(await fs.readFile(indexFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const page = async route => resolvePage(store.read(), route, route?.type === 'test' ? await legacyTracks() : [], { readPuzzle: store.readPuzzle, allowDraft });
  const jsonPage = routeFromRequest => wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const result = await page(routeFromRequest(req));
    res.status(result ? 200 : 404).json(result || { error: '内容不存在或尚未开放。' });
  });

  // Explicit assets only: index.html must never bypass page validation.
  for (const name of ['app.js', 'style.css', 'puzzle.css']) {
    app.get(`/${name}`, (req, res) => res.sendFile(path.join(publicDir, name), { maxAge: '1h' }));
  }
  app.use('/media', express.static(mediaDir, {
    dotfiles: 'deny', fallthrough: false, index: false, redirect: false, maxAge: '1d',
    setHeaders(res, filePath) {
      if (/\.(lrc|txt|srt|vtt)$/i.test(filePath)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
      }
    }
  }));
  app.get(/^\/assets\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/, (req, res) => {
    const asset = store.assetFile(store.read(), req.params[0], req.params[1], allowDraft);
    if (!asset) return res.status(404).json({ error: 'Not found' });
    res.type(asset.mime).sendFile(asset.path, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'board-games-audio-player', routingVersion: 2, contentVersion: 1 }));
  app.get('/api/index', wrap(async (req, res) => res.set('Cache-Control', 'no-store').json(await legacyTracks())));
  app.get('/api/games', jsonPage(() => ({ type: 'home' })));
  app.get(/^\/api\/games\/([a-z0-9]+(?:-[a-z0-9]+)*)$/, jsonPage(req => ({ type: 'game', gameKey: req.params[0] })));
  app.get(/^\/api\/games\/([a-z0-9]+(?:-[a-z0-9]+)*)\/chapters\/(\d+(?:\.\d+)*)$/, jsonPage(req => ({ type: 'chapter', gameKey: req.params[0], chapterKey: req.params[1] })));
  app.get(/^\/api\/games\/([a-z0-9]+(?:-[a-z0-9]+)*)\/puzzles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/clues\/([a-z0-9]+(?:-[a-z0-9]+)*)$/, jsonPage(req => ({ type: 'puzzle_clue', gameKey: req.params[0], puzzleKey: req.params[1], clueKey: req.params[2] })));
  app.get(/^\/api\/entries\/([A-Za-z0-9_-]{22})$/, jsonPage(req => ({ type: 'entry', code: req.params[0] })));
  app.get('*', wrap(async (req, res) => {
    const result = await page(parseRoute(req.path));
    res.set('Cache-Control', 'no-store');
    if (!result) {
      if (/^\/(?:api|media|assets|data|state|storage)(?:\/|$)/.test(req.path) || /\.(?:js|css|json|mp3|flac|txt|srt|vtt|lrc|png|ico)$/i.test(req.path)) {
        return res.status(404).json({ error: 'Not found' });
      }
      return res.status(404).type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>内容未找到</title><body style="background:#f4f0e7;color:#203d35;font-family:system-ui;padding:8vw"><h1>内容未找到</h1><p>这个游戏、内容或标签不存在，或尚未开放。</p><a style="color:#203d35" href="/">返回首页</a></body></html>');
    }
    if (result.type === 'puzzle_clue') return res.set('X-Robots-Tag', 'noindex, nofollow').type('html').send(renderPuzzle(result));
    const html = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
    res.type('html').send(renderAudio(html, result));
  }));
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status === 404 ? 404 : err.status === 400 ? 400 : 500;
    if (status === 500) console.error('Player request failed:', err.message);
    res.status(status).json({ error: status === 404 ? 'Not found' : status === 400 ? 'Bad request' : 'Internal server error' });
  });
  return app;
}
if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`board-games player listening on port ${port}`));
}
module.exports = { createApp };
