function applyBranding(game, source = {}) {
  for (const field of ['title', 'theme']) {
    if (Object.hasOwn(source, field)) game[field] = String(source[field]);
  }
  const defaults = { mystery: '线索档案', puzzle: '线索档案', adventure: '探索手记', fantasy: '奇境札记', audio: '故事聆听' };
  if (Object.hasOwn(source, 'displayName')) {
    if (typeof source.displayName !== 'string' || !source.displayName.trim()) throw new Error('displayName must be nonempty');
    game.displayName = source.displayName;
    game.displayNameGenerated = false;
  } else if (!game.displayName || game.displayNameGenerated === true) {
    game.displayName = game.title || '未命名游戏';
    game.displayNameGenerated = true;
  }
  if (Object.hasOwn(source, 'tagline')) {
    if (typeof source.tagline !== 'string' || !source.tagline.trim()) throw new Error('tagline must be nonempty');
    game.tagline = source.tagline;
    game.taglineGenerated = false;
  } else if (!game.tagline || game.taglineGenerated === true) {
    game.tagline = defaults[game.theme] || (game.type === 'puzzle_clue' ? '线索档案' : game.type === 'audio_chapter' ? '故事聆听' : '故事空间');
    game.taglineGenerated = true;
  }
  return game;
}
module.exports = { applyBranding };
