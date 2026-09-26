const audio = document.getElementById('audio');
const playlistEl = document.getElementById('playlist');
const playlistWrap = document.getElementById('playlistWrap');
const playlistBackdrop = document.getElementById('playlistBackdrop');
const lyricsPanel = document.getElementById('lyricsPanel');
const lyricsEl = document.getElementById('lyrics');
const titleEl = document.getElementById('trackTitle');
const metaEl = document.getElementById('trackMeta');
const hintEl = document.getElementById('subtitleHint');
const errorEl = document.getElementById('errorBox');
const menuBtn = document.getElementById('menuBtn');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const speedDownBtn = document.getElementById('speedDownBtn');
const prevBtn = document.getElementById('prevBtn');
const playBtn = document.getElementById('playBtn');
const nextBtn = document.getElementById('nextBtn');
const speedUpBtn = document.getElementById('speedUpBtn');
const seekBar = document.getElementById('seekBar');
const volumeBar = document.getElementById('volumeBar');

let tracks = [];
let currentIndex = 0;
let lyrics = [];
let activeLyricIndex = -1;
let userScrollingLyrics = false;
let userScrollTimer = null;
let seeking = false;
let subtitleLoadToken = 0;
let currentBrandName = '游戏空间';
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const total = Math.max(0, Math.floor(seconds));
  const mins = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function showError(message = '') {
  errorEl.textContent = message;
}

function setHint(message = '') {
  hintEl.textContent = message;
}

function updateSpeedButtons() {
  const label = `${audio.playbackRate.toFixed(2).replace(/\.?0+$/, '')}x`;
  speedDownBtn.textContent = label;
  speedUpBtn.textContent = label;
}

function updatePlayButton() {
  playBtn.textContent = audio.paused ? '▶' : 'Ⅱ';
}

function closePlaylist() {
  playlistWrap.classList.remove('open');
  playlistBackdrop.classList.remove('open');
  playlistBackdrop.hidden = true;
}

function togglePlaylist() {
  const nextOpen = !playlistWrap.classList.contains('open');
  playlistWrap.classList.toggle('open', nextOpen);
  playlistBackdrop.classList.toggle('open', nextOpen);
  playlistBackdrop.hidden = !nextOpen;
}

function parseClock(value) {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseLrc(text) {
  const result = [];
  const timePattern = /\[(\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]/g;
  for (const line of text.split(/\r?\n/)) {
    const times = [...line.matchAll(timePattern)];
    if (!times.length) continue;
    const content = line.replace(timePattern, '').trim();
    if (!content) continue;
    for (const match of times) {
      const time = parseClock(match[1]);
      if (time !== null) result.push({ time, endTime: null, text: content });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

function parseCueBlocks(text) {
  const result = [];
  const blocks = text.replace(/^WEBVTT.*?\n/i, '').split(/\n\s*\n/);
  const timing = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/;

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timeLineIndex = lines.findIndex((line) => timing.test(line));
    if (timeLineIndex < 0) continue;
    const match = lines[timeLineIndex].match(timing);
    const time = parseClock(match[1]);
    const endTime = parseClock(match[2]);
    const content = lines.slice(timeLineIndex + 1).join(' ').trim();
    if (time !== null && content) result.push({ time, endTime, text: content });
  }

  return result.sort((a, b) => a.time - b.time);
}

function parseSimpleTimedText(text) {
  const result = [];
  const pattern = /^(\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s+(.+)$/;
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(pattern);
    if (!match) continue;
    const time = parseClock(match[1]);
    if (time !== null) result.push({ time, endTime: null, text: match[2].trim() });
  }
  return result.sort((a, b) => a.time - b.time);
}

function parseSubtitle(text) {
  const lrc = parseLrc(text);
  if (lrc.length) return { type: 'timed', rows: lrc, label: '当前字幕支持时间同步与点击跳转。' };

  const cue = parseCueBlocks(text);
  if (cue.length) return { type: 'timed', rows: cue, label: '当前字幕支持时间同步与点击跳转。' };

  const simple = parseSimpleTimedText(text);
  if (simple.length) return { type: 'timed', rows: simple, label: '当前字幕支持时间同步与点击跳转。' };

  const plain = text.trim() ? [text.trim()] : [];
  return {
    type: 'plain',
    rows: plain.map((line) => ({ time: null, endTime: null, text: line })),
    label: ''
  };
}

function renderPlaylist() {
  playlistEl.innerHTML = '';
  tracks.forEach((track, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `track${index === currentIndex ? ' active' : ''}`;
    button.textContent = track.title;
    button.addEventListener('click', () => {
      loadTrack(index);
      closePlaylist();
    });
    playlistEl.appendChild(button);
  });
}

function renderLyrics() {
  lyricsEl.innerHTML = '';
  if (!lyrics.length) {
    const empty = document.createElement('div');
    empty.className = 'lyric-line';
    empty.textContent = '暂无字幕';
    lyricsEl.appendChild(empty);
    return;
  }

  lyrics.forEach((lyric, index) => {
    const line = document.createElement(lyric.time !== null ? 'button' : 'div');
    if (lyric.time !== null) line.type = 'button';
    line.className = `lyric-line${lyric.time !== null ? ' timed' : ''}`;
    line.textContent = lyric.text;
    line.dataset.index = String(index);
    if (lyric.time !== null) {
      line.addEventListener('click', () => {
        audio.currentTime = lyric.time;
        activeLyricIndex = index;
        updateActiveLyric(true);
      });
    }
    lyricsEl.appendChild(line);
  });
}

function findActiveLyricIndex(currentTime) {
  for (let i = lyrics.length - 1; i >= 0; i -= 1) {
    const lyric = lyrics[i];
    if (lyric.time === null) continue;
    if (lyric.endTime !== null && currentTime >= lyric.time && currentTime < lyric.endTime) return i;
    if (lyric.endTime === null && currentTime >= lyric.time) return i;
  }
  return -1;
}

function scrollActiveLyricIntoView() {
  const active = lyricsEl.querySelector('.lyric-line.active');
  if (active) {
    active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function updateActiveLyric(forceScroll = false) {
  const lines = lyricsEl.querySelectorAll('.lyric-line');
  lines.forEach((line) => line.classList.remove('active'));
  if (activeLyricIndex >= 0 && lines[activeLyricIndex]) {
    lines[activeLyricIndex].classList.add('active');
    if (forceScroll || !userScrollingLyrics) {
      scrollActiveLyricIntoView();
    }
  }
}

function markUserScrolling() {
  userScrollingLyrics = true;
  if (userScrollTimer) clearTimeout(userScrollTimer);
  userScrollTimer = setTimeout(() => {
    userScrollingLyrics = false;
    scrollActiveLyricIntoView();
  }, 3000);
}

async function loadSubtitle(track, token) {
  lyrics = [];
  activeLyricIndex = -1;
  renderLyrics();

  if (!track.subtitle) {
    if (token !== subtitleLoadToken) return;
    setHint('当前音频没有关联字幕。');
    return;
  }

  try {
    const response = await fetch(track.subtitle);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parseSubtitle(await response.text());
    if (token !== subtitleLoadToken) return;
    lyrics = parsed.rows;
    setHint(parsed.label);
    renderLyrics();
  } catch {
    if (token !== subtitleLoadToken) return;
    setHint('字幕加载失败，音频仍可播放。');
  }
}

async function loadTrack(index) {
  if (!tracks[index]) return;
  currentIndex = index;
  const track = tracks[currentIndex];
  showError('');
  titleEl.textContent = track.title;
  document.title = `${track.title} · ${currentBrandName}`;
  metaEl.textContent = track.artist || track.album || '';
  audio.src = track.audio;
  audio.load();
  updatePlayButton();
  seekBar.value = '0';
  currentTimeEl.textContent = '00:00';
  durationEl.textContent = '00:00';
  renderPlaylist();
  subtitleLoadToken += 1;
  loadSubtitle(track, subtitleLoadToken);
}

function playPrevious() {
  loadTrack((currentIndex - 1 + tracks.length) % tracks.length);
}

function playNext() {
  loadTrack((currentIndex + 1) % tracks.length);
}

function changeSpeed(direction) {
  const currentRateIndex = playbackRates.reduce((bestIndex, rate, index) => (
    Math.abs(rate - audio.playbackRate) < Math.abs(playbackRates[bestIndex] - audio.playbackRate)
      ? index
      : bestIndex
  ), 0);
  const nextIndex = Math.min(playbackRates.length - 1, Math.max(0, currentRateIndex + direction));
  audio.playbackRate = playbackRates[nextIndex];
  updateSpeedButtons();
}

async function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) {
    try {
      await audio.play();
    } catch {
      showError('浏览器阻止了播放，请使用原生控件重试。');
    }
  } else {
    audio.pause();
  }
}

async function init() {
  try {
    const page = JSON.parse(document.getElementById('pageData').textContent);
    currentBrandName = page.game?.displayName || page.platform?.displayName || '游戏空间';
    if (page.type === 'home' || page.type === 'game') {
      document.getElementById('welcome').hidden = false;
      document.body.classList.add('landing-page');
      const heading = document.getElementById('welcomeTitle');
      const description = document.getElementById('welcomeDescription');
      const links = document.getElementById('welcomeLinks');
      if (page.type === 'game') {
        heading.textContent = page.game.displayName;
        description.textContent = page.game.description || '打开内容链接或轻触 NFC 标签，即可开始探索。';
        document.title = `${page.game.displayName} · ${page.game.tagline}`;
        document.getElementById('welcomeHint').textContent = page.game.contentType === 'audio_chapter' ? '目录会显示当前章节及同一辑中此前的内容。' : '跟随现场的指引，发现属于你的线索。';
        if (page.game.startUrl) {
          const link = document.createElement('a');
          link.href = page.game.startUrl;
          link.textContent = '开始收听';
          links.appendChild(link);
        }
      } else {
        for (const game of page.games) {
          const link = document.createElement('a');
          link.href = `/g/${game.key}`;
          link.textContent = game.displayName;
          links.appendChild(link);
        }
      }
      return;
    }
    document.getElementById('playerShell').hidden = false;
    tracks = page.tracks;
    if (!tracks.length) {
      titleEl.textContent = '没有可播放音频';
      setHint('没有找到已开放的音频。');
      return;
    }
    const defaultIndex = page.type === 'test' ? 0 : tracks.findIndex(track => track.id === page.chapterKey);
    if (defaultIndex < 0) throw new Error('Target chapter missing');
    await loadTrack(defaultIndex);
  } catch {
    document.getElementById('playerShell').hidden = false;
    titleEl.textContent = '加载失败';
    showError('无法加载当前章节，请刷新页面重试。');
  }
}

lyricsPanel.addEventListener('wheel', markUserScrolling, { passive: true });
lyricsPanel.addEventListener('touchstart', markUserScrolling, { passive: true });
lyricsPanel.addEventListener('touchmove', markUserScrolling, { passive: true });
lyricsPanel.addEventListener('pointerdown', markUserScrolling);

audio.addEventListener('timeupdate', () => {
  currentTimeEl.textContent = formatTime(audio.currentTime);
  if (!seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    seekBar.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  }
  const nextIndex = findActiveLyricIndex(audio.currentTime);
  if (nextIndex !== activeLyricIndex) {
    activeLyricIndex = nextIndex;
    updateActiveLyric();
  }
});
audio.addEventListener('loadedmetadata', () => {
  durationEl.textContent = formatTime(audio.duration);
  seekBar.value = '0';
});
audio.addEventListener('play', () => {
  updatePlayButton();
});
audio.addEventListener('pause', () => {
  updatePlayButton();
});
audio.addEventListener('ended', playNext);
audio.addEventListener('error', () => {
  showError('音频加载失败，当前浏览器可能不支持该音频格式或文件不可访问。');
});

prevBtn.addEventListener('click', playPrevious);
nextBtn.addEventListener('click', playNext);
playBtn.addEventListener('click', togglePlay);
speedDownBtn.addEventListener('click', () => changeSpeed(-1));
speedUpBtn.addEventListener('click', () => changeSpeed(1));
menuBtn.addEventListener('click', () => {
  togglePlaylist();
});
playlistBackdrop.addEventListener('click', closePlaylist);
seekBar.addEventListener('input', () => {
  seeking = true;
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    const nextTime = (Number(seekBar.value) / 1000) * audio.duration;
    currentTimeEl.textContent = formatTime(nextTime);
  }
});
seekBar.addEventListener('change', () => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = (Number(seekBar.value) / 1000) * audio.duration;
  }
  seeking = false;
});
volumeBar.addEventListener('input', () => {
  audio.volume = Number(volumeBar.value);
});

updateSpeedButtons();
init();
