/* Kettlebellpedia — enciclopédia e acompanhamento de treinos de kettlebell
   Tudo é salvo no próprio aparelho (localStorage). Use Ajustes > Exportar para backup. */
(function () {
  "use strict";

  // ---------- Estado da pessoa ----------
  // runs: cada sequência começada (ou treino avulso) tem seu próprio registro de dias.
  const KEY = "nsc_v1";
  const DEFAULT = {
    settings: { level: "intermediate", bell: 12, sound: true },
    runs: {},     // { [runId]: { kind: "program"|"single", programId, workoutId, start, logs: { [dia]: {...} }, createdAt } }
    active: null, // runId em uso
    body: [],     // [{ date, weight, waist }]
    videos: {},   // { [exerciseId]: url } — link do YouTube escolhido pela pessoa
  };
  const SHRED_ID = "shred30";
  // Converte qualquer formato antigo (logs soltos do Shred) para o formato com sequências
  function migrateState(raw) {
    if (!raw || typeof raw !== "object") return JSON.parse(JSON.stringify(DEFAULT));
    const st = {
      settings: Object.assign({}, DEFAULT.settings, raw.settings || {}),
      runs: JSON.parse(JSON.stringify(raw.runs || {})),
      active: raw.active || null,
      body: raw.body || [], videos: raw.videos || {}, updatedAt: raw.updatedAt || 0,
    };
    if (raw.logs && Object.keys(raw.logs).length && !st.runs.shred) {
      st.runs.shred = { kind: "program", programId: SHRED_ID, start: (raw.settings && raw.settings.start) || "2026-11-01", logs: raw.logs, createdAt: 1 };
    }
    if (!st.active || !st.runs[st.active]) st.active = Object.keys(st.runs)[0] || null;
    delete st.settings.start;
    return st;
  }
  let S = load();
  function load() {
    try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw) return migrateState(raw); } catch (e) { /* ignora */ }
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  function save() {
    S.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* armazenamento local indisponível */ }
    cloudSave();
    updateTop();
  }

  // ---------- Cadastro (exercícios, treinos, sequências) ----------
  // Compartilhado: todos leem, só quem edita o app (Adm) altera. Padrão = November Shred.
  const CAT_KEY = "nsc_catalog_v1";
  function defaultCatalog() {
    const exercises = {};
    Object.entries(EXERCISES).forEach(([id, e]) => {
      exercises[id] = { name: e[1], alt: e[0], q: e[2], how: (HOWTO[id] || []).slice(), youtube: "", clip: (typeof CLIPS !== "undefined" && CLIPS[id]) || "" };
    });
    const workouts = {};
    const shredSrc = { name: "November Shred Challenge · @trainwithpb_", url: "https://www.instagram.com/trainwithpb_/" };
    WORKOUTS.forEach((w) => { const c = JSON.parse(JSON.stringify(w)); delete c.day; c.source = Object.assign({}, shredSrc); workouts["d" + w.day] = c; });
    return {
      v: 1, updatedAt: 0, exercises, workouts,
      warmup: WARMUP.map((x) => x.slice()),
      programs: {
        [SHRED_ID]: {
          name: "November Shred · 30 dias", kind: "days", days: WORKOUTS.map((w) => "d" + w.day), source: Object.assign({}, shredSrc),
          weekly: [null, null, null, null, null, null, null], weeks: 4,
          note: "O mesmo tipo de treino nunca cai em dias seguidos, e a cada 7 dias tem um Mobility & Core Flow mais leve para você se recuperar.",
        },
      },
    };
  }
  function loadCatalog() {
    try { const c = JSON.parse(localStorage.getItem(CAT_KEY)); if (c && c.exercises && c.workouts && c.programs) return c; } catch (e) {}
    return defaultCatalog();
  }
  let CAT = loadCatalog();
  const catDb = { doc: null };
  async function saveCatalog() {
    CAT.updatedAt = Date.now();
    try { localStorage.setItem(CAT_KEY, JSON.stringify(CAT)); } catch (e) {}
    activate();
    if (!catDb.doc) return true;
    try { await catDb.doc.set({ json: JSON.stringify(CAT), updatedAt: CAT.updatedAt }); return true; }
    catch (e) { toast("Não consegui salvar o cadastro: " + ((e && (e.code || e.message)) || "erro")); return false; }
  }
  let IS_ADMIN = !(window.claude && typeof window.claude.use === "function"); // fora do claude.ai: sempre Adm

  // ---------- Sequência ativa ----------
  let RUN = null, DAYS = [], TDAYS = [], LOGS = {}, WARM = [];
  function programDays(p, start) {
    if (!p) return [];
    if (p.kind === "weekly") {
      const out = [], d0 = parseDate(start || isoDate(new Date()));
      for (let i = 0; i < 7 * Math.max(1, +p.weeks || 1); i++) { const d = new Date(d0); d.setDate(d0.getDate() + i); out.push((p.weekly || [])[d.getDay()] || null); }
      return out;
    }
    return (p.days || []).slice();
  }
  function runDays(r) { return !r ? [] : r.kind === "single" ? [r.workoutId] : programDays(CAT.programs[r.programId], r.start); }
  function runName(r) {
    if (!r) return "";
    if (r.kind === "single") return "Avulso · " + (CAT.workouts[r.workoutId]?.name || "treino removido");
    return CAT.programs[r.programId]?.name || "Sequência removida";
  }
  function activate() {
    WARM = (CAT.warmup || []).filter(([id]) => CAT.exercises[id]);
    RUN = S.active ? S.runs[S.active] || null : null;
    if (RUN) { RUN.logs = RUN.logs || {}; }
    LOGS = RUN ? RUN.logs : {};
    DAYS = runDays(RUN);
    TDAYS = DAYS.map((id, i) => (id && CAT.workouts[id] ? Object.assign({}, CAT.workouts[id], { id, day: i + 1 }) : null)).filter(Boolean);
  }
  function WD(n) { return TDAYS.find((w) => w.day === n) || null; }
  const ROLES = { treino: "Treino", aquecimento: "Aquecimento", desaquecimento: "Desaquecimento" };
  const roleOf = (w) => (w && w.role) || "treino";
  // Aquecimento de um treino: o vinculado a ele, nenhum, ou o padrão do app
  function warmOf(w) {
    const def = (CAT.warmup || []).filter(([id]) => CAT.exercises[id]);
    if (!w || !w.warmupId) return def;
    if (w.warmupId === "none") return [];
    const wu = CAT.workouts[w.warmupId];
    if (!wu) return def;
    const list = (wu.ex || []).filter(([id]) => CAT.exercises[id]).map(([id, note]) => [id, note || ""]);
    return list.length ? list : [["__vid:" + w.warmupId, ""]];
  }
  const isVid = (id) => String(id).startsWith("__vid:");
  const vidItem = (id) => CAT.workouts[String(id).slice(6)] || null;
  function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function setActive(id) { S.active = id; save(); activate(); }

  // ---------- Sincronização na nuvem (quando publicado no claude.ai) ----------
  // Progresso por pessoa: data/users/<id>/state (privado). Cadastro: catalog/main (compartilhado).
  // Dados locais e da conta são sempre JUNTADOS, para que uma tela vazia não apague nada.
  const cloud = { doc: null, timer: null, writing: false, pending: false, status: "local", savedAt: 0, error: "" };
  function cloudSave() {
    if (!cloud.doc) return;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(cloudFlush, 1000);
  }
  async function cloudFlush() {
    if (!cloud.doc) return;
    if (cloud.writing) { cloud.pending = true; return; }
    cloud.writing = true;
    try {
      await cloud.doc.set({ json: JSON.stringify(S), updatedAt: S.updatedAt || Date.now() });
      cloud.status = "nuvem"; cloud.savedAt = Date.now(); cloud.error = "";
    } catch (e) { cloud.status = "erro"; cloud.error = (e && (e.code || e.message)) || "erro"; }
    cloud.writing = false; updateTop();
    if (cloud.pending) { cloud.pending = false; cloudFlush(); }
  }
  function logWeight(l) {
    if (!l) return -1;
    let w = l.done ? 1000 : 0;
    for (const arr of Object.values(l.sets || {})) w += (arr || []).filter(Boolean).length;
    w += (l.warm || []).filter(Boolean).length + (l.amrapRounds || 0) + Object.keys(l.ex || {}).length + Object.keys(l.dnotes || {}).length;
    if (l.startedAt) w += 1; if (l.notes) w += 1; if (l.rpe) w += 1;
    return w;
  }
  function mergeStates(a0, b0) {
    const a = migrateState(a0), b = migrateState(b0);
    // b = o mais recente; em empate de conteúdo, vence o mais recente
    const newer = (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a, older = newer === b ? a : b;
    const runs = {};
    new Set([...Object.keys(older.runs), ...Object.keys(newer.runs)]).forEach((id) => {
      const x = older.runs[id], y = newer.runs[id];
      if (!x || !y) { runs[id] = x || y; return; }
      const logs = {};
      new Set([...Object.keys(x.logs || {}), ...Object.keys(y.logs || {})]).forEach((d) => {
        const lx = x.logs?.[d], ly = y.logs?.[d];
        logs[d] = !lx ? ly : !ly ? lx : logWeight(lx) > logWeight(ly) ? lx : ly;
      });
      runs[id] = Object.assign({}, x, y, { logs });
    });
    const body = {};
    [...(older.body || []), ...(newer.body || [])].forEach((m) => { if (m && m.date) body[m.date] = m; });
    const active = (newer.active && runs[newer.active]) ? newer.active : (older.active && runs[older.active]) ? older.active : Object.keys(runs)[0] || null;
    return {
      settings: Object.assign({}, DEFAULT.settings, older.settings, newer.settings),
      runs, active, body: Object.values(body),
      videos: Object.assign({}, older.videos, newer.videos),
      updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
    };
  }
  async function cloudInit() {
    if (!window.claude || typeof window.claude.use !== "function") return;
    try {
      const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      if (user) { try { IS_ADMIN = !!(await user.canEdit()); } catch (e) { IS_ADMIN = false; } }
      if (!db || !user) { cloud.status = "sem-conta"; updateTop(); route(); return; }
      // Cadastro compartilhado
      let catChanged = false;
      try {
        catDb.doc = db.doc("catalog/main");
        const cs = await catDb.doc.get();
        const c = cs.exists ? cs.data() : null;
        if (c && c.json) {
          const parsed = JSON.parse(c.json);
          if (parsed && parsed.exercises && JSON.stringify(parsed) !== JSON.stringify(CAT)) { CAT = parsed; catChanged = true; }
          try { localStorage.setItem(CAT_KEY, JSON.stringify(CAT)); } catch (e) {}
        }
      } catch (e) { /* sem cadastro na nuvem: usa o padrão */ }
      // Progresso da pessoa
      const id = await user.id();
      if (!id) { cloud.status = "sem-conta"; activate(); updateTop(); route(); return; }
      const doc = db.doc(`data/users/${id}/state`);
      const snap = await doc.get();
      cloud.doc = doc;
      const remote = snap.exists ? snap.data() : null;
      let changedLocal = false;
      if (remote && remote.json) {
        const r = JSON.parse(remote.json); r.updatedAt = remote.updatedAt || r.updatedAt || 0;
        const merged = mergeStates(r, S);
        changedLocal = JSON.stringify(merged) !== JSON.stringify(S);
        S = merged;
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
      }
      activate();
      if (changedLocal || catChanged || IS_ADMIN) route();
      await cloudFlush();
    } catch (e) { cloud.status = "erro"; cloud.error = (e && (e.code || e.message)) || "erro"; }
    updateTop();
  }

  // ---------- Utilidades ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LEVELS = { beginner: "Iniciante", intermediate: "Intermediário", advanced: "Avançado" };
  const DOW = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function parseDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
  function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function dateOfDay(n) { const d = parseDate(RUN ? RUN.start : isoDate(new Date())); d.setDate(d.getDate() + n - 1); return d; }
  function fmtDate(d) { return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
  function todayIndex() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return RUN ? Math.round((t - parseDate(RUN.start)) / 86400000) + 1 : 1; // pode ser <1 ou > total
  }
  function currentDay() { return Math.min(Math.max(1, DAYS.length), Math.max(1, todayIndex())); }
  function ytSearch(q) { return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q); }
  // Nomes exibidos em inglês (e[1]); o português (e[0]) fica só para a busca
  function exInfo(id) {
    if (isVid(id)) { const it = vidItem(id); const nm = it ? it.name : "Vídeo"; return { id, pt: nm, en: nm, ptAlt: "", qEn: nm, qPt: nm }; }
    const e = CAT.exercises[id] || { name: id, alt: "", q: id };
    return { id, pt: e.name, en: e.name, ptAlt: e.alt || "", qEn: e.q || e.name, qPt: e.q || e.name };
  }
  function catOf(c) { return CATEGORIES[c] || CATEGORIES.full; }
  function getLog(n) { return LOGS[n] || null; }
  function ensureLog(n) {
    if (!RUN) return {};
    if (!LOGS[n]) LOGS[n] = { done: false, level: S.settings.level, bell: S.settings.bell, ex: {}, sets: {}, amrapRounds: 0, amrapReps: 0 };
    return LOGS[n];
  }
  const doneCount = () => TDAYS.filter((w) => LOGS[w.day]?.done).length;

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // Confirmação em dois toques (diálogos do navegador nem sempre aparecem)
  function armConfirm(btn, question, fn) {
    const label = btn.textContent;
    btn.onclick = () => {
      if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; fn(); return; }
      btn.dataset.armed = "1"; btn.textContent = question;
      setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; } }, 4000);
    };
  }

  // Descanso entre exercícios/séries: escolha global (0 = padrão do treino)
  const REST_OPTIONS = [15, 20, 30, 40, 45, 60, 75, 90, 120];
  function restOf(w) { return +S.settings.rest || w.rest || 30; }
  function restSelect(w) {
    const cur = +S.settings.rest || 0;
    return `<div class="restrow">
      <label class="restsel" title="Descanso entre exercícios">
        <span aria-hidden="true">⏱</span>
        <select id="restSel" aria-label="Descanso entre exercícios">
          ${[...new Set([...REST_OPTIONS, w.rest || 30])].sort((x, y) => x - y).map((v) => {
            const def = v === (w.rest || 30), sel = def ? (cur === 0 || cur === v) : cur === v;
            return `<option value="${def ? 0 : v}" ${sel ? "selected" : ""}>${v}s</option>`;
          }).join("")}
        </select>
      </label>
      <button type="button" class="btn ghost iconbtn" id="restTest" aria-label="Testar alarme do descanso" title="Testar alarme do descanso">🔊</button>
      <button type="button" class="btn primary" id="focusBtn">🎯 Modo foco</button>
    </div>`;
  }
  function hhmm(ms) { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

  // Ajusta a meta conforme o nível (regras do PDF)
  function target(w, level) {
    const adv = level === "advanced", beg = level === "beginner", mob = w.cat === "mobility";
    if (w.type === "sets") return { sets: beg ? w.sets - 1 : w.sets, reps: w.reps + (adv ? 2 : 0) };
    if (w.type === "interval") return { rounds: beg ? (mob ? 2 : w.rounds - 1) : adv ? w.rounds + 1 : w.rounds };
    return { plus: adv ? 2 : 0 };
  }
  function formatChips(w, t) {
    const c = [];
    if (w.type === "sets") c.push(`${t.sets} × ${t.reps}`, `Descanso ${restOf(w)}s`);
    if (w.type === "amrap") c.push(`AMRAP ${w.amrap}`);
    if (w.type === "interval") c.push(+w.gap > 0 ? `${w.work}s / ${w.gap}s × ${t.rounds} rounds` : `${w.work}s cada × ${t.rounds} rounds`, `Descanso ${restOf(w)}s`);
    c.push(`${w.min} min`);
    return c.map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  }
  function description(w, t) {
    const pre = w.cat === "mobility" ? "Kettlebell leve, lento e controlado. " : "";
    if (w.type === "sets") return `${t.sets} séries de ${t.reps} repetições de cada exercício. Descanse ${restOf(w)}s entre as séries e passe para o próximo.`;
    if (w.type === "amrap") return `Máximo de rounds possível em ${w.amrap} minutos. Faça as repetições indicadas e descanse só quando precisar. Anote seus rounds.`;
    return `${pre}${w.work} segundos em cada exercício${+w.gap > 0 ? `, com ${w.gap}s de descanso entre eles` : ", um atrás do outro"}. Descanse ${restOf(w)}s ao final de cada round. ${t.rounds} rounds.`;
  }
  function scalingKey(w) { return w.cat === "mobility" ? "mobility" : w.type; }

  // ---------- Áudio / tela ----------
  let actx = null, alarmEl = null, audioReady = false;
  function ctx() {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  function beep(freq = 880, dur = 0.12, vol = 0.25, at = 0) {
    if (!S.settings.sound) return;
    try {
      const c = ctx(), t0 = c.currentTime + at;
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = freq; o.type = "square";
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur);
    } catch (e) { /* sem áudio */ }
  }
  // Alarme em arquivo de áudio: no iPhone toca mesmo com o botão de silencioso ligado
  function alarmWav() {
    const rate = 22050, beeps = [[0, 0.22], [0.3, 0.22], [0.6, 0.45]], len = Math.ceil(rate * 1.1);
    const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
    const str = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + len * 2, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const t = i / rate; let a = 0;
      for (const [st, d] of beeps) if (t >= st && t < st + d) { const k = t - st; a = Math.min(1, k / 0.01, (d - k) / 0.02) * 0.85; }
      v.setInt16(44 + i * 2, Math.round(a * Math.sign(Math.sin(2 * Math.PI * 1320 * t)) * 0.6 * 32767), true);
    }
    let bin = ""; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return "data:audio/wav;base64," + btoa(bin);
  }
  function unlockAudio() {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    try { ctx(); } catch (e) {}
    if (audioReady) return;
    try {
      alarmEl = alarmEl || Object.assign(new Audio(alarmWav()), { preload: "auto" });
      alarmEl.muted = true;
      const pr = alarmEl.play();
      if (pr) pr.then(() => { alarmEl.pause(); alarmEl.currentTime = 0; alarmEl.muted = false; audioReady = true; }).catch(() => { alarmEl.muted = false; });
    } catch (e) {}
  }
  function alarm() {
    buzz([400, 150, 400, 150, 600]);
    if (!S.settings.sound) return;
    const web = () => { beep(1320, 0.2, 0.6, 0); beep(1320, 0.2, 0.6, 0.3); beep(1320, 0.45, 0.6, 0.6); };
    if (alarmEl && audioReady) {
      try { alarmEl.currentTime = 0; const pr = alarmEl.play(); if (pr) pr.catch(web); } catch (e) { web(); }
    } else web();
  }
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && "wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); }
      if (!on && wakeLock && !F.open) { await wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }

  // ---------- Timer ----------
  // segmentos: [{ phase: 'prep'|'work'|'rest', secs, label, sub, next }]
  const T = { segs: [], i: 0, endAt: 0, remain: 0, running: false, iv: null, onDone: null, lastSec: -1, mode: "" };
  function timerLoad(segs, mode, onDone) {
    timerStop(true);
    Object.assign(T, { segs, i: 0, remain: segs[0] ? segs[0].secs * 1000 : 0, running: false, onDone, onRound: null, lastSec: -1, mode });
    timerPaint();
  }
  function timerStart() {
    if (!T.segs.length || T.running) return;
    beep(660, 0.05, 0.01); // destrava o áudio no iOS
    T.running = true; T.endAt = Date.now() + T.remain;
    T.iv = setInterval(timerTick, 200); keepAwake(true); timerPaint();
  }
  function timerPause() {
    if (!T.running) return;
    T.running = false; T.remain = Math.max(0, T.endAt - Date.now());
    clearInterval(T.iv); keepAwake(false); timerPaint();
  }
  function timerStop(silent) {
    clearInterval(T.iv); T.running = false; keepAwake(false);
    if (!silent) { T.i = 0; T.remain = T.segs[0] ? T.segs[0].secs * 1000 : 0; timerPaint(); }
  }
  function segDone(seg) { if (seg && seg.endsRound && T.onRound) T.onRound(seg.endsRound); }
  function timerSkip() {
    if (T.i >= T.segs.length - 1) { finishTimer(); return; }
    segDone(T.segs[T.i]);
    T.i++; T.remain = T.segs[T.i].secs * 1000; T.endAt = Date.now() + T.remain; T.lastSec = -1;
    phaseCue(); timerPaint();
  }
  function phaseCue() {
    const s = T.segs[T.i];
    if (!s) return;
    if (s.phase === "work") { beep(1200, 0.25); buzz([200]); } else { beep(500, 0.3); buzz([100, 80, 100]); }
  }
  function timerTick() {
    T.remain = Math.max(0, T.endAt - Date.now());
    const sec = Math.ceil(T.remain / 1000);
    if (sec !== T.lastSec) {
      T.lastSec = sec;
      if (sec <= 3 && sec > 0) beep(880, 0.08);
    }
    if (T.remain <= 0) {
      if (T.i < T.segs.length - 1) { segDone(T.segs[T.i]); T.i++; T.remain = T.segs[T.i].secs * 1000; T.endAt = Date.now() + T.remain; T.lastSec = -1; phaseCue(); }
      else { finishTimer(); return; }
    }
    timerPaint();
  }
  function finishTimer() {
    segDone(T.segs[T.i]);
    clearInterval(T.iv); T.running = false; keepAwake(false);
    beep(1000, 0.6); buzz([300, 100, 300]);
    T.remain = 0; T.i = T.segs.length - 1; timerPaint(true);
    if (T.onDone) T.onDone();
  }
  function mmss(ms) {
    const s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}`;
  }
  function timerPaint(finished) {
    const box = $("#timerBox"); if (!box) return;
    const seg = T.segs[T.i] || { phase: "", secs: 0, label: "", sub: "" };
    const pct = seg.secs ? 100 - (T.remain / (seg.secs * 1000)) * 100 : 0;
    $(".phase", box).className = "phase " + seg.phase;
    $(".phase", box).textContent = finished ? (T.mode === "rest" ? "Bora! Próxima série" : "Finalizado! 💪") : { prep: "Prepare-se", work: "Vai!", rest: "Descanso" }[seg.phase] || "";
    $(".clock", box).textContent = finished ? "0" : mmss(T.remain);
    $(".now", box).textContent = seg.label || "";
    $(".next", box).textContent = seg.sub || "";
    $(".ring > i", box).style.width = (finished ? 100 : pct) + "%";
    const play = $("[data-t=play]", box);
    if (play) play.textContent = T.running ? "⏸ Pausar" : T.remain < seg.secs * 1000 && !finished ? "▶ Continuar" : "▶ Iniciar";
  }

  // ---------- Descanso ao lado do exercício ----------
  const R = { key: null, secs: 0, endAt: 0, remain: 0, running: false, iv: null, lastSec: -1, hideT: null };
  function restStart(key, secs) {
    restStop();
    Object.assign(R, { key: String(key), secs, remain: secs * 1000, endAt: Date.now() + secs * 1000, running: true, lastSec: -1 });
    beep(660, 0.05, 0.01); keepAwake(true);
    R.iv = setInterval(restTick, 200); restPaint();
  }
  function restStop() { clearInterval(R.iv); clearTimeout(R.hideT); R.running = false; R.key = null; restPaint(); if (!T.running) keepAwake(false); }
  function restToggle() {
    if (!R.key) return;
    if (R.running) { R.running = false; R.remain = Math.max(0, R.endAt - Date.now()); clearInterval(R.iv); }
    else if (R.remain > 0) { R.running = true; R.endAt = Date.now() + R.remain; R.iv = setInterval(restTick, 200); }
    restPaint();
  }
  function restTick() {
    R.remain = Math.max(0, R.endAt - Date.now());
    const sec = Math.ceil(R.remain / 1000);
    if (sec !== R.lastSec) { R.lastSec = sec; if (sec <= 3 && sec > 0) beep(880, 0.08); }
    if (R.remain <= 0) {
      clearInterval(R.iv); R.running = false; alarm(); toast("⏰ Descanso acabou! Bora!");
      restPaint(true);
      R.hideT = setTimeout(() => { R.key = null; restPaint(); }, 4000);
      if (!T.running) keepAwake(false);
      return;
    }
    restPaint();
  }
  function restPaint(finished) {
    $$("[data-rest]").forEach((el) => {
      const active = R.key !== null && el.dataset.rest === R.key;
      el.hidden = !active;
      if (!active) return;
      const done = finished || (!R.running && R.remain <= 0);
      el.classList.toggle("go", done);
      el.classList.toggle("paused", !R.running && !done);
      el.style.setProperty("--p", (done ? 100 : 100 - (R.remain / (R.secs * 1000)) * 100) + "%");
      el.textContent = done ? "✓ Bora!" : `⏱ ${mmss(R.remain)}${R.running ? "" : " ⏸"}`;
    });
  }

  // ---------- Router ----------
  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")) || "calendario";
    const cut = h.search(/[-/]/);
    const name = cut < 0 ? h : h.slice(0, cut), arg = cut < 0 ? "" : h.slice(cut + 1);
    timerStop(true); closeFocus();
    if (name !== "editar") ED = null;
    const warmN = (name === "dia" || name === "foco") ? +arg : RUN ? (RUN.kind === "single" ? 1 : currentDay()) : 0;
    WARM = warmOf(warmN ? WD(warmN) : null);
    if (!(name === "gerenciar" && arg === "aq")) WDRAFT = null;
    const tabOf = { dia: "calendario", foco: "calendario", exercicio: "enciclopedia", exercicios: "enciclopedia", treino: "enciclopedia", seq: "enciclopedia", nova: "hoje", avulso: "hoje", gerenciar: "ajustes", editar: "ajustes" };
    $$("#tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.tab === (tabOf[name] || name)));
    const v = $("#view");
    if (name === "dia" || name === "foco") { v.innerHTML = viewDay(+arg); if (RUN && WD(+arg)) { bindDay(+arg); if (name === "foco") openFocus(+arg); } }
    else if (name === "calendario") v.innerHTML = viewCalendar();
    else if (name === "progresso") { if (!RUN) v.innerHTML = viewNoRun(); else { v.innerHTML = viewProgress(); bindProgress(); } }
    else if (name === "exercicios" || name === "enciclopedia") { v.innerHTML = viewEnc(name === "exercicios" ? "ex" : arg); bindEnc(); }
    else if (name === "treino") { const id = dec(arg); v.innerHTML = viewWorkout(id); bindWorkout(id); }
    else if (name === "seq") { const id = dec(arg); v.innerHTML = viewProgram(id); bindProgram(id); }
    else if (name === "exercicio") { const id = arg.replace(/-/g, "_"); v.innerHTML = viewExercise(id); }
    else if (name === "ajustes") { v.innerHTML = viewSettings(); bindSettings(); }
    else if (name === "nova") { v.innerHTML = viewNew(); bindNew(); }
    else if (name === "avulso") { v.innerHTML = viewSingle(); bindSingle(); }
    else if (name === "gerenciar") { v.innerHTML = viewAdmin(arg); bindAdmin(arg); }
    else if (name === "editar") { v.innerHTML = viewEditor(arg); bindEditor(); }
    else { v.innerHTML = viewHome(); bindHome(); }
    window.scrollTo(0, 0);
    restPaint();
    updateTop();
  }
  function updateTop() {
    const ic = cloud.status === "nuvem" ? ' <span class="sync ok">☁︎ salvo</span>' : cloud.status === "erro" ? ' <span class="sync bad">⚠︎ não salvou</span>' : "";
    $("#topProgress").innerHTML = RUN ? `<b>${doneCount()}</b>/${TDAYS.length} treinos${ic}` : ic;
  }
  function syncLine() {
    if (cloud.status === "nuvem") return `<b class="lime">☁︎ Salvo na sua conta</b>${cloud.savedAt ? ` às ${hhmm(cloud.savedAt)}` : ""}. Também fica uma cópia neste aparelho.`;
    if (cloud.status === "erro" && /invalid|denied|permission|not_granted|writer/i.test(cloud.error)) return `<b style="color:var(--danger)">⚠︎ Seu acesso a este app é só de leitura.</b> Peça a quem compartilhou para te dar acesso de quem pode <b>usar/contribuir</b>, para salvar seu progresso. Por enquanto ele fica só neste aparelho.`;
    if (cloud.status === "erro") return `<b style="color:var(--danger)">⚠︎ Não consegui salvar na sua conta</b> (${esc(cloud.error)}). Seus dados estão só neste aparelho: exporte um backup.`;
    if (cloud.status === "sem-conta") return `<b style="color:var(--danger)">⚠︎ Sem conta conectada.</b> Seus dados estão só neste aparelho: exporte um backup.`;
    return `Seus dados ficam salvos neste aparelho/navegador. Exporte um backup de vez em quando.`;
  }

  // ---------- Views ----------
  function catStyle(cat) { return `--cat:${catOf(cat).color}`; }

  // ---------- Início: sequências e treinos avulsos ----------
  function runStats(r) {
    const days = runDays(r), logs = (r && r.logs) || {};
    let total = 0, done = 0;
    days.forEach((id, i) => { if (id && CAT.workouts[id]) { total++; if (logs[i + 1]?.done) done++; } });
    return { total, done, len: days.length };
  }
  function fmtShort(iso) { if (!iso) return ""; const d = parseDate(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
  function programDesc(p) {
    if (!p) return "";
    if (p.kind === "weekly") {
      const n = (p.weekly || []).filter(Boolean).length;
      return `${n}× por semana · ${p.weeks || 1} semana${(p.weeks || 1) > 1 ? "s" : ""}`;
    }
    const n = (p.days || []).length, t = (p.days || []).filter(Boolean).length;
    return `${n} dias · ${t} treinos`;
  }
  function runRow(id, r) {
    const st = runStats(r), on = id === S.active;
    const sub = r.kind === "single"
      ? `${fmtShort(r.start)} · ${r.logs?.[1]?.done ? "✓ feito" : "não concluído"}`
      : `Início ${fmtShort(r.start)} · ${st.done}/${st.total} treinos`;
    return `<div class="runrow ${on ? "on" : ""}">
      <div class="runinfo"><b>${esc(runName(r))}</b><span class="small muted">${sub}</span></div>
      <button type="button" class="btn sm ${on ? "" : "primary"}" data-openrun="${id}">${on ? "Abrir" : "Usar"}</button>
      <button type="button" class="btn sm ghost" data-delrun="${id}" aria-label="Remover">✕</button>
    </div>`;
  }
  function todayBlock() {
    if (!RUN) return "";
    if (RUN.kind === "single") {
      const w = WD(1); if (!w) return `<div class="card">Este treino foi removido do cadastro.</div>`;
      return workoutCard(w, 1, `Treino avulso · ${fmtDate(dateOfDay(1))}`);
    }
    const idx = todayIndex(), N = DAYS.length, n = currentDay(), w = WD(n);
    let head;
    if (idx < 1) head = `<div class="eyebrow">Começa em ${1 - idx} dia(s)</div>`;
    else if (idx > N) head = `<div class="eyebrow">Sequência encerrada · refaça qualquer dia pelo calendário</div>`;
    else head = `<div class="eyebrow">Dia ${n} de ${N} · ${fmtDate(dateOfDay(n))}</div>`;
    const next = TDAYS.find((x) => !LOGS[x.day]?.done);
    const body = w ? workoutCard(w, n, "Treino de hoje")
      : `<div class="card"><h2>Dia ${n} · Descanso</h2><p class="muted small">Recupere-se. ${next ? `Próximo treino: Dia ${next.day} · ${esc(next.name)}.` : ""}</p></div>`;
    return `${head}<h1>${esc(runName(RUN))}</h1><div class="section"></div>${body}
      ${next && next.day !== n ? `<a class="btn ghost block" href="#dia-${next.day}">Próximo pendente: Dia ${next.day} · ${esc(next.name)}</a>` : ""}
      ${statsBlock()}`;
  }
  function workoutCard(w, n, label) {
    const log = getLog(n), t = target(w, S.settings.level);
    return `
      <a href="#dia-${n}" style="text-decoration:none;color:inherit">
        <div class="card accent" style="${catStyle(w.cat)}">
          <div class="row"><span class="tag" style="${catStyle(w.cat)}">${esc(catOf(w.cat).label)}</span>${log?.done ? '<span class="lime small" style="font-weight:800">✓ Concluído</span>' : ""}</div>
          <div class="eyebrow" style="margin-top:10px">${esc(label)}</div>
          <h2>${RUN && RUN.kind !== "single" ? `Dia ${n} · ` : ""}${esc(w.name)}</h2>
          <div class="chips">${formatChips(w, t)}</div>
          <ol class="small muted" style="margin:6px 0 12px;padding-left:18px">${w.ex.map(([id]) => `<li>${esc(exInfo(id).pt)}</li>`).join("")}</ol>
          <span class="btn primary block">${log?.done ? "Ver / editar registro" : "Começar treino →"}</span>
        </div>
      </a>
      <a class="btn ghost block" href="#foco-${n}" style="margin-bottom:8px">🎯 Treinar em modo foco</a>`;
  }
  function viewHome() {
    const all = Object.entries(S.runs).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const seqs = all.filter(([, r]) => r.kind !== "single"), singles = all.filter(([, r]) => r.kind === "single").slice(0, 10);
    const top = RUN ? todayBlock()
      : `<div class="eyebrow">Bem-vindo</div><h1>Escolha seu treino</h1><p class="muted">Comece uma sequência ou faça um treino avulso.</p>`;
    const n = RUN ? (RUN.kind === "single" ? 1 : currentDay()) : 0;
    return `
      ${top}
      <div class="section"><h3>Começar</h3></div>
      <div class="grid2"><a class="btn primary" href="#nova">＋ Sequência</a><a class="btn ghost" href="#avulso">🏋️ Treino avulso</a></div>
      <a class="btn ghost block" href="#enciclopedia" style="margin-top:8px">📚 Explorar a enciclopédia</a>
      ${seqs.length ? `<div class="section"><h3>Minhas sequências</h3></div><div class="card runlist">${seqs.map(([id, r]) => runRow(id, r)).join("")}</div>` : ""}
      ${singles.length ? `<div class="section"><h3>Treinos avulsos</h3></div><div class="card runlist">${singles.map(([id, r]) => runRow(id, r)).join("")}</div>` : ""}
      ${RUN && WD(n) ? `<div class="section"><h3>Antes de começar</h3></div>${warmupDay(getLog(n) || {})}` : ""}
      <div class="card small">
        <b class="lime">Guia de kettlebell</b><br>
        Iniciante: 6–12 kg · Intermediário: 12–16 kg · Avançado: 16–24 kg<br>
        <span class="muted">Qualidade vence velocidade. Pare se sentir dor aguda.</span>
      </div>`;
  }
  function bindHome() {
    if (RUN && WD(RUN.kind === "single" ? 1 : currentDay())) bindToday();
    $$("[data-openrun]").forEach((b) => (b.onclick = () => {
      const id = b.dataset.openrun, r = S.runs[id]; if (!r) return;
      setActive(id); location.hash = r.kind === "single" ? "dia-1" : "calendario";
    }));
    $$("[data-delrun]").forEach((b) => (b.onclick = () => {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Remover?"; b.classList.add("danger"); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "✕"; b.classList.remove("danger"); } }, 4000); return; }
      const id = b.dataset.delrun; delete S.runs[id];
      if (S.active === id) S.active = Object.keys(S.runs)[0] || null;
      save(); activate(); toast("Removido"); route();
    }));
  }
  function viewNoRun() {
    return `<div class="eyebrow">Nenhuma sequência ativa</div><h1>Escolha seu treino</h1>
      <p class="muted">Comece uma sequência (com calendário) ou faça um treino avulso hoje.</p>
      <div class="grid2"><a class="btn primary" href="#nova">＋ Sequência</a><a class="btn ghost" href="#avulso">🏋️ Treino avulso</a></div>`;
  }

  // Nova sequência
  function viewNew() {
    const progs = Object.entries(CAT.programs);
    const today = isoDate(new Date());
    return `<a class="btn sm ghost" href="#hoje">← Início</a><div class="section"></div>
      <div class="eyebrow">Nova sequência</div><h1>Escolha a sequência</h1>
      <p class="small muted">Escolha a data do Dia 1. Você pode ter várias sequências e trocar entre elas no Início.</p>
      ${progs.length ? progs.map(([pid, p]) => {
        const mine = Object.entries(S.runs).filter(([, r]) => r.kind !== "single" && r.programId === pid);
        return `<div class="card">
          <h2>${esc(p.name)}</h2>
          <div class="small muted" style="margin:4px 0 8px">${esc(programDesc(p))}</div>
          ${p.note ? `<p class="small" style="margin:0 0 10px">${esc(p.note)}</p>` : ""}
          ${mine.length ? `<p class="small lime" style="margin:0 0 10px">Você já tem ${mine.length > 1 ? mine.length + " rodadas" : "esta sequência"} (${mine.map(([, r]) => { const s = runStats(r); return `${s.done}/${s.total}`; }).join(", ")}). Começar de novo cria uma rodada nova.</p>` : ""}
          <div class="row"><label class="f grow" style="margin:0">Dia 1 em<input type="date" data-pstart="${pid}" value="${today}"></label>
          <button type="button" class="btn primary" data-pgo="${pid}" style="align-self:flex-end">Começar</button></div>
        </div>`;
      }).join("") : `<div class="card muted">Nenhuma sequência cadastrada ainda.</div>`}`;
  }
  function bindNew() {
    $$("[data-pgo]").forEach((b) => (b.onclick = () => {
      const pid = b.dataset.pgo, start = $(`[data-pstart="${pid}"]`).value || isoDate(new Date());
      const id = newId("r");
      S.runs[id] = { kind: "program", programId: pid, start, logs: {}, createdAt: Date.now() };
      setActive(id); toast("Sequência iniciada"); location.hash = "calendario";
    }));
  }

  // Treino avulso
  function viewSingle() {
    const groups = {};
    Object.entries(CAT.workouts).filter(([, w]) => roleOf(w) === "treino").forEach(([id, w]) => { (groups[w.cat] = groups[w.cat] || []).push([id, w]); });
    return `<a class="btn sm ghost" href="#hoje">← Início</a><div class="section"></div>
      <div class="eyebrow">Treino avulso</div><h1>Escolha o treino</h1>
      <input class="search" id="wSearch" type="search" placeholder="Buscar treino…">
      ${Object.keys(CATEGORIES).filter((c) => groups[c]).map((c) => `
        <div class="wgroup"><div class="section"><h3 style="color:${CATEGORIES[c].color}">${esc(CATEGORIES[c].label)}</h3></div>
        <div class="card runlist">${groups[c].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, w]) => `
          <div class="runrow" data-wname="${esc(w.name.toLowerCase())}">
            <div class="runinfo"><b>${esc(w.name)}</b><span class="small muted">${w.ex.length ? `${esc(fmtLine(w))} · ${w.ex.length} exercícios` : "🎬 vídeo para acompanhar"}</span></div>
            <button type="button" class="btn sm primary" data-single="${id}">Fazer</button>
          </div>`).join("")}</div></div>`).join("")}`;
  }
  function fmtLine(w) {
    if (w.type === "sets") return `${w.sets}×${w.reps} · ${w.min} min`;
    if (w.type === "amrap") return `AMRAP ${w.amrap} · ${w.min} min`;
    return `${w.work}s × ${w.rounds} rounds · ${w.min} min`;
  }
  function bindSingle() {
    $("#wSearch").oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $$("[data-wname]").forEach((r) => (r.hidden = !r.dataset.wname.includes(q)));
      $$(".wgroup").forEach((g) => (g.hidden = !$$("[data-wname]", g).some((r) => !r.hidden)));
    };
    $$("[data-single]").forEach((b) => (b.onclick = () => {
      const id = newId("s");
      S.runs[id] = { kind: "single", workoutId: b.dataset.single, start: isoDate(new Date()), logs: {}, createdAt: Date.now() };
      setActive(id); location.hash = "dia-1";
    }));
  }

  function statsBlock() {
    const d = doneCount();
    return `
      <div class="section"></div>
      <div class="stats">
        <div class="stat"><div class="v">${d}</div><div class="l">Concluídos</div></div>
        <div class="stat"><div class="v">${streak()}</div><div class="l">Sequência</div></div>
        <div class="stat"><div class="v">${totalMinutes()}</div><div class="l">Minutos</div></div>
      </div>
      <div class="bar"><i style="width:${TDAYS.length ? (d / TDAYS.length) * 100 : 0}%"></i></div>`;
  }
  function streak() {
    // dias consecutivos concluídos terminando no último dia já liberado
    const maxDone = Math.max(0, ...TDAYS.filter((w) => LOGS[w.day]?.done).map((w) => w.day));
    let s = 0, last = Math.min(DAYS.length, Math.max(0, todayIndex(), maxDone));
    if (last >= 1 && !LOGS[last]?.done) last--; // hoje ainda pode ser feito
    for (let d = last; d >= 1; d--) { if (!WD(d)) continue; if (LOGS[d]?.done) s++; else break; } // dias de descanso não quebram
    return s;
  }
  function totalMinutes() {
    return TDAYS.reduce((a, w) => a + (LOGS[w.day]?.done ? +(LOGS[w.day].duration || w.min) : 0), 0);
  }

  // Dentro do claude.ai a página não pode embutir sites externos (YouTube incluso):
  // lá o vídeo salvo abre no YouTube. Hospedado em outro lugar, ele toca na própria página.
  const CAN_EMBED = !(window.claude && typeof window.claude.use === "function");
  function ytId(url) {
    if (!url) return null;
    const v = String(url).trim();
    if (/^[\w-]{11}$/.test(v)) return v;
    const m = v.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/|\/v\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function warmupDay(log) {
    const wd = log.warm || [];
    if (!WARM.length) return "";
    const all = WARM.every((_, k) => wd[k]);
    return `
      <details class="card" ${all ? "" : "open"} id="warmCard">
        <summary>🔥 Aquecimento <span class="lime small" id="warmCount">${WARM.filter((_, k) => wd[k]).length}/${WARM.length}</span></summary>
        <p class="small muted" style="margin:8px 0 0">Kettlebell leve. Toque no ✓ ao terminar cada exercício: o descanso começa ao lado. O primeiro ✓ marca o início do treino.</p>
        ${WARM.map(([id, note], k) => exRow(id, k + 1, note, "",
          `<div class="log side"><button type="button" class="setbox ${wd[k] ? "on" : ""}" data-warm="${k}" aria-label="Feito">✓</button><button type="button" class="restpill" data-rest="w${k}" hidden></button></div>`)).join("")}
      </details>`;
  }

  function videoButtons(id) {
    return `<div class="vidwrap" data-vw="${id}">${videoInner(id)}</div>`;
  }
  function videoInner(id) {
    if (isVid(id)) {
      const u = videoOf(id), v = ytId(u);
      return `<div class="vids">${u ? `<a class="vbtn yt" href="${esc(v ? "https://www.youtube.com/watch?v=" + v : u)}" target="_blank" rel="noopener">▶ Assistir vídeo</a>` : '<span class="small muted">Sem vídeo cadastrado</span>'}</div>`;
    }
    const e = exInfo(id), vid = ytId(videoOf(id));
    const mine = vid
      ? (CAN_EMBED
          ? `<button type="button" class="vbtn yt" data-play="${id}">▶ YouTube</button>`
          : `<a class="vbtn yt" href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener">▶ YouTube</a>`)
      : "";
    const clip = clipOf(id);
    return `<div class="vids">
        ${clip ? `<button type="button" class="vbtn pin" data-clip="${id}">🎬 Demo</button>` : ""}
        ${mine}
        ${vid ? "" : `<a class="vbtn" href="${ytSearch(e.qEn)}" target="_blank" rel="noopener">🔎 Buscar</a>`}
        <button type="button" class="vbtn ghostv" data-paste="${id}">${vid ? "✎ Trocar" : "＋ Colar link"}</button>
      </div>
      <div class="player" data-player hidden></div>
      <div class="pastebox" data-pastebox hidden>
        <input type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Cole aqui o link do YouTube" value="${esc(S.videos[id] || "")}">
        <div class="row">
          <button type="button" class="btn primary sm" data-pastesave="${id}">Salvar vídeo</button>
          ${vid ? `<button type="button" class="btn ghost sm" data-pastedel="${id}">Remover</button>` : ""}
          <button type="button" class="btn ghost sm" data-pastecancel>Cancelar</button>
        </div>
      </div>`;
  }
  // Vídeos de demonstração enviados (tocam dentro do app)
  function clipOf(id) { return (CAT.exercises[id] && CAT.exercises[id].clip) || null; }
  function clipTag(id, cls) {
    return `<video class="${cls || "clip"}" src="${esc(clipOf(id))}" muted autoplay loop playsinline preload="auto" aria-label="Demonstração: ${esc(exInfo(id).pt)}"></video>`;
  }
  function videoOf(id) {
    if (isVid(id)) { const it = vidItem(id); return (it && it.video && it.video.url) || ""; }
    return S.videos[id] || (CAT.exercises[id] && CAT.exercises[id].youtube) || "";
  }
  function refreshVideos(id) { $$(`[data-vw="${id}"]`).forEach((el) => (el.innerHTML = videoInner(id))); }
  function onVideoClick(ev) {
    const b = ev.target.closest("[data-clip],[data-play],[data-paste],[data-pastesave],[data-pastedel],[data-pastecancel]");
    if (!b) return;
    const wrap = b.closest(".vidwrap"); if (!wrap) return;
    const id = wrap.dataset.vw, box = $("[data-pastebox]", wrap), player = $("[data-player]", wrap);
    if (b.dataset.clip) {
      if (!player.hidden && player.dataset.kind === "clip") { player.hidden = true; player.innerHTML = ""; b.textContent = "🎬 Demo"; return; }
      player.innerHTML = clipTag(id); player.dataset.kind = "clip"; player.hidden = false; b.textContent = "✕ Fechar";
      return;
    }
    if (b.dataset.play) {
      player.dataset.kind = "yt";
      if (!player.hidden) { player.hidden = true; player.innerHTML = ""; b.textContent = "▶ YouTube"; return; }
      const vid = ytId(videoOf(id));
      player.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${vid}?rel=0&playsinline=1&autoplay=1" title="${esc(exInfo(id).pt)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      player.hidden = false; b.textContent = "✕ Fechar";
    } else if (b.dataset.paste) {
      box.hidden = !box.hidden; if (!box.hidden) $("input", box).focus();
    } else if (b.dataset.pastesave) {
      const v = $("input", box).value.trim();
      if (!v) { toast("Cole o link do vídeo primeiro"); return; }
      const vid = ytId(v);
      if (!vid) { toast("Não reconheci esse link. Use um link do YouTube."); return; }
      S.videos[id] = `https://www.youtube.com/watch?v=${vid}`; save(); refreshVideos(id);
      toast(CAN_EMBED ? "Vídeo salvo. Toque em ▶ Assistir aqui" : "Vídeo salvo. Toque em ▶ Meu vídeo");
    } else if (b.dataset.pastedel) {
      delete S.videos[id]; save(); refreshVideos(id); toast("Vídeo removido");
    } else if (b.hasAttribute("data-pastecancel")) {
      box.hidden = true;
    }
  }
  function exRow(id, i, note, targetTxt, extra = "") {
    const e = exInfo(id), side = extra.includes('class="log side"');
    return `<div class="ex">
      <div class="i">${i}</div>
      <div class="exmain">
        <div class="exhead">
          <a class="name" href="${isVid(id) ? "#treino-" + String(id).slice(6).replace(/_/g, "-") : "#exercicio-" + id.replace(/_/g, "-")}">${esc(e.pt)}</a>
          ${targetTxt ? `<span class="target">${esc(targetTxt)}</span>` : ""}
          ${note ? `<span class="orig">${esc(note)}</span>` : ""}
        </div>
        ${videoButtons(id)}
        ${side ? "" : extra}
      </div>
      ${side ? extra : ""}
    </div>`;
  }

  function viewCalendar() {
    if (!RUN) return viewNoRun();
    const N = DAYS.length, today = todayIndex(), single = RUN.kind === "single";
    let cells = "";
    if (!single) {
      cells = DOW.map((d) => `<div class="dow">${d}</div>`).join("");
      for (let i = 0; i < dateOfDay(1).getDay(); i++) cells += "<div></div>";
      for (let n = 1; n <= N; n++) {
        const w = WD(n);
        if (!w) { cells += `<span class="restday ${n === today ? "today" : ""}"><span class="n">${n}</span><span class="t">Descanso</span></span>`; continue; }
        const cls = [LOGS[n]?.done ? "done" : "", n === today ? "today" : ""].join(" ");
        cells += `<a href="#dia-${n}" class="${cls}" style="${catStyle(w.cat)}"><span class="n">${n}</span><span class="t">${esc(w.name)}</span></a>`;
      }
    }
    const used = [...new Set(TDAYS.map((w) => w.cat))];
    const legend = used.map((c) => `<span style="--c:${catOf(c).color}">${esc(catOf(c).label)}</span>`).join("");
    const list = TDAYS.map((w) => `
      <a href="#dia-${w.day}" style="${catStyle(w.cat)}">
        <span class="num">${w.day}</span>
        <span><b>${esc(w.name)}</b><br><span class="small muted">${fmtDate(dateOfDay(w.day))} · ${esc(catOf(w.cat).label)} · ${w.min} min</span></span>
        <span class="check">${LOGS[w.day]?.done ? "✓" : ""}</span>
      </a>`).join("");
    const p = CAT.programs[RUN.programId];
    return `
      <div class="row" style="justify-content:space-between"><div class="eyebrow" style="margin:0">${single ? "Treino avulso" : `Sequência · ${N} dias`}</div><a class="btn sm ghost" href="#hoje">Trocar</a></div>
      <h1>${esc(runName(RUN))}</h1>
      ${single ? "" : `<div class="section"></div><div class="cal">${cells}</div><div class="legend">${legend}</div>`}
      ${p && p.note && !single ? `<div class="card small" style="margin-top:14px">${esc(p.note)}</div>` : ""}
      <div class="section"><h3>${single ? "Treino" : "Todos os treinos"}</h3></div>
      <div class="wlist">${list || '<p class="muted">Nenhum treino nesta sequência.</p>'}</div>`;
  }

  function viewDay(n) {
    if (!RUN) return viewNoRun();
    const w = WD(n);
    if (!w) {
      if (n < 1 || n > DAYS.length) return `<p>Dia inválido.</p>`;
      return `<div class="row" style="justify-content:space-between;margin-bottom:10px">${n > 1 ? `<a class="btn sm ghost" href="#dia-${n - 1}">← Dia ${n - 1}</a>` : "<span></span>"}${n < DAYS.length ? `<a class="btn sm ghost" href="#dia-${n + 1}">Dia ${n + 1} →</a>` : "<span></span>"}</div>
        <div class="card"><div class="eyebrow">Dia ${n} · ${fmtDate(dateOfDay(n))}</div><h1>Descanso</h1><p class="muted">Dia livre nesta sequência. Recupere-se para o próximo treino.</p></div>`;
    }
    const log = getLog(n) || {};
    const level = log.level || S.settings.level;
    const t = target(w, level);
    const sk = SCALING[scalingKey(w)];

    const rows = w.ex.map(([id, note, reps], i) => {
      let tgt = "", extra = "";
      if (w.type === "amrap") tgt = `x${reps + t.plus}`;
      if (w.type === "sets") {
        const done = (log.sets && log.sets[i]) || [];
        const boxes = Array.from({ length: t.sets }, (_, s) => `<button class="setbox ${done[s] ? "on" : ""}" data-set="${i}:${s}" aria-label="Série ${s + 1}">${s + 1}</button>`).join("");
        extra = `<div class="log"><div class="sets">${boxes}</div><button type="button" class="restpill" data-rest="s${i}" hidden></button>
          <span>reps/série <input class="mini" type="number" inputmode="numeric" min="0" data-exreps="${i}" value="${esc(log.ex?.[i] ?? "")}" placeholder="${t.reps}"></span></div>`;
      }
      if (w.type === "interval") {
        extra = `<div class="log">reps em ${w.work}s (melhor round) <input class="mini" type="number" inputmode="numeric" min="0" data-exreps="${i}" value="${esc(log.ex?.[i] ?? "")}" placeholder="—"></div>`;
      }
      return exRow(id, i + 1, note, tgt, extra);
    }).join("");

    const single = RUN.kind === "single";
    const prev = !single && n > 1 ? `<a class="btn sm ghost" href="#dia-${n - 1}">← Dia ${n - 1}</a>` : `<a class="btn sm ghost" href="#hoje">← Início</a>`;
    const nxt = !single && n < DAYS.length ? `<a class="btn sm ghost" href="#dia-${n + 1}">Dia ${n + 1} →</a>` : "<span></span>";

    return `
      <div class="row" style="justify-content:space-between;margin-bottom:10px">${prev}${nxt}</div>
      <div class="card accent" style="${catStyle(w.cat)}">
        <div class="row" style="justify-content:space-between">
          <span class="tag" style="${catStyle(w.cat)}">${esc(catOf(w.cat).label)}</span>
          <span class="small muted">${fmtDate(dateOfDay(n))}</span>
        </div>
        <div class="eyebrow" style="margin-top:12px">${single ? "Treino avulso" : `${esc(runName(RUN))} · Dia ${n}`}</div>
        <h1>${esc(w.name)}</h1>
        <div class="chips">${formatChips(w, t)}</div>
        <p class="small muted" style="margin:6px 0 10px">${esc(description(w, t))}</p>
        <div class="seg" id="levelSeg">${Object.entries(LEVELS).map(([k, v]) => `<button data-level="${k}" class="${k === level ? "on" : ""}">${v}</button>`).join("")}</div>
        ${restSelect(w)}
      </div>

      ${warmupDay(log)}

      <div class="card">
        <h3>Exercícios</h3>
        ${rows}
      </div>

      <div class="card">
        <div class="scale">
          <div class="${level === "beginner" ? "on" : ""}"><b>INICIANTE</b>${esc(sk.beginner)}</div>
          <div class="${level === "advanced" ? "on" : ""}"><b>AVANÇADO</b>${esc(sk.advanced)}</div>
        </div>
      </div>

      ${w.type === "sets" ? "" : timerBlock(w, t, log)}

      ${coolCard(w, log)}

      <div class="card" id="diaryCard">
        <div class="row" style="justify-content:space-between">
          <h3>📓 Diário de bordo</h3>
          <button type="button" class="btn sm ghost" id="diaryCopy">Copiar texto</button>
        </div>
        <p class="small muted" style="margin:6px 0 0">Vai sendo preenchido sozinho com o horário de cada ✓, série e round. Escreva suas observações no campo de cada exercício.</p>
        <div id="diary">${diaryHtml(n)}</div>
        <textarea id="diaryText" class="diarytext" readonly hidden></textarea>
      </div>

      ${logForm(w, n, log, level)}`;
  }

  function coolCard(w, log) {
    const cd = w.cooldownId && CAT.workouts[w.cooldownId];
    if (!cd) return "";
    const list = (cd.ex || []).filter(([id]) => CAT.exercises[id]);
    return `<details class="card" id="coolCard" ${log.cool ? "" : "open"}>
      <summary>🧊 Desaquecimento <span class="lime small">${log.cool ? "✓" : ""}</span></summary>
      <div class="ex"><div class="i">↓</div><div class="exmain"><div class="exhead"><a class="name" href="#treino-${String(w.cooldownId).replace(/_/g, "-")}">${esc(cd.name)}</a></div>${videoButtons("__vid:" + w.cooldownId)}</div>
        <div class="log side"><button type="button" class="setbox ${log.cool ? "on" : ""}" id="coolTick" aria-label="Desaquecimento feito">✓</button></div></div>
      ${list.map(([id, note], i) => exRow(id, i + 1, note, "")).join("")}
    </details>`;
  }

  // ---------- Diário de bordo ----------
  function diaryEntries(n) {
    const w = WD(n), l = getLog(n) || {}, t = target(w, l.level || S.settings.level);
    const out = [];
    WARM.forEach(([id, note], k) => {
      const at = l.warmAt?.[k];
      out.push({ key: "w" + k, title: `Aquecimento ${k + 1} - ${exInfo(id).pt}`, id, note,
        lines: [{ label: "Feito", at, done: !!l.warm?.[k] }] });
    });
    w.ex.forEach(([id, note, reps], i) => {
      const lines = [];
      if (w.type === "sets") {
        for (let s = 0; s < t.sets; s++) lines.push({ label: `Série ${s + 1}`, at: l.setAt?.[i]?.[s], done: !!l.sets?.[i]?.[s] });
      }
      const extra = w.type === "amrap" ? `x${reps + t.plus}` : l.ex?.[i] != null ? (w.type === "sets" ? `${l.ex[i]} reps/série` : `${l.ex[i]} reps em ${w.work}s`) : "";
      out.push({ key: "e" + i, title: `Exercício ${i + 1} - ${exInfo(id).pt}`, id, note: [note, extra].filter(Boolean).join(" · "), lines });
    });
    const rounds = [];
    if (w.type === "amrap") (l.roundAt || []).forEach((at, r) => rounds.push({ label: `Round ${r + 1}`, at, done: true }));
    if (w.type === "interval") for (let r = 0; r < t.rounds; r++) rounds.push({ label: `Round ${r + 1}`, at: l.roundAt?.[r], done: !!l.roundAt?.[r] });
    return { out, rounds, l };
  }
  function diaryHtml(n) {
    const { out, rounds, l } = diaryEntries(n);
    const lineHtml = (x) => `<div class="dl ${x.done ? "on" : ""}"><span>${esc(x.label)}</span><span>›</span><b>${x.at ? hhmm(x.at) : x.done ? "feito (sem horário)" : "—"}</b></div>`;
    const head = l.startedAt ? `<div class="dhead">Início <b>${hhmm(l.startedAt)}</b>${l.endedAt ? ` · Fim <b>${hhmm(l.endedAt)}</b> · ${Math.max(1, Math.round((l.endedAt - l.startedAt) / 60000))} min` : ""}</div>` : "";
    const items = out.map((e) => {
      const url = videoOf(e.id);
      return `<div class="ditem">
        <div class="dtitle">${esc(e.title)}${e.note ? ` <span class="muted small">(${esc(e.note)})</span>` : ""}</div>
        <div class="small">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : `<span class="muted">Sem vídeo salvo</span>`}</div>
        <textarea class="dnote" data-dnote="${e.key}" rows="1" placeholder="Observações (carga, sensação, ajuste…)">${esc(l.dnotes?.[e.key] || "")}</textarea>
        ${e.lines.map(lineHtml).join("")}
      </div>`;
    }).join("");
    const rnd = rounds.length ? `<div class="ditem"><div class="dtitle">Rounds</div>${rounds.map(lineHtml).join("")}</div>` : "";
    return head + items + rnd;
  }
  function diaryText(n) {
    const w = WD(n), { out, rounds, l } = diaryEntries(n);
    const ln = (x) => `${x.label} > ${x.at ? hhmm(x.at) : x.done ? "(sem horário)" : "—"}`;
    const parts = [`DIA ${n} - ${w.name} (${fmtDate(dateOfDay(n))})`];
    if (l.startedAt) parts.push(`Início ${hhmm(l.startedAt)}${l.endedAt ? ` · Fim ${hhmm(l.endedAt)}` : ""}`);
    out.forEach((e) => parts.push([e.title + (e.note ? ` (${e.note})` : ""), videoOf(e.id) || "Sem vídeo", l.dnotes?.[e.key] || "", ...e.lines.map(ln)].filter((x) => x !== "").join("\n")));
    if (rounds.length) parts.push(["Rounds", ...rounds.map(ln)].join("\n"));
    return parts.join("\n\n");
  }
  function renderDiary(n) {
    const el = $("#diary"); if (!el) return;
    el.innerHTML = diaryHtml(n); bindDiary(n);
  }
  function bindDiary(n) {
    $$("[data-dnote]").forEach((ta) => {
      const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
      fit();
      ta.oninput = () => {
        fit();
        const l = ensureLog(n); l.dnotes = l.dnotes || {};
        if (ta.value.trim()) l.dnotes[ta.dataset.dnote] = ta.value; else delete l.dnotes[ta.dataset.dnote];
        clearTimeout(bindDiary.t); bindDiary.t = setTimeout(save, 600);
      };
      ta.onblur = () => { clearTimeout(bindDiary.t); save(); };
    });
    const c = $("#diaryCopy");
    if (c) c.onclick = async () => {
      const txt = diaryText(n);
      try { await navigator.clipboard.writeText(txt); toast("Diário copiado"); }
      catch (e) { const ta = $("#diaryText"); ta.value = txt; ta.hidden = false; ta.focus(); ta.select(); toast("Selecione e copie o texto abaixo"); }
    };
  }

  function timerBlock(w, t, log) {
    let extra = "";
    if (w.type === "amrap") {
      extra = `<div class="row" style="justify-content:center;margin-top:12px">
        <button class="btn" data-round="-1">−1</button>
        <div style="min-width:110px"><div class="rounds" id="roundCount">${log.amrapRounds || 0}</div><div class="small muted">rounds</div></div>
        <button class="btn primary" data-round="1">+1 Round</button></div>`;
    }
    const title = w.type === "amrap" ? `Timer AMRAP ${w.amrap} min` : `Timer intervalado`;
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between"><h3>⏱ ${esc(title)}</h3><button class="btn sm ghost" data-t="fs">⛶ Tela cheia</button></div>
        <div style="height:10px"></div>
        <div class="timer" id="timerBox">
          <div class="phase"></div>
          <div class="clock">0</div>
          <div class="now"></div>
          <div class="next"></div>
          <div class="ring"><i></i></div>
          <div class="row" style="justify-content:center">
            <button class="btn primary" data-t="play">▶ Iniciar</button>
            <button class="btn" data-t="skip">⏭ Pular</button>
            <button class="btn ghost" data-t="reset">↺</button>
            <button class="btn ghost" data-t="exitfs" style="display:none">✕ Sair</button>
          </div>
          ${extra}
        </div>
      </div>`;
  }

  function timesHtml(w, log) {
    const endHint = w.type === "sets" ? "na última série do último exercício" : "quando o timer terminar";
    if (!log.startedAt) return `<span class="muted">⏱ O horário começa no primeiro ✓ do aquecimento e termina ${endHint}.</span>`;
    const end = log.endedAt ? hhmm(log.endedAt) : "em andamento…";
    const mins = log.endedAt ? ` · <b class="lime">${Math.max(1, Math.round((log.endedAt - log.startedAt) / 60000))} min</b>` : "";
    return `Início <b>${hhmm(log.startedAt)}</b> · Fim <b>${end}</b>${mins} <button type="button" class="btn sm ghost" id="timesReset" style="margin-left:6px">Zerar</button>`;
  }
  function logForm(w, n, log, level) {
    const rpe = log.rpe || 0;
    return `
      <div class="card" id="logCard">
        <h3>📝 Registro do treino</h3>
        <div class="times" id="logTimes">${timesHtml(w, log)}</div>
        <div class="grid2" style="margin-top:10px">
          <label class="f">Kettlebell (kg)<input type="number" inputmode="decimal" step="0.5" min="0" id="fBell" value="${esc(log.bell ?? S.settings.bell)}"></label>
          <label class="f">Duração (min)<input type="number" inputmode="numeric" min="0" id="fDur" value="${esc(log.duration ?? "")}" placeholder="${w.min}"></label>
        </div>
        ${w.type === "amrap" ? `<div class="grid2">
          <label class="f">Rounds completos<input type="number" inputmode="numeric" min="0" id="fRounds" value="${esc(log.amrapRounds || 0)}"></label>
          <label class="f">Reps extras (round parcial)<input type="number" inputmode="numeric" min="0" id="fReps" value="${esc(log.amrapReps || 0)}"></label>
        </div>` : ""}
        <label class="f">Esforço percebido (RPE 1–10)</label>
        <div class="rpe" id="rpe">${Array.from({ length: 10 }, (_, i) => `<button data-rpe="${i + 1}" class="${rpe === i + 1 ? "on" : ""}">${i + 1}</button>`).join("")}</div>
        <div style="height:10px"></div>
        <label class="f">Notas<textarea id="fNotes" rows="2" placeholder="Como foi? Algo para ajustar?">${esc(log.notes || "")}</textarea></label>
        ${log.done
          ? `<p class="small lime" style="font-weight:800">✓ Concluído em ${esc(log.completedAt ? fmtDate(parseDate(log.completedAt)) : "")} · nível ${esc(LEVELS[level])}</p>
             <div class="row"><button class="btn primary grow" id="saveBtn">Salvar alterações</button><button class="btn danger" id="undoBtn">Desmarcar</button></div>`
          : `<button class="btn primary block" id="doneBtn">✓ Concluir treino</button>`}
      </div>`;
  }

  function startWorkoutClock(n) {
    const l = ensureLog(n);
    if (l.startedAt) return false;
    l.startedAt = Date.now(); delete l.endedAt; save();
    toast(`Treino iniciado às ${hhmm(l.startedAt)}`);
    return true;
  }
  function bindWarm(n, onStart) {
    const w = WD(n);
    $$("[data-warm]").forEach((b) => (b.onclick = () => {
      const k = +b.dataset.warm, l = ensureLog(n); l.warm = l.warm || [];
      l.warm[k] = !l.warm[k];
      l.warmAt = l.warmAt || {};
      if (l.warm[k]) l.warmAt[k] = Date.now(); else delete l.warmAt[k];
      save(); renderDiary(n);
      b.classList.toggle("on", !!l.warm[k]);
      $("#warmCount").textContent = `${WARM.filter((_, j) => l.warm[j]).length}/${WARM.length}`;
      if (l.warm[k]) { onStart(); restStart("w" + k, restOf(w)); }
      else if (R.key === "w" + k) restStop();
    }));
    $$("[data-rest]").forEach((p) => (p.onclick = () => { if (p.classList.contains("go")) { R.key = null; restPaint(); return; } restToggle(); }));
  }
  function bindToday() { const n = RUN && RUN.kind === "single" ? 1 : currentDay(); bindWarm(n, () => startWorkoutClock(n)); }

  function bindDay(n) {
    const w = WD(n); if (!w) return;
    const log = () => ensureLog(n);
    const level = () => (getLog(n)?.level) || S.settings.level;
    const t = () => target(w, level());

    // Timer
    const loadTimer = () => {
      const tt = t();
      if (w.type === "sets") {
        timerLoad([], "none");
      } else if (w.type === "amrap") {
        timerLoad([
          { phase: "prep", secs: 10, label: "Pegue o kettlebell", sub: w.ex.map(([id, , r]) => `${exInfo(id).pt} x${r + tt.plus}`).join(" · ") },
          { phase: "work", secs: w.amrap * 60, label: `AMRAP ${w.amrap} min`, sub: "Toque em +1 Round a cada volta completa" },
        ], "amrap", () => { markEnd(); toast("AMRAP finalizado! Registre seus rounds."); $("#logCard")?.scrollIntoView({ behavior: "smooth" }); });
      } else {
        const segs = [{ phase: "prep", secs: 10, label: "Prepare-se", sub: "Primeiro: " + exInfo(w.ex[0][0]).pt }];
        for (let r = 1; r <= tt.rounds; r++) {
          w.ex.forEach(([id], i) => {
            const nextId = w.ex[i + 1]?.[0];
            segs.push({ exIdx: i, endsRound: i === w.ex.length - 1 ? r : 0, phase: "work", secs: w.work, label: exInfo(id).pt, sub: `Round ${r}/${tt.rounds} · ${i + 1}/${w.ex.length}` + (nextId ? ` · depois: ${exInfo(nextId).pt}` : r < tt.rounds ? " · depois: descanso" : " · último!") });
            if (nextId && +w.gap > 0) segs.push({ exIdx: i + 1, phase: "rest", secs: +w.gap, label: "Descanso", sub: `Próximo: ${exInfo(nextId).pt}` });
          });
          if (r < tt.rounds) segs.push({ exIdx: 0, phase: "rest", secs: (+w.rest > 0 || +S.settings.rest > 0) ? restOf(w) : (+w.gap || 0), label: "Descanso", sub: `Próximo: round ${r + 1} · ${exInfo(w.ex[0][0]).pt}` });
        }
        timerLoad(segs, "interval", () => { markEnd(); toast("Treino concluído! Registre abaixo."); $("#logCard")?.scrollIntoView({ behavior: "smooth" }); });
      }
    };
    loadTimer();
    if (w.type === "interval") T.onRound = (r) => { const l = log(); l.roundAt = l.roundAt || []; l.roundAt[r - 1] = Date.now(); save(); renderDiary(n); };

    // Horário de início/fim
    const paintTimes = () => { const el = $("#logTimes"); if (el) { el.innerHTML = timesHtml(w, log()); bindTimes(); } };
    const bindTimes = () => { const z = $("#timesReset"); if (z) z.onclick = () => { const l = log(); delete l.startedAt; delete l.endedAt; save(); paintTimes(); renderDiary(n); }; };
    bindTimes();
    const markStart = () => { if (startWorkoutClock(n)) { paintTimes(); renderDiary(n); } };
    function markEnd() {
      const l = log(); if (!l.startedAt) return;
      l.endedAt = Date.now(); l.duration = Math.max(1, Math.round((l.endedAt - l.startedAt) / 60000)); save();
      const f = $("#fDur"); if (f) f.value = l.duration;
      paintTimes(); renderDiary(n);
    }

    $("#focusBtn").onclick = () => openFocus(n);

    // Seletor de descanso
    $("#restTest").onclick = () => { unlockAudio(); setTimeout(alarm, 150); };
    $("#restSel").onchange = (e) => { S.settings.rest = +e.target.value; save(); route(); toast(`Descanso: ${restOf(w)}s`); };

    // Aquecimento
    bindWarm(n, markStart);
    const ct = $("#coolTick");
    if (ct) ct.onclick = () => { const l = log(); l.cool = l.cool ? 0 : Date.now(); save(); ct.classList.toggle("on", !!l.cool); renderDiary(n); };
    bindDiary(n);

    const box = $("#timerBox");
    if (box) {
      $("[data-t=play]").onclick = () => { if (!T.running) { markStart(); restStop(); timerStart(); } else timerPause(); };
      $("[data-t=skip]").onclick = () => timerSkip();
      $("[data-t=reset]").onclick = () => timerStop(false);
      const exitBtn = $("[data-t=exitfs]");
      $("[data-t=fs]").onclick = () => { box.classList.add("fs"); exitBtn.style.display = ""; };
      exitBtn.onclick = () => { box.classList.remove("fs"); exitBtn.style.display = "none"; };
    }

    $$("[data-round]").forEach((b) => (b.onclick = () => {
      const l = log(), d = +b.dataset.round;
      l.amrapRounds = Math.max(0, (l.amrapRounds || 0) + d);
      l.roundAt = l.roundAt || [];
      if (d > 0) l.roundAt.push(Date.now()); else l.roundAt.splice(l.amrapRounds);
      save(); renderDiary(n);
      $("#roundCount").textContent = l.amrapRounds; const f = $("#fRounds"); if (f) f.value = l.amrapRounds;
      if (+b.dataset.round > 0) { beep(1300, 0.08); buzz(60); }
    }));

    // Nível
    $$("#levelSeg button").forEach((b) => (b.onclick = () => { log().level = b.dataset.level; save(); route(); }));

    // Séries
    $$("[data-set]").forEach((b) => (b.onclick = () => {
      const [i, s] = b.dataset.set.split(":").map(Number);
      const l = log(); l.sets = l.sets || {}; l.sets[i] = l.sets[i] || [];
      l.sets[i][s] = !l.sets[i][s];
      l.setAt = l.setAt || {}; l.setAt[i] = l.setAt[i] || {};
      if (l.sets[i][s]) l.setAt[i][s] = Date.now(); else delete l.setAt[i][s];
      save(); renderDiary(n);
      b.classList.toggle("on", !!l.sets[i][s]);
      if (!l.sets[i][s]) {
        if (R.key === "s" + i) restStop();
        if (i === w.ex.length - 1 && s === t().sets - 1 && l.endedAt) { delete l.endedAt; save(); paintTimes(); renderDiary(n); }
        return;
      }
      if (R.key && R.key[0] === "w") restStop();
      markStart();
      const lastOfLast = i === w.ex.length - 1 && s === t().sets - 1;
      if (lastOfLast) {
        restStop(); markEnd(); beep(1000, 0.6); buzz([300, 100, 300]);
        toast(log().duration ? `Treino finalizado: ${log().duration} min 💪` : "Última série feita! 💪");
        setTimeout(() => $("#logCard")?.scrollIntoView({ behavior: "smooth" }), 600);
      } else {
        restStart("s" + i, restOf(w));
      }
    }));

    // Reps por exercício
    $$("[data-exreps]").forEach((inp) => (inp.onchange = () => {
      const l = log(); l.ex = l.ex || {};
      if (inp.value === "") delete l.ex[inp.dataset.exreps]; else l.ex[inp.dataset.exreps] = +inp.value;
      save();
    }));

    // Formulário
    const num = (id) => { const v = $(id)?.value; return v === "" || v == null ? undefined : +v; };
    const collect = () => {
      const l = log();
      l.bell = num("#fBell"); l.duration = num("#fDur");
      if (w.type === "amrap") { l.amrapRounds = num("#fRounds") || 0; l.amrapReps = num("#fReps") || 0; }
      l.notes = $("#fNotes").value.trim();
      l.level = level();
      return l;
    };
    ["#fBell", "#fDur", "#fRounds", "#fReps", "#fNotes"].forEach((id) => { const el = $(id); if (el) el.onchange = () => { collect(); save(); if (id === "#fRounds" && $("#roundCount")) $("#roundCount").textContent = log().amrapRounds; }; });
    $$("#rpe button").forEach((b) => (b.onclick = () => { log().rpe = +b.dataset.rpe; save(); $$("#rpe button").forEach((x) => x.classList.toggle("on", x === b)); }));

    const doneBtn = $("#doneBtn");
    if (doneBtn) doneBtn.onclick = () => {
      const l = collect(); l.done = true; l.completedAt = isoDate(new Date()); save();
      toast(doneCount() === TDAYS.length && TDAYS.length > 1 ? "🏆 SEQUÊNCIA CONCLUÍDA!" : `${RUN.kind === "single" ? "Treino" : "Dia " + n} concluído! 🔥`); route();
    };
    const saveBtn = $("#saveBtn");
    if (saveBtn) saveBtn.onclick = () => { collect(); save(); toast("Salvo"); };
    const undoBtn = $("#undoBtn");
    if (undoBtn) undoBtn.onclick = () => { log().done = false; save(); route(); };
  }


  // ---------- Modo foco ----------
  const F = { open: false, n: 0, idx: 0, amrapIdx: 0, iv: null, vidFor: null };
  function focusItems(n) {
    const w = WD(n);
    return [
      ...WARM.map(([id, note], k) => ({ kind: "warm", k, id, note, sub: note })),
      ...w.ex.map(([id, note, reps], i) => ({ kind: "ex", i, id, note, reps })),
    ];
  }
  function fxSetsDone(n, i) { const l = getLog(n) || {}; return ((l.sets && l.sets[i]) || []); }
  function fxItemDone(n, it) {
    const w = WD(n), l = getLog(n) || {};
    if (it.kind === "warm") return !!(l.warm && l.warm[it.k]);
    if (w.type === "sets") { const t = target(w, l.level || S.settings.level), d = fxSetsDone(n, it.i); return Array.from({ length: t.sets }, (_, s) => !!d[s]).every(Boolean); }
    return false;
  }
  function fxSub(n, it) {
    const w = WD(n), l = getLog(n) || {}, t = target(w, l.level || S.settings.level);
    if (it.kind === "warm") return it.note;
    if (w.type === "sets") return `${t.sets} × ${t.reps}${it.note ? " · " + it.note : ""}`;
    if (w.type === "amrap") return `x${it.reps + t.plus}${it.note ? " · " + it.note : ""}`;
    return `${w.work}s${it.note ? " · " + it.note : ""}`;
  }
  function openFocus(n) {
    const w = WD(n); if (!w) return;
    closeFocus();
    Object.assign(F, { open: true, n, amrapIdx: 0, vidFor: null });
    const items = focusItems(n);
    const first = items.findIndex((it) => !fxItemDone(n, it));
    F.idx = first < 0 ? items.length - 1 : first;
    const el = document.createElement("div");
    el.id = "focus"; el.className = "focus"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Modo foco");
    el.innerHTML = `
      <div class="fx-top">
        <button type="button" class="fx-icon" id="fxClose" aria-label="Sair do modo foco">✕</button>
        <div class="fx-title">${RUN && RUN.kind === "single" ? "" : `Dia ${n} · `}${esc(w.name)}</div>
        <div class="fx-count" id="fxCount"></div>
      </div>
      <div class="fx-body">
        <div class="fx-stage" id="fxStage">
          <div class="fx-media" id="fxMedia"></div>
          <div class="fx-howbox" id="fxHowBox">
            <ol id="fxHow"></ol>
            <p class="fx-warn" id="fxWarn"></p>
          </div>
          <div class="fx-c fx-tl">
            <div class="fx-name" id="fxName"></div>
            <div class="fx-target" id="fxTarget"></div>
          </div>
          <button type="button" class="fx-c fx-tr fx-ring" id="fxRing" aria-label="Pausar ou continuar o timer">
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="fxArc" cx="60" cy="60" r="52"/></svg>
            <span class="fx-ringin"><span id="fxBig"></span><span id="fxSmall"></span></span>
          </button>
          <div class="fx-c fx-bl" id="fxProgress"></div>
          <div class="fx-c fx-br">
            <button type="button" class="fx-pill" id="fxHowBtn"></button>
            <span id="fxVid"></span>
          </div>
        </div>
        <div class="fx-actions">
          <button type="button" class="btn fx-nav" id="fxPrev" aria-label="Exercício anterior">‹</button>
          <button type="button" class="btn primary fx-main" id="fxMain"></button>
          <button type="button" class="btn fx-nav" id="fxNext" aria-label="Próximo exercício">›</button>
        </div>
        <div class="fx-listwrap">
          <div class="fx-tabs" id="fxTabs"></div>
          <div class="fx-list" id="fxList"></div>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add("fx-lock");
    $("#fxClose").onclick = closeFocus;
    $("#fxPrev").onclick = () => { F.idx = Math.max(0, F.idx - 1); fxRender(true); };
    $("#fxNext").onclick = () => { F.idx = Math.min(focusItems(F.n).length - 1, F.idx + 1); fxRender(true); };
    $("#fxMain").onclick = fxMain;
    $("#fxRing").onclick = () => {
      if (R.key) { restToggle(); return; }
      const box = $("#timerBox [data-t=play]"); if (box && (T.running || T.remain < (T.segs[T.i]?.secs || 0) * 1000)) box.click();
    };
    $("#fxTabs").onclick = (e) => { const b = e.target.closest("[data-sec]"); if (b) { F.sec = b.dataset.sec; fxPaintList(); } };
    $("#fxHowBtn").onclick = () => { F.howTab = F.howTab === "how" ? "video" : "how"; fxPaintHow(); };
    // Tocar em "✓ Feito" ou numa série desfaz / refaz
    $("#fxProgress").onclick = (e) => {
      const u = e.target.closest("[data-undowarm]"), d = e.target.closest("[data-fxset]");
      if (u) { $(`[data-warm="${u.dataset.undowarm}"]`)?.click(); toast("Desmarcado"); }
      else if (d) { const wasOn = d.classList.contains("on"); $(`[data-set="${d.dataset.fxset}"]`)?.click(); if (wasOn) toast("Série desmarcada"); }
      else return;
      fxRender(true);
    };
    $("#fxList").onclick = (e) => { const b = e.target.closest("[data-fx]"); if (b) { F.idx = +b.dataset.fx; fxRender(true); } };
    keepAwake(true);
    fxRender(true);
    F.iv = setInterval(() => fxRender(false), 200);
  }
  function closeFocus() {
    if (!F.open) return;
    clearInterval(F.iv); F.open = false;
    $("#focus")?.remove();
    document.documentElement.classList.remove("fx-lock");
    if (!T.running && !R.running) keepAwake(false);
  }
  function fxTimerStarted() { const seg = T.segs[T.i]; return !!seg && (T.running || T.remain < seg.secs * 1000); }
  function fxMain() {
    const n = F.n, w = WD(n), items = focusItems(n), it = items[F.idx], l = getLog(n) || {};
    if (!it) return;
    const next = () => { F.idx = Math.min(items.length - 1, F.idx + 1); };
    if (it.kind === "warm") {
      if (!fxItemDone(n, it)) $(`[data-warm="${it.k}"]`)?.click();
      next();
    } else if (w.type === "sets") {
      const t = target(w, l.level || S.settings.level), d = fxSetsDone(n, it.i);
      const s = Array.from({ length: t.sets }, (_, x) => x).find((x) => !d[x]);
      if (s == null) { next(); }
      else {
        $(`[data-set="${it.i}:${s}"]`)?.click();
        if (s === t.sets - 1 && it.i < w.ex.length - 1) next();
      }
    } else if (w.type === "interval") {
      $("#timerBox [data-t=play]")?.click();
    } else {
      if (!fxTimerStarted()) { restStop(); $("#timerBox [data-t=play]")?.click(); F.amrapIdx = 0; }
      else {
        F.amrapIdx++;
        if (F.amrapIdx >= w.ex.length) { F.amrapIdx = 0; $('[data-round="1"]')?.click(); }
      }
      F.idx = WARM.length + F.amrapIdx;
    }
    fxRender(true);
  }
  function fxRender(full) {
    if (!F.open || !$("#focus")) return;
    const n = F.n, w = WD(n), l = getLog(n) || {}, t = target(w, l.level || S.settings.level), items = focusItems(n);
    // no intervalado em andamento, o destaque segue o timer
    if (w.type === "interval" && fxTimerStarted()) { const seg = T.segs[T.i]; if (seg && seg.exIdx != null) { const ni = WARM.length + seg.exIdx; if (ni !== F.idx) { F.idx = ni; full = true; } } }
    const it = items[F.idx];
    // Timer (só aparece quando há contagem)
    const C = 2 * Math.PI * 52;
    let big = "", small = "", frac = 1, cls = "idle";
    if (R.key) {
      const rem = R.running ? Math.max(0, R.endAt - Date.now()) : R.remain;
      big = rem > 0 ? String(Math.ceil(rem / 1000)) : "✓"; small = rem > 0 ? (R.running ? "descanso" : "pausado") : "bora!";
      frac = R.secs ? rem / (R.secs * 1000) : 0; cls = "rest";
    } else if (fxTimerStarted() || (T.segs.length && T.remain === 0)) {
      const seg = T.segs[T.i] || { secs: 1, phase: "" };
      const rem = T.running ? Math.max(0, T.endAt - Date.now()) : T.remain;
      big = rem > 0 ? mmss(rem) : "✓";
      small = rem <= 0 ? "fim" : !T.running ? "pausado" : { prep: "prepare", work: "vai!", rest: "descanso" }[seg.phase] || "";
      frac = rem / (seg.secs * 1000); cls = seg.phase === "rest" ? "rest" : "work";
    }
    $("#fxBig").textContent = big; $("#fxSmall").textContent = small;
    const arc = $("#fxArc"); arc.style.strokeDasharray = C; arc.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, frac)));
    $("#fxRing").className = "fx-c fx-tr fx-ring " + cls;
    // Botão principal
    let main = "";
    if (!it) main = "";
    else if (it.kind === "warm") main = fxItemDone(n, it) ? "Próximo ›" : "✓ Feito";
    else if (w.type === "sets") {
      const d = fxSetsDone(n, it.i), s2 = Array.from({ length: t.sets }, (_, x) => x).find((x) => !d[x]);
      main = s2 == null ? (it.i === w.ex.length - 1 ? "✓ Treino concluído" : "Próximo exercício ›") : `✓ Série ${s2 + 1} de ${t.sets} feita`;
    } else if (w.type === "interval") main = T.running ? "⏸ Pausar" : fxTimerStarted() ? "▶ Continuar" : (T.remain === 0 && T.segs.length ? "✓ Concluído" : `▶ Iniciar ${t.rounds} rounds`);
    else main = fxTimerStarted() ? (F.amrapIdx === w.ex.length - 1 ? "✓ Feito · fecha o round" : "✓ Feito · próximo") : `▶ Iniciar AMRAP ${w.amrap} min`;
    const mb = $("#fxMain"); if (mb.textContent !== main) mb.textContent = main;
    // Contador geral
    const doneN = items.filter((x) => fxItemDone(n, x)).length;
    $("#fxCount").textContent = w.type === "amrap" ? `${l.amrapRounds || 0} rounds` : `${doneN}/${items.length}`;
    // Cantos que mudam com o tempo
    const prog = fxProgressHtml(n, it); if ($("#fxProgress").innerHTML !== prog) $("#fxProgress").innerHTML = prog;
    $("#fxProgress").hidden = !prog;
    if (!full) {
      const tabs = $$("#fxTabs [data-sec] span"), its = focusItems(n);
      if (tabs.length === 2) {
        tabs[0].textContent = `${its.filter((x) => x.kind === "warm" && fxItemDone(n, x)).length}/${WARM.length}`;
        if (w.type === "sets") tabs[1].textContent = `${its.filter((x) => x.kind === "ex" && fxItemDone(n, x)).length}/${its.filter((x) => x.kind === "ex").length}`;
      }
      $$("#fxList [data-fx]").forEach((b) => { const x = items[+b.dataset.fx]; b.classList.toggle("done", fxItemDone(n, x)); b.classList.toggle("on", +b.dataset.fx === F.idx); });
      const tg = fxTargetText(n, it); if ($("#fxTarget").textContent !== tg) $("#fxTarget").textContent = tg;
      return;
    }
    if (!it) return;
    const e = exInfo(it.id), how = (CAT.exercises[it.id] && CAT.exercises[it.id].how) || [];
    $("#fxName").textContent = e.pt;
    $("#fxTarget").textContent = fxTargetText(n, it);
    const steps = how.filter((x) => !/^Atenção:/.test(x)), warn = how.find((x) => /^Atenção:/.test(x));
    $("#fxHow").innerHTML = steps.map((x) => `<li>${esc(x)}</li>`).join("");
    $("#fxWarn").innerHTML = warn ? `⚠️ <b>Atenção:</b> ${esc(warn.replace(/^Atenção:\s*/, ""))}` : "";
    const vid = ytId(videoOf(it.id)), clip = clipOf(it.id);
    $("#fxVid").innerHTML = vid
      ? `<a class="fx-pill yt" href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener">▶ YouTube</a>`
      : clip ? "" : `<a class="fx-pill" href="${ytSearch(e.qEn)}" target="_blank" rel="noopener">🔎 Vídeo</a>`;
    if (F.vidFor !== it.id) {
      F.vidFor = it.id;
      F.howTab = clip ? "video" : "how";
      $("#fxMedia").innerHTML = clip ? clipTag(it.id, "fx-clip")
        : CAN_EMBED && vid ? `<iframe src="https://www.youtube-nocookie.com/embed/${vid}?rel=0&playsinline=1&mute=1&loop=1&playlist=${vid}" title="${esc(e.pt)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>` : "";
    }
    fxPaintHow();
    if (F.lastIdx !== F.idx) { F.sec = it.kind; F.lastIdx = F.idx; }
    fxPaintList();
  }
  function fxPaintHow() {
    const it = focusItems(F.n)[F.idx]; if (!it) return;
    const hasMedia = !!$("#fxMedia").innerHTML, showHow = !hasMedia || F.howTab === "how";
    const st = $("#fxStage");
    st.classList.toggle("has-media", hasMedia);
    st.classList.toggle("show-how", showHow);
    $("#fxHowBtn").hidden = !hasMedia;
    $("#fxHowBtn").textContent = showHow ? "🎬 Vídeo" : "📋 Como fazer";
    const v = $("#fxMedia video"); if (v && !showHow) { const pr = v.play(); if (pr) pr.catch(() => {}); }
  }
  function fxPaintList() {
    const n = F.n, items = focusItems(n);
    const warmDone = items.filter((x) => x.kind === "warm" && fxItemDone(n, x)).length;
    const exItems = items.filter((x) => x.kind === "ex"), exDone = exItems.filter((x) => fxItemDone(n, x)).length;
    $("#fxTabs").innerHTML = `
      ${WARM.length ? `<button type="button" data-sec="warm" class="${F.sec === "warm" ? "on" : ""}">Aquecimento <span>${warmDone}/${WARM.length}</span></button>` : ""}
      <button type="button" data-sec="ex" class="${F.sec === "ex" ? "on" : ""}">Treino <span>${WD(n).type === "sets" ? `${exDone}/${exItems.length}` : exItems.length}</span></button>`;
    $("#fxList").innerHTML = items.map((x, j) => {
      if (x.kind !== F.sec) return "";
      const lab = x.kind === "warm" ? `A${x.k + 1}` : String(x.i + 1).padStart(2, "0");
      return `<button type="button" class="fx-item ${j === F.idx ? "on" : ""} ${fxItemDone(n, x) ? "done" : ""}" data-fx="${j}">
        <span class="fx-num">${lab}</span><span class="fx-txt">${esc(exInfo(x.id).pt)}</span></button>`;
    }).join("");
  }
  // Canto superior esquerdo: o que fazer (uma vez só)
  function fxTargetText(n, it) {
    if (!it) return "";
    const w = WD(n), l = getLog(n) || {}, t = target(w, l.level || S.settings.level);
    if (it.kind === "warm") return it.note;
    if (w.type === "sets") return `${t.reps} reps${it.note ? " · " + it.note : ""}`;
    if (w.type === "amrap") return `x${it.reps + t.plus}${it.note ? " " + it.note : ""}`;
    return `${w.work}s${it.note ? " · " + it.note : ""}`;
  }
  // Canto inferior esquerdo: progresso (séries / rounds / feito)
  function fxProgressHtml(n, it) {
    if (!it) return "";
    const w = WD(n), l = getLog(n) || {}, t = target(w, l.level || S.settings.level);
    if (it.kind === "warm") return fxItemDone(n, it) ? `<button type="button" class="fx-badge on" data-undowarm="${it.k}" aria-label="Desmarcar ${esc(exInfo(it.id).en)}">✓ Feito</button>` : "";
    if (w.type === "sets") {
      const d = fxSetsDone(n, it.i);
      return Array.from({ length: t.sets }, (_, x) => `<button type="button" class="fx-dot ${d[x] ? "on" : ""}" data-fxset="${it.i}:${x}" aria-label="Série ${x + 1}${d[x] ? " (feita, toque para desmarcar)" : ""}">${x + 1}</button>`).join("");
    }
    if (w.type === "amrap") return `<span class="fx-badge">Round ${(l.amrapRounds || 0) + 1}</span>`;
    const seg = T.segs[T.i], m = seg && seg.sub ? seg.sub.match(/Round (\d+)\/(\d+)/) : null;
    return `<span class="fx-badge">${m ? `Round ${m[1]}/${m[2]}` : `${t.rounds} rounds`}</span>`;
  }

  // ---------- Evolução ----------
  function chart(points, { type = "line", unit = "", h = 150, color = "#c6e33a" } = {}) {
    if (!points.length) return `<div class="empty">Sem dados ainda.</div>`;
    const W = 340, H = h, pl = 30, pr = 10, pt = 14, pb = 22;
    const ys = points.map((p) => p.y);
    let min = Math.min(...ys), max = Math.max(...ys);
    if (type === "bar") min = 0;
    if (min === max) { max += 1; min = Math.max(0, min - 1); }
    const pad = (max - min) * 0.1; if (type !== "bar") { min -= pad; max += pad; }
    const X = (i) => points.length === 1 ? (pl + W - pr) / 2 : pl + (i * (W - pl - pr)) / (points.length - 1);
    const Y = (v) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
    const fmt = (v) => (Math.round(v * 10) / 10).toString();
    let g = `<line class="ax" x1="${pl}" y1="${H - pb}" x2="${W - pr}" y2="${H - pb}"/>`;
    [min, (min + max) / 2, max].forEach((v) => { g += `<text x="${pl - 4}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text><line class="ax" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke-dasharray="2 4"/>`; });
    if (type === "bar") {
      const bw = Math.min(28, ((W - pl - pr) / points.length) * 0.6);
      const BX = (i) => pl + ((i + 0.5) * (W - pl - pr)) / points.length;
      points.forEach((p, i) => {
        g += `<rect x="${BX(i) - bw / 2}" y="${Y(p.y)}" width="${bw}" height="${H - pb - Y(p.y)}" rx="4" fill="${color}"/>`;
        g += `<text x="${BX(i)}" y="${Y(p.y) - 4}" text-anchor="middle" style="fill:#f2f3f5;font-weight:700">${fmt(p.y)}</text>`;
        g += `<text x="${BX(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>`;
      });
    } else {
      g += `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" points="${points.map((p, i) => `${X(i)},${Y(p.y)}`).join(" ")}"/>`;
      const step = Math.ceil(points.length / 8);
      points.forEach((p, i) => {
        g += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="3.5" fill="${color}"><title>${esc(p.label)}: ${fmt(p.y)}${unit}</title></circle>`;
        if (i % step === 0 || i === points.length - 1) g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>`;
      });
    }
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>`;
  }

  function exerciseHistory(id) {
    const out = [];
    TDAYS.forEach((w) => {
      const l = LOGS[w.day]; if (!l) return;
      w.ex.forEach(([eid, , r], i) => {
        if (eid !== id) return;
        let reps = l.ex?.[i];
        if (w.type === "amrap" && l.done) reps = r + target(w, l.level || S.settings.level).plus;
        if (reps == null && !l.done) return;
        out.push({ day: w.day, type: w.type, reps, bell: l.bell, done: l.done, level: l.level });
      });
    });
    return out;
  }

  function viewProgress() {
    const done = TDAYS.filter((w) => LOGS[w.day]?.done);
    const amraps = TDAYS.filter((w) => w.type === "amrap" && LOGS[w.day]?.done)
      .map((w) => ({ label: "D" + w.day, y: (LOGS[w.day].amrapRounds || 0) + (LOGS[w.day].amrapReps ? 0.1 * Math.min(9, LOGS[w.day].amrapReps) : 0) }));
    const amrapTable = TDAYS.filter((w) => w.type === "amrap").map((w) => {
      const l = LOGS[w.day];
      return `<tr><td><a href="#dia-${w.day}">Dia ${w.day}</a></td><td>${w.amrap} min</td><td>${l?.done ? `<b class="lime">${l.amrapRounds || 0}</b>${l.amrapReps ? ` + ${l.amrapReps} reps` : ""}` : "—"}</td><td>${l?.done && l.bell != null ? l.bell + " kg" : "—"}</td></tr>`;
    }).join("");
    const bells = done.filter((w) => LOGS[w.day].bell != null).map((w) => ({ label: "D" + w.day, y: +LOGS[w.day].bell }));
    const rpes = done.filter((w) => LOGS[w.day].rpe).map((w) => ({ label: "D" + w.day, y: LOGS[w.day].rpe }));

    // Por categoria
    const byCat = Object.entries(CATEGORIES).map(([k, c]) => {
      const all = TDAYS.filter((w) => w.cat === k), d = all.filter((w) => LOGS[w.day]?.done).length;
      return `<div style="margin:8px 0"><div class="row small" style="justify-content:space-between"><span>${esc(c.label)}</span><span class="muted">${d}/${all.length}</span></div><div class="bar" style="margin-top:4px"><i style="width:${(d / all.length) * 100}%;background:${c.color}"></i></div></div>`;
    }).join("");

    // Recordes por exercício
    const recs = Object.keys(CAT.exercises).map((id) => {
      const h = exerciseHistory(id).filter((x) => x.reps != null && x.type !== "amrap");
      if (!h.length) return null;
      const best = h.reduce((a, b) => ((b.bell || 0) > (a.bell || 0) || ((b.bell || 0) === (a.bell || 0) && b.reps > a.reps) ? b : a));
      return { id, best, n: h.length };
    }).filter(Boolean);

    const bodySorted = [...S.body].sort((a, b) => a.date.localeCompare(b.date));
    const bw = bodySorted.filter((b) => b.weight).map((b) => ({ label: b.date.slice(8) + "/" + b.date.slice(5, 7), y: +b.weight }));
    const waist = bodySorted.filter((b) => b.waist).map((b) => ({ label: b.date.slice(8) + "/" + b.date.slice(5, 7), y: +b.waist }));
    const first = bodySorted.find((b) => b.weight), last = [...bodySorted].reverse().find((b) => b.weight);
    const diff = first && last && first !== last ? (last.weight - first.weight) : null;

    return `
      <div class="eyebrow">Sua evolução</div><h1>Progresso</h1>
      ${statsBlock()}

      <div class="section"><h3>AMRAPs (rounds)</h3></div>
      <div class="card">
        ${chart(amraps, { type: "bar" })}
        <table class="t" style="margin-top:8px"><tr><th>Treino</th><th>Tempo</th><th>Rounds</th><th>KB</th></tr>${amrapTable}</table>
        <p class="small muted">Os AMRAPs ficam mais longos a cada semana (12 → 15 → 18 → 20 min). Compare rounds e peso do kettlebell.</p>
      </div>

      <div class="section"><h3>Peso do kettlebell</h3></div>
      <div class="card">${chart(bells, { unit: " kg" })}</div>

      <div class="section"><h3>Esforço (RPE)</h3></div>
      <div class="card">${chart(rpes, { color: "#ff6b4a" })}</div>

      <div class="section"><h3>Medidas corporais</h3></div>
      <div class="card">
        <div class="grid2">
          <label class="f">Data<input type="date" id="bDate" value="${isoDate(new Date())}"></label>
          <label class="f">Peso (kg)<input type="number" inputmode="decimal" step="0.1" id="bWeight"></label>
        </div>
        <div class="grid2">
          <label class="f">Cintura (cm)<input type="number" inputmode="decimal" step="0.5" id="bWaist"></label>
          <label class="f">&nbsp;<button class="btn primary block" id="bAdd" style="margin-top:4px">Adicionar</button></label>
        </div>
        ${diff != null ? `<p class="small">Variação de peso: <b class="lime">${diff > 0 ? "+" : ""}${(Math.round(diff * 10) / 10)} kg</b> desde ${esc(first.date.split("-").reverse().join("/"))}</p>` : ""}
        <div class="small muted" style="margin-top:6px">Peso (kg)</div>${chart(bw, { unit: " kg" })}
        <div class="small muted" style="margin-top:6px">Cintura (cm)</div>${chart(waist, { unit: " cm", color: "#6ec1ff" })}
        ${bodySorted.length ? `<table class="t" style="margin-top:8px"><tr><th>Data</th><th>Peso</th><th>Cintura</th><th></th></tr>
          ${bodySorted.map((b) => `<tr><td>${esc(b.date.split("-").reverse().join("/"))}</td><td>${b.weight ? esc(b.weight) + " kg" : "—"}</td><td>${b.waist ? esc(b.waist) + " cm" : "—"}</td><td><button class="btn sm ghost" data-bdel="${esc(b.date)}">✕</button></td></tr>`).join("")}</table>` : ""}
      </div>

      <div class="section"><h3>Por categoria</h3></div>
      <div class="card">${byCat}</div>

      <div class="section"><h3>Recordes por exercício</h3></div>
      <div class="card">
        ${recs.length ? `<table class="t"><tr><th>Exercício</th><th>Melhor</th><th>KB</th><th>Dia</th></tr>
          ${recs.map((r) => `<tr><td><a href="#exercicio-${r.id.replace(/_/g, "-")}">${esc(exInfo(r.id).pt)}</a></td><td>${esc(r.best.reps)} ${r.best.type === "interval" ? "em 30s" : "reps"}</td><td>${r.best.bell != null ? esc(r.best.bell) + " kg" : "—"}</td><td>${r.best.day}</td></tr>`).join("")}</table>`
          : `<div class="empty">Registre as reps de cada exercício nos treinos (campo "reps em 30s" ou "reps/série") para ver seus recordes aqui.</div>`}
      </div>`;
  }
  function bindProgress() {
    $("#bAdd").onclick = () => {
      const date = $("#bDate").value, weight = $("#bWeight").value, waist = $("#bWaist").value;
      if (!date || (!weight && !waist)) { toast("Informe peso e/ou cintura"); return; }
      S.body = S.body.filter((b) => b.date !== date);
      S.body.push({ date, weight: weight ? +weight : null, waist: waist ? +waist : null });
      save(); toast("Medida salva"); route();
    };
    $$("[data-bdel]").forEach((b) => (b.onclick = () => { S.body = S.body.filter((x) => x.date !== b.dataset.bdel); save(); route(); }));
  }

  // ---------- Exercícios ----------
  function usedIn(id) { return TDAYS.filter((w) => w.ex.some(([e]) => e === id)).map((w) => w.day); }
  function viewExercise(id) {
    const x = CAT.exercises[id];
    if (!x) return `<a class="btn sm ghost" href="#enciclopedia-ex">← Exercícios</a><p>Exercício não encontrado.</p>`;
    const e = exInfo(id), h = exerciseHistory(id), days = usedIn(id), ws = workoutsWithExercise(id);
    const how = x.how || [], steps = how.filter((t) => !/^Atenção:/.test(t)), warn = how.find((t) => /^Atenção:/.test(t));
    const pts = h.filter((r) => r.reps != null && r.type !== "amrap").map((r) => ({ label: "D" + r.day, y: r.reps }));
    return `
      <a class="btn sm ghost" href="#enciclopedia-ex">← Exercícios</a>
      <div class="section"></div>
      <div class="row" style="justify-content:space-between;align-items:flex-end"><div><div class="eyebrow">Exercício</div><h1>${esc(e.en)}</h1></div>
        ${IS_ADMIN ? `<a class="btn sm ghost" href="#editar-ex-${enc(id)}">Editar</a>` : ""}</div>
      ${x.clip ? `<div class="card"><video class="clip" src="${esc(x.clip)}" muted autoplay loop playsinline style="margin:0 auto"></video></div>` : ""}
      ${steps.length || warn ? `<div class="card"><h3>Como fazer</h3>
        ${steps.length ? `<ol class="howlist">${steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}
        ${warn ? `<p class="fx-warn" style="margin-top:8px">⚠️ <b>Atenção:</b> ${esc(warn.replace(/^Atenção:\s*/, ""))}</p>` : ""}
        ${sourceHtml(x)}</div>` : ""}
      <div class="card">
        <h3>Vídeos</h3>
        <div style="margin:10px 0 0">${videoButtons(id)}</div>
      </div>
      ${ws.length ? `<div class="card"><h3>Usado nos treinos</h3><div class="chips">${ws.map(([wid, w]) => `<a class="chip" href="#treino-${enc(wid)}" style="text-decoration:none">${esc(w.name)}</a>`).join("")}</div></div>` : ""}
      ${RUN && days.length ? `<div class="card"><h3>Na sua sequência atual</h3><div class="chips">${days.map((d) => `<a class="chip" href="#dia-${d}" style="text-decoration:none">Dia ${d} · ${esc(WD(d).name)}</a>`).join("")}</div></div>` : ""}
      ${h.length ? `<div class="card">
        <h3>Seu histórico</h3>
        ${chart(pts)}
        <table class="t" style="margin-top:8px"><tr><th>Dia</th><th>Formato</th><th>Reps</th><th>KB</th></tr>
          ${h.map((r) => `<tr><td><a href="#dia-${r.day}">${r.day}</a></td><td>${r.type === "sets" ? "séries" : r.type === "amrap" ? "AMRAP" : "30s"}</td><td>${r.reps ?? "—"}</td><td>${r.bell != null ? esc(r.bell) + " kg" : "—"}</td></tr>`).join("")}</table>
      </div>` : ""}`;
  }
  // ---------- Ajustes ----------
  function viewSettings() {
    const st = S.settings;
    return `
      <div class="eyebrow">Configuração</div><h1>Ajustes</h1>
      <div class="section"></div>
      <div class="card">
        ${RUN && RUN.kind !== "single" ? `<label class="f">Dia 1 da sequência "${esc(runName(RUN))}"<input type="date" id="sStart" value="${esc(RUN.start)}"></label>` : ""}
        <label class="f">Nível padrão</label>
        <div class="seg" id="sLevel">${Object.entries(LEVELS).map(([k, v]) => `<button data-level="${k}" class="${k === st.level ? "on" : ""}">${v}</button>`).join("")}</div>
        <div style="height:12px"></div>
        <label class="f">Kettlebell padrão (kg)<input type="number" inputmode="decimal" step="0.5" min="0" id="sBell" value="${esc(st.bell)}"></label>
        <div class="row"><label class="f grow" style="display:flex;align-items:center;gap:10px;margin:0"><input type="checkbox" id="sSound" ${st.sound ? "checked" : ""} style="width:22px;height:22px;margin:0"> Sons do timer</label><button type="button" class="btn sm" id="sTest">🔊 Testar alarme</button></div>
        <p class="small muted">No iPhone, deixe o volume de mídia alto. O alarme do fim do descanso também vibra (Android).</p>
      </div>
      ${IS_ADMIN ? `<div class="card">
        <h3>🛠 Adm</h3>
        <p class="small muted">Cadastre e edite sequências, treinos, exercícios (com vídeos) e o aquecimento. Vale para todos que usam o app.</p>
        <a class="btn primary block" href="#gerenciar">Gerenciar cadastros</a>
      </div>` : ""}
      <div class="card">
        <h3>Backup</h3>
        <p class="small">${syncLine()}</p>
        <p class="small muted">Importar um backup junta os dados dele com os atuais (não apaga nada).</p>
        <div class="row">
          <button class="btn primary" id="exp">⬇ Exportar</button>
          <label class="btn ghost" style="cursor:pointer">⬆ Importar<input type="file" id="imp" accept="application/json,.json" hidden></label>
        </div>
      </div>
      <div class="card">
        <h3>Como instalar no celular</h3>
        <p class="small muted"><b>iPhone (Safari):</b> Compartilhar → "Adicionar à Tela de Início".<br><b>Android (Chrome):</b> menu ⋮ → "Instalar app" / "Adicionar à tela inicial".<br>Depois disso o app funciona offline.</p>
      </div>
      <div class="card">
        <h3>Zerar dados</h3>
        <button class="btn danger" id="reset">Apagar todo o progresso</button>
      </div>
      <p class="small muted">Kettlebellpedia · treinos catalogados de várias fontes; cada um mostra de onde veio. Aqueça antes, hidrate-se e pare se algo parecer errado. Em caso de problemas de saúde, consulte um médico.</p>`;
  }
  function bindSettings() {
    const ss = $("#sStart"); if (ss) ss.onchange = (e) => { if (e.target.value && RUN) { RUN.start = e.target.value; save(); activate(); toast("Data atualizada"); } };
    $$("#sLevel button").forEach((b) => (b.onclick = () => { S.settings.level = b.dataset.level; save(); $$("#sLevel button").forEach((x) => x.classList.toggle("on", x === b)); }));
    $("#sBell").onchange = (e) => { S.settings.bell = +e.target.value || 0; save(); };
    $("#sSound").onchange = (e) => { S.settings.sound = e.target.checked; save(); };
    $("#sTest").onclick = () => { unlockAudio(); setTimeout(alarm, 150); };
    $("#exp").onclick = async () => {
      const json = JSON.stringify(S, null, 2), filename = `kettlebellpedia-backup-${isoDate(new Date())}.json`;
      if (window.claude && typeof window.claude.use === "function") {
        const dl = await window.claude.use("downloads").catch(() => null);
        if (dl) { try { await dl.save({ filename, data: json }); toast("Backup salvo"); } catch (e) { if (e && e.code !== "declined") toast("Não foi possível salvar o arquivo aqui"); } return; }
      }
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $("#imp").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data.settings || !(data.logs || data.runs)) throw new Error();
        S = mergeStates(data, S); activate();
        e.target.value = "";
        save(); toast("Backup importado"); route();
      } catch (err) { toast("Arquivo inválido"); }
    };
    armConfirm($("#reset"), "Toque de novo para apagar tudo", () => { S = JSON.parse(JSON.stringify(DEFAULT)); save(); activate(); toast("Dados apagados"); route(); });
  }

  // ---------- Enciclopédia ----------
  const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function chOf(it) { return it && (it.channel || it.source) || null; }
  function sourceHtml(it) {
    if (!it) return "";
    const ch = chOf(it), v = it.video;
    const host = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    const link = (label, url) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label || host(url))} ↗</a>` : esc(label);
    const parts = [];
    if (ch && (ch.name || ch.url)) parts.push(`<div>Canal: ${link(ch.name, ch.url)}</div>`);
    if (v && (v.title || v.url)) parts.push(`<div>Vídeo: ${link(v.title, v.url)}</div>`);
    return parts.length ? `<div class="source">${parts.join("")}</div>` : "";
  }
  function srcText(it) { const ch = chOf(it), v = it && it.video; return [ch && ch.name, ch && ch.url, v && v.title].filter(Boolean).join(" "); }
  function workoutPrograms(id) { return Object.entries(CAT.programs).filter(([, p]) => (p.days || []).includes(id) || (p.weekly || []).includes(id)); }
  function workoutsWithExercise(id) { return Object.entries(CAT.workouts).filter(([, w]) => w.ex.some(([e]) => e === id)); }

  function viewEnc(tab) {
    tab = tab || "seq";
    const np = Object.keys(CAT.programs).length, nw = Object.keys(CAT.workouts).length, ne = Object.keys(CAT.exercises).length;
    const tabs = [["seq", `Sequências <span>${np}</span>`], ["tr", `Treinos <span>${nw}</span>`], ["ex", `Exercícios <span>${ne}</span>`]];
    let body = "";
    if (tab === "seq") {
      body = Object.entries(CAT.programs).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, p]) => `
        <a class="card enc-card" href="#seq-${enc(id)}" data-q="${esc(norm(p.name + " " + (p.note || "") + " " + srcText(p)))}">
          <div class="eyebrow" style="margin:0">${esc(programDesc(p))}</div>
          <h2>${esc(p.name)}</h2>
          ${p.note ? `<p class="small muted enc-note">${esc(p.note)}</p>` : ""}
          ${chOf(p) && chOf(p).name ? `<div class="small lime">${esc(chOf(p).name)}</div>` : ""}
        </a>`).join("") || '<div class="card muted">Nenhuma sequência cadastrada.</div>';
    } else if (tab === "tr") {
      const groups = {};
      Object.entries(CAT.workouts).forEach(([id, w]) => { const k = roleOf(w) === "treino" ? w.cat : "role:" + roleOf(w); (groups[k] = groups[k] || []).push([id, w]); });
      const LBL = Object.assign({}, CATEGORIES, { "role:aquecimento": { label: "Aquecimentos", color: "#f5b942" }, "role:desaquecimento": { label: "Desaquecimentos", color: "#6ec1ff" } });
      body = [...Object.keys(CATEGORIES), "role:aquecimento", "role:desaquecimento"].filter((c) => groups[c]).map((c) => `
        <div class="wgroup"><div class="section"><h3 style="color:${LBL[c].color}">${esc(LBL[c].label)}</h3></div>
        <div class="card runlist">${groups[c].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, w]) => `
          <a class="runrow enc-row" href="#treino-${enc(id)}" data-q="${esc(norm(w.name + " " + LBL[c].label + " " + srcText(w) + " " + w.ex.map(([e]) => exInfo(e).en + " " + exInfo(e).ptAlt).join(" ")))}">
            <div class="runinfo"><b>${esc(w.name)}</b><span class="small muted">${w.ex.length ? `${esc(fmtLine(w))} · ${w.ex.length} exercícios` : "🎬 vídeo para acompanhar"}${chOf(w) && chOf(w).name ? " · " + esc(chOf(w).name) : ""}</span></div>
            <span class="enc-go">›</span>
          </a>`).join("")}</div></div>`).join("");
    } else {
      body = `<div class="card runlist">${Object.entries(CAT.exercises).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, e]) => `
        <a class="runrow enc-row" href="#exercicio-${enc(id)}" data-q="${esc(norm(e.name + " " + (e.alt || "") + " " + srcText(e)))}">
          <div class="runinfo"><b>${esc(e.name)}</b><span class="small muted">${[e.clip ? "🎬 demo" : "", (e.youtube || S.videos[id]) ? "▶ YouTube" : "", `${workoutsWithExercise(id).length} treinos`].filter(Boolean).join(" · ")}</span></div>
          <span class="enc-go">›</span>
        </a>`).join("")}</div>`;
    }
    return `
      <div class="eyebrow">Kettlebellpedia</div><h1>Enciclopédia</h1>
      <p class="small muted">Sequências, treinos e exercícios catalogados${IS_ADMIN ? ` · <a href="#gerenciar-${tab === "ex" ? "ex" : tab}">Gerenciar</a>` : ""}.</p>
      <div class="seg seg3 enc-tabs">${tabs.map(([k, v]) => `<a href="#enciclopedia-${k}" class="${k === tab ? "on" : ""}">${v}</a>`).join("")}</div>
      <input class="search" id="encSearch" type="search" placeholder="Buscar por nome, exercício, categoria ou fonte…" style="margin-top:10px">
      <div id="encBody">${body}</div>
      <p class="empty" id="encEmpty" hidden>Nada encontrado.</p>`;
  }
  function bindEnc() {
    $("#encSearch").oninput = (e) => {
      const q = norm(e.target.value).trim();
      $$("#encBody [data-q]").forEach((el) => (el.hidden = q && !el.dataset.q.includes(q)));
      $$("#encBody .wgroup").forEach((g) => (g.hidden = !$$("[data-q]", g).some((r) => !r.hidden)));
      $("#encEmpty").hidden = $$("#encBody [data-q]").some((r) => !r.hidden);
    };
  }

  // Página de um treino
  function viewWorkout(id) {
    const w = CAT.workouts[id];
    if (!w) return `<a class="btn sm ghost" href="#enciclopedia-tr">← Treinos</a><p>Treino não encontrado.</p>`;
    const t = target(w, S.settings.level), progs = workoutPrograms(id);
    const rows = w.ex.map(([eid, note, reps], i) => `
      <a class="runrow enc-row" href="#exercicio-${enc(eid)}">
        <span class="enc-num">${i + 1}</span>
        <div class="runinfo"><b>${esc(exInfo(eid).en)}</b><span class="small muted">${[w.type === "amrap" ? `x${reps + t.plus}` : "", note].filter(Boolean).map(esc).join(" · ")}</span></div>
        <span class="enc-go">›</span>
      </a>`).join("");
    return `
      <a class="btn sm ghost" href="#enciclopedia-tr">← Treinos</a><div class="section"></div>
      <div class="card accent" style="${catStyle(w.cat)}">
        <span class="tag" style="${catStyle(w.cat)}">${roleOf(w) === "treino" ? esc(catOf(w.cat).label) : esc(ROLES[roleOf(w)])}</span>
        <h1 style="margin-top:10px">${esc(w.name)}</h1>
        ${w.ex.length ? `<div class="chips">${formatChips(w, t)}</div><p class="small muted" style="margin:6px 0 0">${esc(description(w, t))}</p>` : ""}
        ${sourceHtml(w)}
        ${w.video && w.video.url ? `<a class="vbtn yt" style="margin-top:10px" href="${esc(w.video.url)}" target="_blank" rel="noopener">▶ Assistir no YouTube</a>` : ""}
        ${roleOf(w) === "treino" ? `<div class="linked">${[["Aquecimento", w.warmupId === "none" ? null : w.warmupId ? CAT.workouts[w.warmupId] && [w.warmupId, CAT.workouts[w.warmupId].name] : ["", "Padrão do app"]], ["Desaquecimento", w.cooldownId && CAT.workouts[w.cooldownId] ? [w.cooldownId, CAT.workouts[w.cooldownId].name] : null]].filter(([, v]) => v).map(([k, v]) => `<div class="small">${k}: ${v[0] ? `<a href="#treino-${enc(v[0])}">${esc(v[1])}</a>` : esc(v[1])}</div>`).join("")}</div>` : ""}
        <div class="row" style="margin-top:12px">
          ${roleOf(w) === "treino" ? '<button type="button" class="btn primary grow" id="doSingle">🏋️ Fazer agora</button>' : ""}
          ${IS_ADMIN ? `<a class="btn ghost" href="#editar-tr-${enc(id)}">Editar</a>` : ""}
        </div>
      </div>
      ${rows ? `<div class="card runlist"><h3>Exercícios</h3>${rows}</div>` : ""}
      ${progs.length ? `<div class="card"><h3>Faz parte de</h3><div class="chips">${progs.map(([pid, p]) => `<a class="chip" href="#seq-${enc(pid)}" style="text-decoration:none">${esc(p.name)}</a>`).join("")}</div></div>` : ""}`;
  }
  function bindWorkout(id) {
    const b = $("#doSingle"); if (!b) return;
    b.onclick = () => {
      const rid = newId("s");
      S.runs[rid] = { kind: "single", workoutId: id, start: isoDate(new Date()), logs: {}, createdAt: Date.now() };
      setActive(rid); location.hash = "dia-1";
    };
  }

  // Página de uma sequência
  function viewProgram(id) {
    const p = CAT.programs[id];
    if (!p) return `<a class="btn sm ghost" href="#enciclopedia-seq">← Sequências</a><p>Sequência não encontrada.</p>`;
    const wname = (wid) => (wid && CAT.workouts[wid] ? CAT.workouts[wid] : null);
    const line = (label, wid) => {
      const w = wname(wid);
      return w ? `<a class="runrow enc-row" href="#treino-${enc(wid)}" style="${catStyle(w.cat)}"><span class="enc-day">${label}</span><div class="runinfo"><b>${esc(w.name)}</b><span class="small muted">${esc(fmtLine(w))}</span></div><span class="enc-go">›</span></a>`
        : `<div class="runrow enc-row rest"><span class="enc-day">${label}</span><div class="runinfo"><span class="muted">Descanso</span></div></div>`;
    };
    const days = p.kind === "weekly" ? DOW_FULL.map((d, i) => line(d, (p.weekly || [])[i])).join("") : (p.days || []).map((wid, i) => line(`Dia ${i + 1}`, wid)).join("");
    const mine = Object.entries(S.runs).filter(([, r]) => r.kind !== "single" && r.programId === id);
    return `
      <a class="btn sm ghost" href="#enciclopedia-seq">← Sequências</a><div class="section"></div>
      <div class="card">
        <div class="eyebrow" style="margin:0">${esc(programDesc(p))}</div>
        <h1>${esc(p.name)}</h1>
        ${p.note ? `<p class="small" style="margin:8px 0 0">${esc(p.note)}</p>` : ""}
        ${sourceHtml(p)}
        ${mine.length ? `<p class="small lime" style="margin:10px 0 0">Você já tem ${mine.length > 1 ? mine.length + " rodadas" : "esta sequência"}: ${mine.map(([, r]) => { const s = runStats(r); return `${s.done}/${s.total}`; }).join(", ")}.</p>` : ""}
        <div class="row" style="margin-top:12px">
          <label class="f grow" style="margin:0">Dia 1 em<input type="date" id="seqStart" value="${isoDate(new Date())}"></label>
          <button type="button" class="btn primary" id="seqGo" style="align-self:flex-end">Começar</button>
        </div>
        ${IS_ADMIN ? `<a class="btn ghost block" href="#editar-seq-${enc(id)}" style="margin-top:8px">Editar sequência</a>` : ""}
      </div>
      <div class="card runlist"><h3>${p.kind === "weekly" ? `Toda semana · ${p.weeks || 1} semana(s)` : "Dia a dia"}</h3>${days}</div>`;
  }
  function bindProgram(id) {
    const b = $("#seqGo"); if (!b) return;
    b.onclick = () => {
      const rid = newId("r");
      S.runs[rid] = { kind: "program", programId: id, start: $("#seqStart").value || isoDate(new Date()), logs: {}, createdAt: Date.now() };
      setActive(rid); toast("Sequência iniciada"); location.hash = "calendario";
    };
  }

  // ---------- Adm: gerenciar cadastros ----------
  const TYPES = { sets: "Séries × repetições", amrap: "AMRAP (máximo de rounds)", interval: "Intervalado (tempo por exercício)" };
  const DOW_FULL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const enc = (id) => String(id).replace(/_/g, "-"), dec = (s) => String(s).replace(/-/g, "_");
  function adminOnly() {
    return `<a class="btn sm ghost" href="#ajustes">← Ajustes</a><div class="section"></div>
      <h1>Gerenciar</h1><div class="card muted">Só quem edita o app pode alterar os cadastros.</div>`;
  }
  function exOptions(sel) {
    return Object.entries(CAT.exercises).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, e]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(e.name)}</option>`).join("");
  }
  function wkOptions(sel) {
    const groups = {};
    Object.entries(CAT.workouts).filter(([, w]) => roleOf(w) === "treino").forEach(([id, w]) => { (groups[w.cat] = groups[w.cat] || []).push([id, w]); });
    return `<option value="" ${!sel ? "selected" : ""}>— Descanso —</option>` + Object.keys(CATEGORIES).filter((c) => groups[c]).map((c) =>
      `<optgroup label="${esc(CATEGORIES[c].label)}">${groups[c].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, w]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</optgroup>`).join("");
  }
  function workoutUsage(id) {
    return [...Object.values(CAT.programs).filter((p) => (p.days || []).includes(id) || (p.weekly || []).includes(id)).map((p) => p.name),
      ...Object.values(CAT.workouts).filter((w) => w.warmupId === id || w.cooldownId === id).map((w) => w.name)];
  }
  function exerciseUsage(id) {
    const ws = Object.values(CAT.workouts).filter((w) => w.ex.some(([e]) => e === id)).map((w) => w.name);
    if ((CAT.warmup || []).some(([e]) => e === id)) ws.push("Aquecimento");
    return ws;
  }

  function viewAdmin(tab) {
    if (!IS_ADMIN) return adminOnly();
    tab = tab || "seq";
    const tabs = [["seq", "Sequências"], ["tr", "Treinos"], ["ex", "Exercícios"], ["aq", "Aquecimento"]];
    let body = "";
    if (tab === "seq") {
      body = `<a class="btn primary block" href="#editar-seq-novo">＋ Nova sequência</a><div class="card runlist" style="margin-top:10px">${Object.entries(CAT.programs).map(([id, p]) => `
        <div class="runrow"><div class="runinfo"><b>${esc(p.name)}</b><span class="small muted">${esc(programDesc(p))}</span></div>
        <a class="btn sm" href="#editar-seq-${enc(id)}">Editar</a></div>`).join("") || '<div class="muted">Nenhuma.</div>'}</div>`;
    } else if (tab === "tr") {
      const groups = {};
      Object.entries(CAT.workouts).forEach(([id, w]) => { (groups[w.cat] = groups[w.cat] || []).push([id, w]); });
      body = `<a class="btn primary block" href="#editar-tr-novo">＋ Novo treino</a>
        <input class="search" id="admSearch" type="search" placeholder="Buscar treino…" style="margin-top:10px">
        ${Object.keys(CATEGORIES).filter((c) => groups[c]).map((c) => `<div class="wgroup"><div class="section"><h3 style="color:${CATEGORIES[c].color}">${esc(CATEGORIES[c].label)}</h3></div><div class="card runlist">${groups[c].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, w]) => `
          <div class="runrow" data-wname="${esc(w.name.toLowerCase())}"><div class="runinfo"><b>${esc(w.name)}</b><span class="small muted">${roleOf(w) !== "treino" ? esc(ROLES[roleOf(w)]) + " · " : ""}${w.ex.length ? esc(fmtLine(w)) : "🎬 vídeo"}</span></div>
          <a class="btn sm" href="#editar-tr-${enc(id)}">Editar</a></div>`).join("")}</div></div>`).join("")}`;
    } else if (tab === "ex") {
      body = `<a class="btn primary block" href="#editar-ex-novo">＋ Novo exercício</a>
        <input class="search" id="admSearch" type="search" placeholder="Buscar exercício…" style="margin-top:10px">
        <div class="card runlist">${Object.entries(CAT.exercises).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, e]) => `
          <div class="runrow" data-wname="${esc((e.name + " " + (e.alt || "")).toLowerCase())}"><div class="runinfo"><b>${esc(e.name)}</b><span class="small muted">${[e.clip ? "🎬 demo" : "", e.youtube ? "▶ YouTube" : "", (e.how || []).length ? "📋 como fazer" : ""].filter(Boolean).join(" · ") || "sem conteúdo"}</span></div>
          <a class="btn sm" href="#editar-ex-${enc(id)}">Editar</a></div>`).join("")}</div>`;
    } else {
      body = `<div class="card" id="aqBox">${warmEditorHtml()}</div>`;
    }
    return `<a class="btn sm ghost" href="#ajustes">← Ajustes</a><div class="section"></div>
      <div class="eyebrow">Adm</div><h1>Gerenciar</h1>
      <p class="small muted">O que você salvar aqui vale para todos que usam o app. O progresso de cada pessoa continua separado.</p>
      <div class="seg seg4">${tabs.map(([k, v]) => `<a href="#gerenciar-${k}" class="${k === tab ? "on" : ""}">${v}</a>`).join("")}</div>
      <div class="section"></div>${body}`;
  }
  function bindAdmin(tab) {
    const s = $("#admSearch");
    if (s) s.oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $$("[data-wname]").forEach((r) => (r.hidden = !r.dataset.wname.includes(q)));
      $$(".wgroup").forEach((g) => (g.hidden = !$$("[data-wname]", g).some((r) => !r.hidden)));
    };
    if ((tab || "seq") === "aq") bindWarmEditor();
  }

  // Aquecimento
  let WDRAFT = null;
  function warmEditorHtml() {
    WDRAFT = WDRAFT || (CAT.warmup || []).map((x) => x.slice());
    return `<h3>Aquecimento (vale para todos os treinos)</h3>
      <div class="edrows">${WDRAFT.map(([id, note], i) => `
        <div class="edrow"><span class="ednum">${i + 1}</span>
          <select data-wq="${i}" aria-label="Exercício">${exOptions(id)}</select>
          <input type="text" data-wn="${i}" value="${esc(note || "")}" placeholder="ex.: x8 cada lado" aria-label="Observação">
          <span class="edbtns"><button type="button" class="btn sm ghost" data-wup="${i}" aria-label="Subir">↑</button><button type="button" class="btn sm ghost" data-wdn="${i}" aria-label="Descer">↓</button><button type="button" class="btn sm ghost" data-wrm="${i}" aria-label="Remover">✕</button></span>
        </div>`).join("")}</div>
      <button type="button" class="btn ghost" id="wAdd">＋ Adicionar exercício</button>
      <div class="row" style="margin-top:12px"><button type="button" class="btn primary grow" id="wSave">Salvar aquecimento</button></div>`;
  }
  function bindWarmEditor() {
    const box = $("#aqBox"), redraw = () => { box.innerHTML = warmEditorHtml(); bindWarmEditor(); };
    $$("[data-wq]").forEach((el) => (el.onchange = () => (WDRAFT[+el.dataset.wq][0] = el.value)));
    $$("[data-wn]").forEach((el) => (el.oninput = () => (WDRAFT[+el.dataset.wn][1] = el.value)));
    $$("[data-wup]").forEach((b) => (b.onclick = () => { const i = +b.dataset.wup; if (i > 0) { [WDRAFT[i - 1], WDRAFT[i]] = [WDRAFT[i], WDRAFT[i - 1]]; redraw(); } }));
    $$("[data-wdn]").forEach((b) => (b.onclick = () => { const i = +b.dataset.wdn; if (i < WDRAFT.length - 1) { [WDRAFT[i + 1], WDRAFT[i]] = [WDRAFT[i], WDRAFT[i + 1]]; redraw(); } }));
    $$("[data-wrm]").forEach((b) => (b.onclick = () => { WDRAFT.splice(+b.dataset.wrm, 1); redraw(); }));
    $("#wAdd").onclick = () => { WDRAFT.push([Object.keys(CAT.exercises)[0], ""]); redraw(); };
    $("#wSave").onclick = async () => {
      CAT.warmup = WDRAFT.map((x) => x.slice()); WDRAFT = null;
      if (await saveCatalog()) { toast("Aquecimento salvo"); route(); }
    };
  }

  // Editor (exercício, treino, sequência)
  let ED = null; // { kind, id, isNew, d }
  function viewEditor(arg) {
    if (!IS_ADMIN) return adminOnly();
    const cut = arg.indexOf("-"), kind = arg.slice(0, cut), raw = arg.slice(cut + 1), id = raw === "novo" ? null : dec(raw);
    const key = kind + ":" + (id || "novo");
    if (!ED || ED.key !== key) {
      const src = kind === "ex" ? CAT.exercises : kind === "tr" ? CAT.workouts : CAT.programs;
      let d;
      if (id && src[id]) d = JSON.parse(JSON.stringify(src[id]));
      else if (id) return `<a class="btn sm ghost" href="#gerenciar-${kind}">← Voltar</a><p>Não encontrado.</p>`;
      else if (kind === "ex") d = { name: "", alt: "", q: "", how: [], youtube: "", clip: "" };
      else if (kind === "tr") d = { name: "", role: "treino", cat: "full", type: "interval", sets: 3, reps: 10, rest: 0, gap: 0, min: 20, amrap: 12, rounds: 2, work: 40, ex: [], warmupId: "", cooldownId: "" };
      else d = { name: "", kind: "days", days: Array(7).fill(null), weekly: [null, null, null, null, null, null, null], weeks: 4, note: "" };
      if (d.source && !d.channel) { d.channel = d.source; }
      ED = { key, kind, id, isNew: !id, d };
    }
    return `<div id="edBox">${editorHtml()}</div>`;
  }
  function editorHtml() {
    const { kind, d, isNew } = ED;
    const back = `<a class="btn sm ghost" href="#gerenciar-${kind}">← Voltar</a><div class="section"></div>`;
    const actions = `<div class="edactions">
        <button type="button" class="btn primary grow" id="edSave">Salvar</button>
        ${isNew ? "" : `<button type="button" class="btn ghost" id="edDup">Duplicar</button><button type="button" class="btn danger" id="edDel">Excluir</button>`}
      </div>`;
    if (kind === "ex") {
      const steps = (d.how || []).filter((x) => !/^Atenção:/.test(x)), warn = ((d.how || []).find((x) => /^Atenção:/.test(x)) || "").replace(/^Atenção:\s*/, "");
      return `${back}<div class="eyebrow">${isNew ? "Novo" : "Editar"} exercício</div><h1>${esc(d.name || "Exercício")}</h1>
        <div class="card">
          <label class="f">Nome (inglês)<input type="text" data-f="name" value="${esc(d.name)}" placeholder="ex.: Kettlebell swings"></label>
          <label class="f">Nome em português (só para a busca)<input type="text" data-f="alt" value="${esc(d.alt || "")}"></label>
          <label class="f">Como fazer (um passo por linha)<textarea data-f="steps" rows="5">${esc(steps.join("\n"))}</textarea></label>
          <label class="f">Atenção (erro mais comum)<input type="text" data-f="warn" value="${esc(warn)}"></label>
          <div class="srcbox"><div class="f">Fonte</div>
          <div class="grid2">
            <label class="f">Canal / criador<input type="text" data-f="chName" value="${esc((d.channel && d.channel.name) || "")}" placeholder="ex.: Samuel Jordan Fitness"></label>
            <label class="f">Link do canal<input type="text" inputmode="url" data-f="chUrl" value="${esc((d.channel && d.channel.url) || "")}" placeholder="https://youtube.com/@..."></label>
          </div>
          <div class="grid2">
            <label class="f">Vídeo / post<input type="text" data-f="vidTitle" value="${esc((d.video && d.video.title) || "")}" placeholder="Título do vídeo"></label>
            <label class="f">Link do vídeo<input type="text" inputmode="url" data-f="vidUrl" value="${esc((d.video && d.video.url) || "")}" placeholder="https://youtu.be/..."></label>
          </div></div>
        </div>
        <div class="card">
          <h3>Vídeos</h3>
          <label class="f">Link do YouTube (padrão para todos)<input type="text" inputmode="url" data-f="youtube" value="${esc(d.youtube || "")}" placeholder="https://youtu.be/..."></label>
          <label class="f">Termo de busca no YouTube<input type="text" data-f="q" value="${esc(d.q || "")}" placeholder="ex.: kettlebell swing form"></label>
          <div class="f">Demo (vídeo curto que toca dentro do app)</div>
          <div id="clipBox">${d.clip ? `<video class="clip" src="${esc(d.clip)}" muted autoplay loop playsinline></video>
            <button type="button" class="btn sm ghost" id="clipDel" style="margin-top:8px">Remover demo</button>` : `<p class="small muted" style="margin:0 0 8px">Sem demo.</p>`}</div>
          ${CAN_EMBED ? `<p class="small muted">Para enviar vídeos, use o app publicado no claude.ai.</p>` : `<label class="btn ghost" style="cursor:pointer;margin-top:8px">⬆ ${d.clip ? "Trocar" : "Enviar"} vídeo<input type="file" id="clipUp" accept="video/mp4,video/quicktime,video/webm,video/*" hidden></label>
          <p class="small muted">Vídeos curtos (10–20 s, até 20 MB). MP4 funciona em qualquer celular; .mov do iPhone pode não tocar no Android.</p>`}
        </div>${actions}`;
    }
    if (kind === "tr") {
      const typeFields = d.type === "sets"
        ? `<div class="grid3"><label class="f">Séries<input type="number" min="1" data-f="sets" value="${d.sets}"></label><label class="f">Reps<input type="number" min="1" data-f="reps" value="${d.reps}"></label><label class="f">Descanso (s)<input type="number" min="0" data-f="rest" value="${d.rest}"></label></div>`
        : d.type === "amrap"
          ? `<div class="grid3"><label class="f">AMRAP (min)<input type="number" min="1" data-f="amrap" value="${d.amrap}"></label></div>`
          : `<div class="grid2"><label class="f">Rounds<input type="number" min="1" data-f="rounds" value="${d.rounds}"></label><label class="f">Tempo de exercício (s)<input type="number" min="5" data-f="work" value="${d.work}"></label></div>
             <div class="grid2"><label class="f">Descanso entre exercícios (s)<input type="number" min="0" data-f="gap" value="${d.gap || 0}"></label><label class="f">Descanso entre rounds (s)<input type="number" min="0" data-f="rest" value="${d.rest}"></label></div>`;
      return `${back}<div class="eyebrow">${isNew ? "Novo" : "Editar"} treino</div><h1>${esc(d.name || "Treino")}</h1>
        <div class="card">
          <label class="f">Tipo de item<select data-f="role" data-redraw="1">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === roleOf(d) ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label class="f">Nome<input type="text" data-f="name" value="${esc(d.name)}" placeholder="ex.: 20-Min Full Body Kettlebell"></label>
          <div class="grid2">
            <label class="f">Categoria<select data-f="cat">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${k === d.cat ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
            <label class="f">Duração (min)<input type="number" min="1" data-f="min" value="${d.min}"></label>
          </div>
          <div class="srcbox"><div class="f">Fonte</div>
          <div class="grid2">
            <label class="f">Canal / criador<input type="text" data-f="chName" value="${esc((d.channel && d.channel.name) || "")}" placeholder="ex.: Samuel Jordan Fitness"></label>
            <label class="f">Link do canal<input type="text" inputmode="url" data-f="chUrl" value="${esc((d.channel && d.channel.url) || "")}" placeholder="https://youtube.com/@..."></label>
          </div>
          <div class="grid2">
            <label class="f">Vídeo / post<input type="text" data-f="vidTitle" value="${esc((d.video && d.video.title) || "")}" placeholder="Título do vídeo"></label>
            <label class="f">Link do vídeo<input type="text" inputmode="url" data-f="vidUrl" value="${esc((d.video && d.video.url) || "")}" placeholder="https://youtu.be/..."></label>
          </div></div>
          <label class="f">Formato<select data-f="type" data-redraw="1">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === d.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          ${typeFields}
          ${roleOf(d) === "treino" ? `<div class="grid2">
            <label class="f">Aquecimento<select data-f="warmupId">
              <option value="" ${!d.warmupId ? "selected" : ""}>Padrão do app</option>
              <option value="none" ${d.warmupId === "none" ? "selected" : ""}>Nenhum</option>
              ${Object.entries(CAT.workouts).filter(([, x]) => roleOf(x) === "aquecimento").map(([id, x]) => `<option value="${id}" ${d.warmupId === id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
            </select></label>
            <label class="f">Desaquecimento<select data-f="cooldownId">
              <option value="" ${!d.cooldownId ? "selected" : ""}>Nenhum</option>
              ${Object.entries(CAT.workouts).filter(([, x]) => roleOf(x) === "desaquecimento").map(([id, x]) => `<option value="${id}" ${d.cooldownId === id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
            </select></label>
          </div>` : `<p class="small muted">${ROLES[roleOf(d)]} pode ser só um vídeo para acompanhar (preencha o link do vídeo acima) ou ter exercícios abaixo.</p>`}
        </div>
        <div class="card">
          <h3>Exercícios</h3>
          <div class="edrows">${d.ex.map(([id, note, reps], i) => `
            <div class="edrow"><span class="ednum">${i + 1}</span>
              <select data-xq="${i}" aria-label="Exercício">${exOptions(id)}</select>
              ${d.type === "amrap" ? `<input type="number" min="1" data-xr="${i}" value="${reps || 10}" class="edreps" aria-label="Repetições" title="Repetições">` : ""}
              <input type="text" data-xn="${i}" value="${esc(note || "")}" placeholder="Observação (opcional)" aria-label="Observação">
              <span class="edbtns"><button type="button" class="btn sm ghost" data-xup="${i}" aria-label="Subir">↑</button><button type="button" class="btn sm ghost" data-xdn="${i}" aria-label="Descer">↓</button><button type="button" class="btn sm ghost" data-xrm="${i}" aria-label="Remover">✕</button></span>
            </div>`).join("") || '<p class="small muted">Nenhum exercício ainda.</p>'}</div>
          <button type="button" class="btn ghost" id="xAdd">＋ Adicionar exercício</button>
          ${d.type === "amrap" ? '<p class="small muted">No AMRAP, o número ao lado é a quantidade de repetições de cada exercício por round.</p>' : ""}
        </div>${actions}`;
    }
    // sequência
    const daysHtml = d.kind === "weekly"
      ? `<label class="f">Número de semanas<input type="number" min="1" max="52" data-f="weeks" value="${d.weeks || 4}"></label>
        <div class="edrows">${DOW_FULL.map((name, i) => `<div class="edrow dayrow"><span class="edday">${name}</span><select data-pw="${i}">${wkOptions((d.weekly || [])[i])}</select></div>`).join("")}</div>`
      : `<div class="row"><label class="f grow" style="margin:0">Quantidade de dias<input type="number" min="1" max="365" id="pN" value="${(d.days || []).length}"></label><button type="button" class="btn ghost" id="pApplyN" style="align-self:flex-end">Aplicar</button></div>
        <div class="edrows" style="margin-top:10px">${(d.days || []).map((wid, i) => `<div class="edrow dayrow"><span class="edday">Dia ${i + 1}</span><select data-pd="${i}">${wkOptions(wid)}</select></div>`).join("")}</div>`;
    return `${back}<div class="eyebrow">${isNew ? "Nova" : "Editar"} sequência</div><h1>${esc(d.name || "Sequência")}</h1>
      <div class="card">
        <label class="f">Nome<input type="text" data-f="name" value="${esc(d.name)}" placeholder="ex.: Shred 30 dias"></label>
        <label class="f">Descrição (aparece ao escolher a sequência)<textarea data-f="note" rows="2">${esc(d.note || "")}</textarea></label>
          <div class="srcbox"><div class="f">Fonte</div>
          <div class="grid2">
            <label class="f">Canal / criador<input type="text" data-f="chName" value="${esc((d.channel && d.channel.name) || "")}" placeholder="ex.: Samuel Jordan Fitness"></label>
            <label class="f">Link do canal<input type="text" inputmode="url" data-f="chUrl" value="${esc((d.channel && d.channel.url) || "")}" placeholder="https://youtube.com/@..."></label>
          </div>
          <div class="grid2">
            <label class="f">Vídeo / post<input type="text" data-f="vidTitle" value="${esc((d.video && d.video.title) || "")}" placeholder="Título do vídeo"></label>
            <label class="f">Link do vídeo<input type="text" inputmode="url" data-f="vidUrl" value="${esc((d.video && d.video.url) || "")}" placeholder="https://youtu.be/..."></label>
          </div></div>
        <label class="f">Tipo<select data-f="kind" data-redraw="1">
          <option value="days" ${d.kind !== "weekly" ? "selected" : ""}>Dias numerados (Dia 1, 2, 3…)</option>
          <option value="weekly" ${d.kind === "weekly" ? "selected" : ""}>Dias da semana (repete toda semana)</option>
        </select></label>
      </div>
      <div class="card"><h3>${d.kind === "weekly" ? "Treino de cada dia da semana" : "Treino de cada dia"}</h3>
        <p class="small muted" style="margin-top:4px">Escolha "Descanso" nos dias sem treino.</p>${daysHtml}</div>${actions}`;
  }
  function bindEditor() {
    if (!ED || !$("#edBox")) return;
    const d = ED.d, redraw = () => { $("#edBox").innerHTML = editorHtml(); bindEditor(); };
    const numF = ["sets", "reps", "rest", "min", "amrap", "rounds", "work", "weeks", "gap"];
    $$("#edBox [data-f]").forEach((el) => {
      const f = el.dataset.f;
      const apply = () => {
        let v = el.value;
        if (numF.includes(f)) v = Math.max(0, +v || 0);
        if (["chName", "chUrl", "vidTitle", "vidUrl"].includes(f)) {
          const val = (k) => ($(`[data-f="${k}"]`).value || "").trim(), url = (u) => (u && !/^https?:\/\//i.test(u) ? "https://" + u : u);
          d.channel = { name: val("chName"), url: url(val("chUrl")) };
          d.video = { title: val("vidTitle"), url: url(val("vidUrl")) };
          delete d.source;
        } else if (f === "steps" || f === "warn") {
          const st = ($('[data-f="steps"]').value || "").split("\n").map((x) => x.trim()).filter(Boolean);
          const wn = ($('[data-f="warn"]').value || "").trim();
          d.how = wn ? [...st, "Atenção: " + wn] : st;
        } else d[f] = v;
        if (f === "name") $("#edBox h1").textContent = v || "—";
        if (el.dataset.redraw) redraw();
      };
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", apply);
    });
    // treino: exercícios
    $$("[data-xq]").forEach((el) => (el.onchange = () => (d.ex[+el.dataset.xq][0] = el.value)));
    $$("[data-xn]").forEach((el) => (el.oninput = () => (d.ex[+el.dataset.xn][1] = el.value)));
    $$("[data-xr]").forEach((el) => (el.oninput = () => (d.ex[+el.dataset.xr][2] = Math.max(1, +el.value || 1))));
    $$("[data-xup]").forEach((b) => (b.onclick = () => { const i = +b.dataset.xup; if (i > 0) { [d.ex[i - 1], d.ex[i]] = [d.ex[i], d.ex[i - 1]]; redraw(); } }));
    $$("[data-xdn]").forEach((b) => (b.onclick = () => { const i = +b.dataset.xdn; if (i < d.ex.length - 1) { [d.ex[i + 1], d.ex[i]] = [d.ex[i], d.ex[i + 1]]; redraw(); } }));
    $$("[data-xrm]").forEach((b) => (b.onclick = () => { d.ex.splice(+b.dataset.xrm, 1); redraw(); }));
    const xAdd = $("#xAdd"); if (xAdd) xAdd.onclick = () => { d.ex.push([Object.entries(CAT.exercises).sort((a, b) => a[1].name.localeCompare(b[1].name))[0][0], "", 10]); redraw(); };
    // sequência: dias
    $$("[data-pd]").forEach((el) => (el.onchange = () => (d.days[+el.dataset.pd] = el.value || null)));
    $$("[data-pw]").forEach((el) => (el.onchange = () => { d.weekly = d.weekly || Array(7).fill(null); d.weekly[+el.dataset.pw] = el.value || null; }));
    const ap = $("#pApplyN"); if (ap) ap.onclick = () => {
      const n = Math.min(365, Math.max(1, +$("#pN").value || 1));
      d.days = d.days || []; while (d.days.length < n) d.days.push(null); d.days.length = n; redraw();
    };
    // exercício: demo
    const up = $("#clipUp");
    if (up) up.onchange = async () => {
      const file = up.files[0]; if (!file) return;
      if (file.size > 20 * 1024 * 1024) { toast("Vídeo maior que 20 MB. Corte ou comprima antes."); return; }
      try {
        const assets = await window.claude.use("assets");
        if (!assets) { toast("Envio de vídeos indisponível aqui"); return; }
        toast("Enviando vídeo…");
        const r = await assets.upload(file);
        d.clip = r.url; redraw(); toast("Vídeo enviado. Toque em Salvar.");
      } catch (e) { toast("Não consegui enviar: " + ((e && (e.code || e.message)) || "erro")); }
    };
    const cd = $("#clipDel"); if (cd) cd.onclick = () => { d.clip = ""; redraw(); };
    // ações
    $("#edSave").onclick = async () => {
      if (!String(d.name || "").trim()) { toast("Dê um nome antes de salvar"); return; }
      const store = ED.kind === "ex" ? CAT.exercises : ED.kind === "tr" ? CAT.workouts : CAT.programs;
      if (ED.kind === "tr") {
        if (roleOf(d) === "treino" && !d.ex.length) { toast("Adicione pelo menos um exercício"); return; }
        if (roleOf(d) !== "treino" && !d.ex.length && !(d.video && d.video.url)) { toast("Coloque o link do vídeo ou adicione exercícios"); return; }
        ["sets", "reps", "rest", "min", "amrap", "rounds", "work", "gap"].forEach((k) => (d[k] = +d[k] || 0));
        if (roleOf(d) !== "treino") { delete d.warmupId; delete d.cooldownId; }
      }
      if (ED.kind === "seq") {
        const ids = d.kind === "weekly" ? d.weekly || [] : d.days || [];
        if (!ids.some(Boolean)) { toast("Escolha pelo menos um dia com treino"); return; }
        d.weeks = Math.max(1, +d.weeks || 1);
      }
      if (ED.kind === "ex") { d.youtube = (d.youtube || "").trim(); d.q = (d.q || "").trim() || d.name; }
      const id = ED.id || newId(ED.kind === "ex" ? "e" : ED.kind === "tr" ? "t" : "p");
      store[id] = JSON.parse(JSON.stringify(d));
      if (await saveCatalog()) { toast("Salvo"); ED = null; location.hash = "gerenciar-" + (ED_KIND_TAB[store === CAT.exercises ? "ex" : store === CAT.workouts ? "tr" : "seq"]); }
    };
    const dup = $("#edDup");
    if (dup) dup.onclick = () => {
      const copy = JSON.parse(JSON.stringify(d)); copy.name = (copy.name || "") + " (cópia)";
      const kind = ED.kind; ED = { key: kind + ":novo", kind, id: null, isNew: true, d: copy };
      if (location.hash === "#editar-" + kind + "-novo") redraw(); else location.hash = "editar-" + kind + "-novo";
      toast("Cópia criada. Ajuste e salve.");
    };
    const del = $("#edDel");
    if (del) del.onclick = async () => {
      const used = ED.kind === "ex" ? exerciseUsage(ED.id) : ED.kind === "tr" ? workoutUsage(ED.id) : [];
      if (used.length) { toast("Em uso em: " + used.slice(0, 3).join(", ") + (used.length > 3 ? "…" : "")); return; }
      if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Toque de novo para excluir"; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "Excluir"; } }, 4000); return; }
      const store = ED.kind === "ex" ? CAT.exercises : ED.kind === "tr" ? CAT.workouts : CAT.programs, kind = ED.kind;
      delete store[ED.id];
      if (await saveCatalog()) { toast("Excluído"); ED = null; location.hash = "gerenciar-" + kind; }
    };
  }
  const ED_KIND_TAB = { ex: "ex", tr: "tr", seq: "seq" };

  // ---------- Init ----------
  window.addEventListener("hashchange", route);
  document.addEventListener("pointerdown", unlockAudio, true);
  // Ao abrir o app, começa sempre no Calendário
  if (location.hash && location.hash !== "#calendario") { try { history.replaceState(null, "", "#calendario"); } catch (e) { location.hash = ""; } }
  document.addEventListener("click", onVideoClick);
  activate();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && T.running) keepAwake(true); });
  route();
  cloudInit();
  if (!window.claude && window.top === window && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
