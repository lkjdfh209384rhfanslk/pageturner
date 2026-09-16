import { GESTURES, GestureEngine } from './gestures.js';
import { startFace, stopFace, isFaceRunning } from './face.js';
import { addPdf, listPdfs, getPdf, deletePdf, updatePdf, loadSettings, saveSettings } from './store.js';
import { Viewer } from './viewer.js';

const $ = id => document.getElementById(id);
const settings = loadSettings();
const viewer = new Viewer($('pages'));
const video = $('cam');

let screen = 'library';
let returnTo = 'library';
let currentId = null;
let lastValues = null;

// ---------- 화면 전환 ----------
function show(name) {
  screen = name;
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === name);
  $('menu').classList.add('hidden');

  if (name === 'settings') {
    $('cam-slot').append(video);
    ensureCamera();
  } else {
    $('cam-park').append(video);
    if (name === 'viewer' && settings.gestureEnabled) ensureCamera();
    else stopCamera();
  }

  if (name === 'viewer') requestWakeLock();
  else releaseWakeLock();
}

// ---------- 라이브러리 ----------
async function renderLibrary() {
  const items = (await listPdfs()).sort((a, b) => b.addedAt - a.addedAt);
  const list = $('pdf-list');
  list.replaceChildren();
  $('empty-msg').classList.toggle('hidden', items.length > 0);

  for (const item of items) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;
    name.onclick = () => openPdf(item.id);

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = item.pageCount ? `${item.lastPage} / ${item.pageCount}쪽` : '';

    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = '삭제';
    del.onclick = async () => {
      if (!confirm(`"${item.name}"을(를) 목록에서 삭제할까요?`)) return;
      await deletePdf(item.id);
      renderLibrary();
    };

    li.append(name, meta, del);
    list.append(li);
  }
}

$('file-input').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  let last = null;
  for (const f of files) last = await addPdf(f);
  await renderLibrary();
  if (files.length === 1 && last) openPdf(last.id);
});

async function openPdf(id) {
  const item = await getPdf(id);
  if (!item) return;
  currentId = id;
  viewer.spread = settings.spread;
  show('viewer');
  await viewer.open(item.data, item.lastPage);
  if (item.pageCount !== viewer.pageCount) updatePdf(id, { pageCount: viewer.pageCount });
  updateMenuLabels();
}

// ---------- 페이지 넘김 ----------
async function turn(action) {
  if (screen !== 'viewer') return;
  const moved = await viewer.go(action === 'next' ? 1 : -1);
  flash(action);
  if (moved && currentId) updatePdf(currentId, { lastPage: viewer.page });
  updateMenuLabels();
}

let flashTimer;
function flash(action) {
  const el = $('flash');
  el.className = `flash ${action} on`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('on'), 150);
}

// 메뉴가 열려 있을 때 화면을 탭하면 넘기지 않고 메뉴만 닫는다
function tapTurn(action) {
  const menu = $('menu');
  if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
  turn(action);
}
$('tap-next').addEventListener('click', () => tapTurn('next'));
$('tap-prev').addEventListener('click', () => tapTurn('prev'));
$('tap-menu').addEventListener('click', () => $('menu').classList.toggle('hidden'));

document.addEventListener('keydown', e => {
  if (screen !== 'viewer') return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); turn('next'); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); turn('prev'); }
});

// ---------- 뷰어 메뉴 ----------
function updateMenuLabels() {
  $('page-label').textContent = viewer.label();
  $('toggle-gesture').textContent = settings.gestureEnabled ? '제스처 켜짐' : '제스처 꺼짐';
  $('toggle-spread').textContent = settings.spread ? '가로 2페이지 켜짐' : '가로 2페이지 꺼짐';
  $('status').classList.toggle('hidden', !settings.gestureEnabled);
}

$('back-library').onclick = async () => {
  await viewer.close();
  currentId = null;
  show('library');
  renderLibrary();
};

$('toggle-gesture').onclick = () => {
  settings.gestureEnabled = !settings.gestureEnabled;
  saveSettings(settings);
  if (settings.gestureEnabled) ensureCamera(); else stopCamera();
  updateMenuLabels();
};

$('toggle-spread').onclick = async () => {
  settings.spread = !settings.spread;
  saveSettings(settings);
  viewer.spread = settings.spread;
  await viewer.invalidate();
  updateMenuLabels();
};

$('viewer-settings').onclick = () => { returnTo = 'viewer'; show('settings'); };
$('open-settings').onclick = () => { returnTo = 'library'; show('settings'); };
$('close-settings').onclick = () => show(returnTo);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!viewer.doc) return;
    viewer.invalidate().then(updateMenuLabels);
  }, 200);
});

// ---------- 카메라 / 제스처 ----------
const engine = new GestureEngine(action => {
  if (screen === 'viewer') turn(action);
  if (screen === 'settings') testFlash(action);
});

async function ensureCamera() {
  if (isFaceRunning()) return;
  setCamMsg('카메라 준비 중…');
  try {
    await startFace(video, onFaceValues);
    setCamMsg('');
  } catch (err) {
    console.error(err);
    stopFace(video);
    $('face-dot').className = 'dot error';
    setCamMsg(`카메라를 시작할 수 없습니다: ${err.message || err.name}. 설정 앱 › Safari › 카메라 권한을 확인하세요.`);
  }
}

function stopCamera() {
  stopFace(video);
  $('face-dot').className = 'dot';
}

function setCamMsg(text) { $('cam-msg').textContent = text; }

function onFaceValues(values, now) {
  lastValues = values;
  const active = screen === 'settings' || (screen === 'viewer' && settings.gestureEnabled && viewer.doc);
  const progress = active ? engine.update(values, now, settings) : 0;

  $('face-dot').className = `dot ${values ? 'face' : 'noface'}`;
  $('gauge-fill').style.width = `${Math.round(progress * 100)}%`;
  if (screen === 'settings') updateMeters();
}

let testTimer;
function testFlash(action) {
  const el = $('test-flash');
  el.textContent = action === 'next' ? '다음 페이지 →' : '← 이전 페이지';
  el.classList.add('on');
  clearTimeout(testTimer);
  testTimer = setTimeout(() => el.classList.remove('on'), 700);
}

// ---------- 설정 화면 ----------
const meterEls = {};

function buildSettings() {
  for (const id of ['next-gesture', 'prev-gesture']) {
    const sel = $(id);
    for (const g of GESTURES) sel.append(new Option(g.label, g.id));
  }
  $('next-gesture').value = settings.nextGesture;
  $('prev-gesture').value = settings.prevGesture;
  $('next-gesture').onchange = e => { settings.nextGesture = e.target.value; saveSettings(settings); updateMeterRoles(); };
  $('prev-gesture').onchange = e => { settings.prevGesture = e.target.value; saveSettings(settings); updateMeterRoles(); };

  bindRange('hold-ms', 'hold-out', 'holdMs', v => `${v}ms`);
  bindRange('cooldown-ms', 'cooldown-out', 'cooldownMs', v => `${(v / 1000).toFixed(1)}초`);

  for (const g of GESTURES) {
    const box = document.createElement('div');
    box.className = 'meter';
    box.innerHTML = `
      <div class="meter-head"><span>${g.label} <span class="role"></span></span><span class="val"></span></div>
      <div class="meter-track"><div class="meter-fill"></div><div class="meter-thr"></div></div>
      <input type="range" min="0" max="${g.max}" step="${g.max / 100}">`;
    const slider = box.querySelector('input');
    slider.value = settings.thresholds[g.id];
    slider.oninput = () => {
      settings.thresholds[g.id] = Number(slider.value);
      saveSettings(settings);
      updateMeters();
    };
    meterEls[g.id] = {
      box,
      role: box.querySelector('.role'),
      val: box.querySelector('.val'),
      fill: box.querySelector('.meter-fill'),
      thr: box.querySelector('.meter-thr'),
    };
    $('meters').append(box);
  }
  updateMeterRoles();
  updateMeters();
}

function bindRange(inputId, outId, key, fmt) {
  const input = $(inputId);
  input.value = settings[key];
  $(outId).textContent = fmt(settings[key]);
  input.oninput = () => {
    settings[key] = Number(input.value);
    $(outId).textContent = fmt(settings[key]);
    saveSettings(settings);
  };
}

function updateMeterRoles() {
  for (const g of GESTURES) {
    const role = g.id === settings.nextGesture ? '· 다음' : g.id === settings.prevGesture ? '· 이전' : '';
    meterEls[g.id].role.textContent = role;
    meterEls[g.id].box.classList.toggle('active', !!role);
  }
}

function updateMeters() {
  for (const g of GESTURES) {
    const m = meterEls[g.id];
    const thr = settings.thresholds[g.id];
    const v = lastValues ? g.read(lastValues) : 0;
    const pct = x => `${Math.max(0, Math.min(100, (x / g.max) * 100))}%`;
    m.fill.style.width = pct(v);
    m.fill.classList.toggle('over', v >= thr);
    m.thr.style.left = pct(thr);
    const fmt = x => g.unit ? `${x.toFixed(0)}${g.unit}` : x.toFixed(2);
    m.val.textContent = lastValues ? `${fmt(v)} / 기준 ${fmt(thr)}` : `기준 ${fmt(thr)}`;
  }
}

// ---------- 화면 꺼짐 방지 ----------
let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 미지원 또는 거부 */ }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (screen === 'viewer') requestWakeLock();
  // 백그라운드에서 돌아오면 iOS가 카메라를 끊어 두므로 다시 연결
  const wantCamera = screen === 'settings' || (screen === 'viewer' && settings.gestureEnabled);
  if (wantCamera) { stopFace(video); ensureCamera(); }
});

// ---------- 시작 ----------
buildSettings();
updateMenuLabels();
renderLibrary();

if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('service worker', err));
}
