function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function renderPuzzle(page, css = null) {
  const e = escapeHtml;
  const title = `${page.puzzle.title} · ${page.game.displayName} · ${page.game.tagline}`;
  const stylesheet = css === null ? '<link rel="stylesheet" href="/puzzle.css?v=puzzle-1">' : `<style>${css}</style>`;
  const audio = page.audio ? `<section class="audio-note" aria-labelledby="audio-heading"><h2 id="audio-heading">收听这条线索</h2><audio controls preload="metadata" aria-label="当前线索音频"><source src="${e(page.audio.url)}" type="${e(page.audio.mime)}">当前浏览器不支持音频播放。</audio></section>` : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#F4F0E7"><meta name="description" content="${e(page.puzzle.title)} · ${e(page.game.tagline)}"><meta name="robots" content="noindex, nofollow"><title>${e(title)}</title><link rel="icon" href="data:,">${stylesheet}</head>
<body><main class="case-file" aria-label="${e(page.game.displayName)} · ${e(page.game.tagline)}">
<header class="case-header"><div class="brand-line"><p class="game-name">${e(page.game.displayName)}</p><span class="edition">${e(page.game.tagline)}</span></div>${page.preview ? '<p class="preview-label">未发布预览</p>' : ''}<h1>${e(page.puzzle.title)}</h1><p class="reading-note">留意每一个细节。</p></header>
<section class="surface-section" aria-labelledby="surface-heading"><h2 id="surface-heading"><span class="section-mark" aria-hidden="true"></span>汤面</h2><div class="story-text" id="surfaceText">${e(page.puzzle.surface)}</div></section>
<section class="clue-section" aria-labelledby="clue-heading"><div class="clue-heading-row"><h2 id="clue-heading">当前线索</h2>${page.clue.scene ? `<p class="scene-name">${e(page.clue.scene)}</p>` : ''}</div><div class="story-text clue-text" id="clueText">${e(page.clue.text)}</div>${audio}</section>
<footer class="case-footer"><span class="footer-dot" aria-hidden="true"></span><p>结合场景，继续推理。</p></footer>
</main></body></html>`;
}
function renderAudio(html, page) {
  const brand = page.game || page.platform || { displayName: '游戏空间', tagline: '故事入口' };
  const track = page.tracks?.find(t => t.id === page.chapterKey);
  const title = track ? `${track.title} · ${brand.displayName}` : `${brand.displayName} · ${brand.tagline}`;
  const values = { PAGE_TITLE: title, BRAND_NAME: brand.displayName, TAGLINE: brand.tagline, BRAND_MARK: Array.from(brand.displayName || '游')[0], DESCRIPTION: page.game?.description || brand.tagline };
  const rendered = html.replace(/__(PAGE_TITLE|BRAND_NAME|TAGLINE|BRAND_MARK|DESCRIPTION)__/g, (_, key) => escapeHtml(values[key]));
  const payload = JSON.stringify(page).replace(/</g, '\\u003c');
  return rendered.replace('<!-- PAGE_DATA -->', `<script type="application/json" id="pageData">${payload}</script>`);
}
module.exports = { renderPuzzle, renderAudio, escapeHtml };
