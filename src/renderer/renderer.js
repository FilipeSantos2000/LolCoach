// Overlay UI. Builds DOM with textContent only (no innerHTML).
const $ = (id) => document.getElementById(id);
const { t, tm, LANGUAGES, LABELS } = window.i18n;

let lang = 'en';
let last = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row({ image, title, extra, extraClass, reasons }) {
  const li = el('li');
  if (image) {
    const img = el('img');
    img.src = image;
    img.alt = '';
    li.appendChild(img);
  }
  const info = el('div');
  const name = el('div', 'name', title);
  if (extra) name.appendChild(el('span', extraClass || 'cost', extra));
  info.appendChild(name);
  info.appendChild(el('div', 'reason', reasons.map((r) => tm(lang, r)).join(' · ')));
  li.appendChild(info);
  return li;
}

function itemRow(item, gold) {
  return row({
    image: item.image,
    title: item.name,
    extra: `${item.cost}g`,
    extraClass: `cost${gold >= item.cost ? ' affordable' : ''}`,
    reasons: item.reasons,
  });
}

function showOnly(sectionId) {
  for (const id of ['status', 'content', 'draft']) $(id).hidden = id !== sectionId;
}

function renderStatic() {
  document.documentElement.lang = lang;
  $('close').setAttribute('aria-label', t(lang, 'app.close'));
  $('resize').setAttribute('aria-label', t(lang, 'app.resize'));
  $('resize').title = t(lang, 'app.resize');
  const next = LANGUAGES[(LANGUAGES.indexOf(lang) + 1) % LANGUAGES.length];
  $('lang').textContent = LABELS[lang];
  $('lang').setAttribute('aria-label', `${t(lang, 'app.language')} (${LABELS[next]})`);
  $('lang').dataset.next = next;
  $('boots-title').textContent = t(lang, 'game.boots');
  $('items-title').textContent = t(lang, 'game.nextItems');
}

function renderFooter(data) {
  let meta = data.meta ? t(lang, data.meta.key, data.meta.params) : '';
  if (data.meta?.stalePatch) meta += ` ${t(lang, 'meta.usingOld', { patch: data.meta.stalePatch })}`;
  if (data.metaGames) meta += ` ${t(lang, 'meta.games', { games: data.metaGames, champion: data.me.championName })}`;
  $('meta').textContent = meta;

  $('footer').textContent = data.patch
    ? [t(lang, 'footer.patch', { patch: data.patch }), data.demo && t(lang, 'footer.demo'), t(lang, 'footer.hide')]
      .filter(Boolean).join(' · ')
    : '';
}

function renderGame(data) {
  showOnly('content');
  $('summary').textContent = t(lang, 'game.summary', {
    champion: data.me.championName,
    archetype: { key: `archetype.${data.me.archetype}` },
    gold: data.me.gold,
    ad: data.threats.adShare,
    ap: data.threats.apShare,
  });

  $('threats').replaceChildren(...data.threats.flags.map((f) => el('li', '', t(lang, `flag.${f}`))));

  const boots = data.boots ? [itemRow(data.boots, data.me.gold)] : [el('li', 'reason', t(lang, 'game.bootsOwned'))];
  $('boots').replaceChildren(...boots);
  $('items').replaceChildren(...data.items.map((it) => itemRow(it, data.me.gold)));
}

function renderDraft(data) {
  showOnly('draft');
  const list = (names) => (names.length ? names.join(', ') : t(lang, 'draft.noneYet'));
  $('draft-summary').textContent =
    `${t(lang, 'draft.allies', { list: list(data.allies) })}\n${t(lang, 'draft.enemies', { list: list(data.enemies) })}`;
  $('draft-title').textContent = t(lang, 'draft.title') + (data.role ? ` · ${t(lang, `role.${data.role}`)}` : '');

  const picks = data.picks.length
    ? data.picks.map((p) => row({
      image: p.image,
      title: p.name,
      extra: data.hasMeta
        ? new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'always' }).format(p.score)
        : '',
      reasons: p.reasons,
    }))
    : [el('li', 'reason', t(lang, 'draft.empty'))];
  $('draft-picks').replaceChildren(...picks);
}

function render(data) {
  last = data;
  if (data.lang) lang = data.lang;
  renderStatic();

  if (data.status) {
    $('status').textContent = tm(lang, data.status);
    showOnly('status');
  } else if (data.mode === 'draft') {
    renderDraft(data);
  } else {
    renderGame(data);
  }
  renderFooter(data);
}

// Corner resize: pointer drag (deltas from drag start, one IPC per frame) or arrow keys.
const RESIZE_STEP = 20;
const handle = $('resize');
let drag = null;

handle.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  handle.setPointerCapture(e.pointerId);
  drag = { x: e.screenX, y: e.screenY, frame: 0 };
  window.coach.resizeStart();
});
handle.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.lastX = e.screenX;
  drag.lastY = e.screenY;
  if (drag.frame) return;
  drag.frame = requestAnimationFrame(() => {
    if (!drag) return;
    drag.frame = 0;
    window.coach.resizeMove(drag.lastX - drag.x, drag.lastY - drag.y);
  });
});
const endDrag = () => {
  if (!drag) return;
  cancelAnimationFrame(drag.frame);
  drag = null;
  window.coach.resizeEnd();
};
handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);
handle.addEventListener('keydown', (e) => {
  const step = { ArrowRight: [RESIZE_STEP, 0], ArrowLeft: [-RESIZE_STEP, 0], ArrowDown: [0, RESIZE_STEP], ArrowUp: [0, -RESIZE_STEP] }[e.key];
  if (!step) return;
  e.preventDefault();
  window.coach.resizeBy(...step);
});

$('close').addEventListener('click', () => window.coach.close());
$('lang').addEventListener('click', () => {
  lang = $('lang').dataset.next;
  if (last) render({ ...last, lang }); // instant UI switch; game names follow after reload
  window.coach.setLanguage(lang);
});
window.coach.onUpdate(render);
renderStatic();
$('status').textContent = t(lang, 'app.starting');
