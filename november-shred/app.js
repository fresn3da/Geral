/* November Shred — app de acompanhamento
   Tudo é salvo no próprio aparelho (localStorage). Use Ajustes > Exportar para backup. */
(function () {
  "use strict";

  // ---------- Estado ----------
  const KEY = "nsc_v1";
  const DEFAULT = {
    settings: { start: "2026-11-01", level: "intermediate", bell: 12, sound: true },
    logs: {},     // { [dia]: {...} }
    body: [],     // [{ date, weight, waist }]
    videos: {},   // { [exerciseId]: url }
  };
  let S = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && raw.settings) {
        return {
          settings: Object.assign({}, DEFAULT.settings, raw.settings),
          logs: raw.logs || {}, body: raw.body || [], videos: raw.videos || {},
        };
      }
    } catch (e) { /* ignora */ }
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Não foi possível salvar"); }
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
  function dateOfDay(n) { const d = parseDate(S.settings.start); d.setDate(d.getDate() + n - 1); return d; }
  function fmtDate(d) { return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
  function todayIndex() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((t - parseDate(S.settings.start)) / 86400000) + 1; // pode ser <1 ou >30
  }
  function currentDay() { return Math.min(30, Math.max(1, todayIndex())); }
  function ytSearch(q) { return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q); }
  function exInfo(id) { const e = EXERCISES[id]; return { id, pt: e[0], en: e[1], qEn: e[2], qPt: e[3] }; }
  function getLog(n) { return S.logs[n] || null; }
  function ensureLog(n) {
    if (!S.logs[n]) S.logs[n] = { done: false, level: S.settings.level, bell: S.settings.bell, ex: {}, sets: {}, amrapRounds: 0, amrapReps: 0 };
    return S.logs[n];
  }
  const doneCount = () => WORKOUTS.filter((w) => S.logs[w.day]?.done).length;

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // Ajusta a meta conforme o nível (regras do PDF)
  function target(w, level) {
    const adv = level === "advanced", beg = level === "beginner", mob = w.cat === "mobility";
    if (w.type === "sets") return { sets: beg ? w.sets - 1 : w.sets, reps: w.reps + (adv ? 2 : 0) };
    if (w.type === "interval") return { rounds: beg ? (mob ? 2 : w.rounds - 1) : adv ? w.rounds + 1 : w.rounds };
    return { plus: adv ? 2 : 0 };
  }
  function formatChips(w, t) {
    const c = [];
    if (w.type === "sets") c.push(`${t.sets} × ${t.reps}`, `Descanso ${w.rest}s`);
    if (w.type === "amrap") c.push(`AMRAP ${w.amrap}`);
    if (w.type === "interval") c.push(`${w.work}s cada × ${t.rounds} rounds`, `Descanso ${w.rest}s`);
    c.push(`${w.min} min`);
    return c.map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  }
  function description(w, t) {
    const pre = w.cat === "mobility" ? "Kettlebell leve, lento e controlado. " : "";
    if (w.type === "sets") return `${t.sets} séries de ${t.reps} repetições de cada exercício. Descanse ${w.rest}s entre as séries e passe para o próximo.`;
    if (w.type === "amrap") return `Máximo de rounds possível em ${w.amrap} minutos. Faça as repetições indicadas e descanse só quando precisar. Anote seus rounds.`;
    return `${pre}${w.work} segundos em cada exercício, um atrás do outro. Descanse ${w.rest}s ao final de cada round. ${t.rounds} rounds.`;
  }
  function scalingKey(w) { return w.cat === "mobility" ? "mobility" : w.type; }

  // ---------- Áudio / tela ----------
  let actx = null;
  function beep(freq = 880, dur = 0.12, vol = 0.25) {
    if (!S.settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq; o.type = "square";
      g.gain.setValueAtTime(vol, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* sem áudio */ }
  }
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && "wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }

  // ---------- Timer ----------
  // segmentos: [{ phase: 'prep'|'work'|'rest', secs, label, sub, next }]
  const T = { segs: [], i: 0, endAt: 0, remain: 0, running: false, iv: null, onDone: null, lastSec: -1, mode: "" };
  function timerLoad(segs, mode, onDone) {
    timerStop(true);
    Object.assign(T, { segs, i: 0, remain: segs[0] ? segs[0].secs * 1000 : 0, running: false, onDone, lastSec: -1, mode });
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
  function timerSkip() {
    if (T.i >= T.segs.length - 1) { finishTimer(); return; }
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
      if (T.i < T.segs.length - 1) { T.i++; T.remain = T.segs[T.i].secs * 1000; T.endAt = Date.now() + T.remain; T.lastSec = -1; phaseCue(); }
      else { finishTimer(); return; }
    }
    timerPaint();
  }
  function finishTimer() {
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

  // ---------- Router ----------
  function route() {
    const h = location.hash.replace(/^#\/?/, "") || "hoje";
    const [name, arg] = h.split("/");
    timerStop(true);
    $$("#tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.tab === name || (name === "dia" && a.dataset.tab === "calendario") || (name === "exercicio" && a.dataset.tab === "exercicios")));
    const v = $("#view");
    if (name === "dia") { v.innerHTML = viewDay(+arg); bindDay(+arg); }
    else if (name === "calendario") v.innerHTML = viewCalendar();
    else if (name === "progresso") { v.innerHTML = viewProgress(); bindProgress(); }
    else if (name === "exercicios") { v.innerHTML = viewExercises(); bindExercises(); }
    else if (name === "exercicio") { v.innerHTML = viewExercise(arg); bindExercise(arg); }
    else if (name === "ajustes") { v.innerHTML = viewSettings(); bindSettings(); }
    else { v.innerHTML = viewToday(); }
    window.scrollTo(0, 0);
    updateTop();
  }
  function updateTop() { $("#topProgress").innerHTML = `<b>${doneCount()}</b>/30 treinos`; }

  // ---------- Views ----------
  function catStyle(cat) { return `--cat:${CATEGORIES[cat].color}`; }

  function viewToday() {
    const idx = todayIndex(), n = currentDay(), w = WORKOUTS[n - 1], log = getLog(n);
    const t = target(w, S.settings.level);
    let head;
    if (idx < 1) head = `<div class="eyebrow">Começa em ${1 - idx} dia(s)</div><h1>Prepare-se!</h1><p class="muted">O desafio começa em ${fmtDate(dateOfDay(1))}. Dá uma olhada no primeiro treino e nos vídeos.</p>`;
    else if (idx > 30) head = `<div class="eyebrow">Desafio encerrado</div><h1>Você chegou ao fim!</h1><p class="muted">Veja sua evolução ou refaça qualquer treino pelo calendário.</p>`;
    else head = `<div class="eyebrow">Dia ${n} de 30 · ${fmtDate(dateOfDay(n))}</div><h1>Treino de hoje</h1>`;

    const next = WORKOUTS.find((x) => !S.logs[x.day]?.done);
    return `
      ${head}
      <div class="section"></div>
      <a href="#/dia/${n}" style="text-decoration:none;color:inherit">
        <div class="card accent" style="${catStyle(w.cat)}">
          <div class="row"><span class="tag" style="${catStyle(w.cat)}">${esc(CATEGORIES[w.cat].label)}</span>${log?.done ? '<span class="lime small" style="font-weight:800">✓ Concluído</span>' : ""}</div>
          <h2 style="margin-top:10px">Dia ${n} · ${esc(w.name)}</h2>
          <div class="chips">${formatChips(w, t)}</div>
          <ol class="small muted" style="margin:6px 0 12px;padding-left:18px">${w.ex.map(([id]) => `<li>${esc(exInfo(id).pt)}</li>`).join("")}</ol>
          <span class="btn primary block">${log?.done ? "Ver / editar registro" : "Começar treino →"}</span>
        </div>
      </a>
      ${next && next.day !== n ? `<a class="btn ghost block" href="#/dia/${next.day}">Próximo pendente: Dia ${next.day} · ${esc(next.name)}</a>` : ""}
      ${statsBlock()}
      <div class="section"><h3>Antes de começar</h3></div>
      ${warmupCard(false)}
      <div class="card small">
        <b class="lime">Guia de kettlebell</b><br>
        Iniciante: 6–12 kg · Intermediário: 12–16 kg · Avançado: 16–24 kg<br>
        <span class="muted">Qualidade vence velocidade. Pare se sentir dor aguda.</span>
      </div>`;
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
      <div class="bar"><i style="width:${(d / 30) * 100}%"></i></div>`;
  }
  function streak() {
    // dias consecutivos concluídos terminando no último dia já liberado
    const maxDone = Math.max(0, ...WORKOUTS.filter((w) => S.logs[w.day]?.done).map((w) => w.day));
    let s = 0, last = Math.min(30, Math.max(0, todayIndex(), maxDone));
    if (last >= 1 && !S.logs[last]?.done) last--; // hoje ainda pode ser feito
    for (let d = last; d >= 1 && S.logs[d]?.done; d--) s++;
    return s;
  }
  function totalMinutes() {
    return WORKOUTS.reduce((a, w) => a + (S.logs[w.day]?.done ? +(S.logs[w.day].duration || w.min) : 0), 0);
  }

  function warmupCard(open) {
    return `
      <details class="card" ${open ? "open" : ""}>
        <summary>🔥 Aquecimento (5 min, todo dia)</summary>
        <p class="small muted" style="margin:8px 0 0">Com kettlebell leve, antes de toda sessão.</p>
        ${WARMUP.map(([id, note], i) => exRow(id, i + 1, note, "")).join("")}
      </details>`;
  }

  function videoButtons(id) {
    const e = exInfo(id), pin = S.videos[id];
    return `<div class="vids">
      ${pin ? `<a class="vbtn pin" href="${esc(pin)}" target="_blank" rel="noopener">★ Meu vídeo</a>` : ""}
      <a class="vbtn" href="${ytSearch(e.qEn)}" target="_blank" rel="noopener">▶ Vídeo (EN)</a>
      <a class="vbtn alt" href="${ytSearch(e.qPt)}" target="_blank" rel="noopener">▶ Vídeo (PT)</a>
    </div>`;
  }
  function exRow(id, i, note, targetTxt, extra = "") {
    const e = exInfo(id);
    return `<div class="ex">
      <div class="i">${i}</div>
      <div>
        <a class="name" href="#/exercicio/${id}" style="color:inherit;text-decoration:none">${esc(e.pt)}</a>
        ${targetTxt ? ` <span class="target">${esc(targetTxt)}</span>` : ""}
        <div class="orig">${esc(e.en)}${note ? " · " + esc(note) : ""}</div>
      </div>
      ${videoButtons(id)}
      ${extra}
    </div>`;
  }

  function viewCalendar() {
    const first = dateOfDay(1).getDay();
    const today = todayIndex();
    let cells = DOW.map((d) => `<div class="dow">${d}</div>`).join("");
    for (let i = 0; i < first; i++) cells += "<div></div>";
    WORKOUTS.forEach((w) => {
      const cls = [S.logs[w.day]?.done ? "done" : "", w.day === today ? "today" : ""].join(" ");
      cells += `<a href="#/dia/${w.day}" class="${cls}" style="${catStyle(w.cat)}"><span class="n">${w.day}</span><span class="t">${esc(w.name)}</span></a>`;
    });
    const legend = Object.values(CATEGORIES).map((c) => `<span style="--c:${c.color}">${esc(c.label)}</span>`).join("");
    const list = WORKOUTS.map((w) => `
      <a href="#/dia/${w.day}" style="${catStyle(w.cat)}">
        <span class="num">${w.day}</span>
        <span><b>${esc(w.name)}</b><br><span class="small muted">${fmtDate(dateOfDay(w.day))} · ${esc(CATEGORIES[w.cat].label)} · ${w.min} min</span></span>
        <span class="check">${S.logs[w.day]?.done ? "✓" : ""}</span>
      </a>`).join("");
    return `
      <div class="eyebrow">Seu mês</div><h1>Calendário <span class="lime">30 dias</span></h1>
      <div class="section"></div>
      <div class="cal">${cells}</div>
      <div class="legend">${legend}</div>
      <div class="card small" style="margin-top:14px"><b class="lime">A regra:</b> o mesmo tipo de treino nunca cai em dias seguidos, e a cada 7 dias tem um Mobility & Core Flow mais leve para você se recuperar.</div>
      <div class="section"><h3>Todos os treinos</h3></div>
      <div class="wlist">${list}</div>`;
  }

  function viewDay(n) {
    const w = WORKOUTS[n - 1];
    if (!w) return `<p>Dia inválido.</p>`;
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
        extra = `<div class="log"><div class="sets">${boxes}</div>
          <span>reps/série <input class="mini" type="number" inputmode="numeric" min="0" data-exreps="${i}" value="${esc(log.ex?.[i] ?? "")}" placeholder="${t.reps}"></span></div>`;
      }
      if (w.type === "interval") {
        extra = `<div class="log">reps em ${w.work}s (melhor round) <input class="mini" type="number" inputmode="numeric" min="0" data-exreps="${i}" value="${esc(log.ex?.[i] ?? "")}" placeholder="—"></div>`;
      }
      return exRow(id, i + 1, note, tgt, extra);
    }).join("");

    const prev = n > 1 ? `<a class="btn sm ghost" href="#/dia/${n - 1}">← Dia ${n - 1}</a>` : "<span></span>";
    const nxt = n < 30 ? `<a class="btn sm ghost" href="#/dia/${n + 1}">Dia ${n + 1} →</a>` : "<span></span>";

    return `
      <div class="row" style="justify-content:space-between;margin-bottom:10px">${prev}${nxt}</div>
      <div class="card accent" style="${catStyle(w.cat)}">
        <div class="row" style="justify-content:space-between">
          <span class="tag" style="${catStyle(w.cat)}">${esc(CATEGORIES[w.cat].label)}</span>
          <span class="small muted">${fmtDate(dateOfDay(n))}</span>
        </div>
        <div class="eyebrow" style="margin-top:12px">Dia ${n}</div>
        <h1>${esc(w.name)}</h1>
        <div class="chips">${formatChips(w, t)}</div>
        <p class="small muted" style="margin:6px 0 10px">${esc(description(w, t))}</p>
        <div class="seg" id="levelSeg">${Object.entries(LEVELS).map(([k, v]) => `<button data-level="${k}" class="${k === level ? "on" : ""}">${v}</button>`).join("")}</div>
      </div>

      ${warmupCard(false)}

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

      ${timerBlock(w, t, log)}

      ${logForm(w, n, log, level)}`;
  }

  function timerBlock(w, t, log) {
    let extra = "";
    if (w.type === "amrap") {
      extra = `<div class="row" style="justify-content:center;margin-top:12px">
        <button class="btn" data-round="-1">−1</button>
        <div style="min-width:110px"><div class="rounds" id="roundCount">${log.amrapRounds || 0}</div><div class="small muted">rounds</div></div>
        <button class="btn primary" data-round="1">+1 Round</button></div>`;
    }
    const title = w.type === "sets" ? `Timer de descanso (${w.rest}s)` : w.type === "amrap" ? `Timer AMRAP ${w.amrap} min` : `Timer intervalado`;
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between"><h3>⏱ ${esc(title)}</h3><button class="btn sm ghost" data-t="fs">⛶ Tela cheia</button></div>
        ${w.type === "sets" ? `<p class="small muted" style="margin:6px 0 10px">Marque cada série concluída acima — o descanso começa automaticamente.</p>` : `<div style="height:10px"></div>`}
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

  function logForm(w, n, log, level) {
    const rpe = log.rpe || 0;
    return `
      <div class="card" id="logCard">
        <h3>📝 Registro do treino</h3>
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

  function bindDay(n) {
    const w = WORKOUTS[n - 1]; if (!w) return;
    const log = () => ensureLog(n);
    const level = () => (getLog(n)?.level) || S.settings.level;
    const t = () => target(w, level());

    // Timer
    const loadTimer = () => {
      const tt = t();
      if (w.type === "sets") {
        timerLoad([{ phase: "rest", secs: w.rest, label: "Descanso entre séries", sub: "Marque a próxima série quando terminar" }], "rest");
      } else if (w.type === "amrap") {
        timerLoad([
          { phase: "prep", secs: 10, label: "Pegue o kettlebell", sub: w.ex.map(([id, , r]) => `${exInfo(id).pt} x${r + tt.plus}`).join(" · ") },
          { phase: "work", secs: w.amrap * 60, label: `AMRAP ${w.amrap} min`, sub: "Toque em +1 Round a cada volta completa" },
        ], "amrap", () => { toast("AMRAP finalizado! Registre seus rounds."); $("#logCard")?.scrollIntoView({ behavior: "smooth" }); });
      } else {
        const segs = [{ phase: "prep", secs: 10, label: "Prepare-se", sub: "Primeiro: " + exInfo(w.ex[0][0]).pt }];
        for (let r = 1; r <= tt.rounds; r++) {
          w.ex.forEach(([id], i) => {
            const nextId = w.ex[i + 1]?.[0];
            segs.push({ phase: "work", secs: w.work, label: exInfo(id).pt, sub: `Round ${r}/${tt.rounds} · ${i + 1}/${w.ex.length}` + (nextId ? ` · depois: ${exInfo(nextId).pt}` : r < tt.rounds ? " · depois: descanso" : " · último!") });
          });
          if (r < tt.rounds) segs.push({ phase: "rest", secs: w.rest, label: "Descanso", sub: `Próximo: round ${r + 1} · ${exInfo(w.ex[0][0]).pt}` });
        }
        timerLoad(segs, "interval", () => { toast("Treino concluído! Registre abaixo."); $("#logCard")?.scrollIntoView({ behavior: "smooth" }); });
      }
    };
    loadTimer();

    const box = $("#timerBox");
    $("[data-t=play]").onclick = () => (T.running ? timerPause() : timerStart());
    $("[data-t=skip]").onclick = () => timerSkip();
    $("[data-t=reset]").onclick = () => timerStop(false);
    const exitBtn = $("[data-t=exitfs]");
    $("[data-t=fs]").onclick = () => { box.classList.add("fs"); exitBtn.style.display = ""; };
    exitBtn.onclick = () => { box.classList.remove("fs"); exitBtn.style.display = "none"; };

    $$("[data-round]").forEach((b) => (b.onclick = () => {
      const l = log(); l.amrapRounds = Math.max(0, (l.amrapRounds || 0) + +b.dataset.round); save();
      $("#roundCount").textContent = l.amrapRounds; const f = $("#fRounds"); if (f) f.value = l.amrapRounds;
      if (+b.dataset.round > 0) { beep(1300, 0.08); buzz(60); }
    }));

    // Nível
    $$("#levelSeg button").forEach((b) => (b.onclick = () => { log().level = b.dataset.level; save(); route(); }));

    // Séries
    $$("[data-set]").forEach((b) => (b.onclick = () => {
      const [i, s] = b.dataset.set.split(":").map(Number);
      const l = log(); l.sets = l.sets || {}; l.sets[i] = l.sets[i] || [];
      l.sets[i][s] = !l.sets[i][s]; save();
      b.classList.toggle("on", !!l.sets[i][s]);
      const total = t().sets * w.ex.length;
      const doneSets = Object.values(l.sets).reduce((a, arr) => a + arr.filter(Boolean).length, 0);
      if (l.sets[i][s] && doneSets < total) { timerStop(false); timerStart(); }
      if (doneSets === total) toast("Todas as séries feitas! Conclua o treino abaixo.");
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
      toast(doneCount() === 30 ? "🏆 30 DIAS CONCLUÍDOS!" : `Dia ${n} concluído! 🔥`); route();
    };
    const saveBtn = $("#saveBtn");
    if (saveBtn) saveBtn.onclick = () => { collect(); save(); toast("Salvo"); };
    const undoBtn = $("#undoBtn");
    if (undoBtn) undoBtn.onclick = () => { log().done = false; save(); route(); };
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
    WORKOUTS.forEach((w) => {
      const l = S.logs[w.day]; if (!l) return;
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
    const done = WORKOUTS.filter((w) => S.logs[w.day]?.done);
    const amraps = WORKOUTS.filter((w) => w.type === "amrap" && S.logs[w.day]?.done)
      .map((w) => ({ label: "D" + w.day, y: (S.logs[w.day].amrapRounds || 0) + (S.logs[w.day].amrapReps ? 0.1 * Math.min(9, S.logs[w.day].amrapReps) : 0) }));
    const amrapTable = WORKOUTS.filter((w) => w.type === "amrap").map((w) => {
      const l = S.logs[w.day];
      return `<tr><td><a href="#/dia/${w.day}">Dia ${w.day}</a></td><td>${w.amrap} min</td><td>${l?.done ? `<b class="lime">${l.amrapRounds || 0}</b>${l.amrapReps ? ` + ${l.amrapReps} reps` : ""}` : "—"}</td><td>${l?.done && l.bell != null ? l.bell + " kg" : "—"}</td></tr>`;
    }).join("");
    const bells = done.filter((w) => S.logs[w.day].bell != null).map((w) => ({ label: "D" + w.day, y: +S.logs[w.day].bell }));
    const rpes = done.filter((w) => S.logs[w.day].rpe).map((w) => ({ label: "D" + w.day, y: S.logs[w.day].rpe }));

    // Por categoria
    const byCat = Object.entries(CATEGORIES).map(([k, c]) => {
      const all = WORKOUTS.filter((w) => w.cat === k), d = all.filter((w) => S.logs[w.day]?.done).length;
      return `<div style="margin:8px 0"><div class="row small" style="justify-content:space-between"><span>${esc(c.label)}</span><span class="muted">${d}/${all.length}</span></div><div class="bar" style="margin-top:4px"><i style="width:${(d / all.length) * 100}%;background:${c.color}"></i></div></div>`;
    }).join("");

    // Recordes por exercício
    const recs = Object.keys(EXERCISES).map((id) => {
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
          ${recs.map((r) => `<tr><td><a href="#/exercicio/${r.id}">${esc(exInfo(r.id).pt)}</a></td><td>${esc(r.best.reps)} ${r.best.type === "interval" ? "em 30s" : "reps"}</td><td>${r.best.bell != null ? esc(r.best.bell) + " kg" : "—"}</td><td>${r.best.day}</td></tr>`).join("")}</table>`
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
  function usedIn(id) { return WORKOUTS.filter((w) => w.ex.some(([e]) => e === id)).map((w) => w.day); }
  function viewExercises() {
    const ids = Object.keys(EXERCISES).sort((a, b) => exInfo(a).pt.localeCompare(exInfo(b).pt, "pt"));
    return `
      <div class="eyebrow">Biblioteca</div><h1>Exercícios <span class="lime">& vídeos</span></h1>
      <p class="small muted">${ids.length} movimentos do desafio. Toque em ▶ para ver a execução no YouTube. Achou um vídeo bom? Abra o exercício e fixe o link com ★.</p>
      <input class="search" id="exSearch" type="search" placeholder="Buscar exercício (PT ou EN)…">
      <div class="card" id="exList">
        ${ids.map((id) => `<div data-name="${esc((exInfo(id).pt + " " + exInfo(id).en).toLowerCase())}">${exRow(id, usedIn(id).length + "×", "", "", `<div class="log">Dias: ${usedIn(id).map((d) => `<a href="#/dia/${d}">${d}</a>`).join(", ") || "aquecimento"}</div>`)}</div>`).join("")}
      </div>`;
  }
  function bindExercises() {
    $("#exSearch").oninput = (e) => {
      const q = e.target.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      $$("#exList > div").forEach((d) => (d.style.display = d.dataset.name.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q) ? "" : "none"));
    };
  }
  function viewExercise(id) {
    if (!EXERCISES[id]) return `<p>Exercício não encontrado.</p>`;
    const e = exInfo(id), h = exerciseHistory(id), days = usedIn(id);
    const pts = h.filter((x) => x.reps != null && x.type !== "amrap").map((x) => ({ label: "D" + x.day, y: x.reps }));
    return `
      <a class="btn sm ghost" href="#/exercicios">← Exercícios</a>
      <div class="section"></div>
      <div class="eyebrow">${esc(e.en)}</div><h1>${esc(e.pt)}</h1>
      <div class="card">
        <h3>Vídeos</h3>
        <div style="margin:10px 0">${videoButtons(id)}</div>
        <label class="f">★ Fixar meu vídeo favorito (cole o link do YouTube)
          <input type="url" id="pinUrl" placeholder="https://youtube.com/..." value="${esc(S.videos[id] || "")}"></label>
        <div class="row"><button class="btn primary sm" id="pinSave">Salvar link</button>${S.videos[id] ? `<button class="btn ghost sm" id="pinDel">Remover</button>` : ""}</div>
      </div>
      <div class="card">
        <h3>Aparece nos dias</h3>
        <div class="chips">${days.map((d) => `<a class="chip" href="#/dia/${d}" style="text-decoration:none">Dia ${d} · ${esc(WORKOUTS[d - 1].name)}</a>`).join("") || '<span class="muted small">Aquecimento</span>'}</div>
      </div>
      <div class="card">
        <h3>Seu histórico</h3>
        ${chart(pts)}
        ${h.length ? `<table class="t" style="margin-top:8px"><tr><th>Dia</th><th>Formato</th><th>Reps</th><th>KB</th></tr>
          ${h.map((x) => `<tr><td><a href="#/dia/${x.day}">${x.day}</a></td><td>${x.type === "sets" ? "séries" : x.type === "amrap" ? "AMRAP" : "30s"}</td><td>${x.reps ?? "—"}</td><td>${x.bell != null ? esc(x.bell) + " kg" : "—"}</td></tr>`).join("")}</table>` : `<div class="empty">Ainda sem registros para este exercício.</div>`}
      </div>`;
  }
  function bindExercise(id) {
    const s = $("#pinSave"); if (!s) return;
    s.onclick = () => {
      const v = $("#pinUrl").value.trim();
      if (v && !/^https?:\/\//i.test(v)) { toast("Cole um link começando com https://"); return; }
      if (v) S.videos[id] = v; else delete S.videos[id];
      save(); toast("Vídeo salvo"); route();
    };
    const d = $("#pinDel"); if (d) d.onclick = () => { delete S.videos[id]; save(); route(); };
  }

  // ---------- Ajustes ----------
  function viewSettings() {
    const st = S.settings;
    return `
      <div class="eyebrow">Configuração</div><h1>Ajustes</h1>
      <div class="section"></div>
      <div class="card">
        <label class="f">Data de início (Dia 1)<input type="date" id="sStart" value="${esc(st.start)}"></label>
        <label class="f">Nível padrão</label>
        <div class="seg" id="sLevel">${Object.entries(LEVELS).map(([k, v]) => `<button data-level="${k}" class="${k === st.level ? "on" : ""}">${v}</button>`).join("")}</div>
        <div style="height:12px"></div>
        <label class="f">Kettlebell padrão (kg)<input type="number" inputmode="decimal" step="0.5" min="0" id="sBell" value="${esc(st.bell)}"></label>
        <label class="f" style="display:flex;align-items:center;gap:10px"><input type="checkbox" id="sSound" ${st.sound ? "checked" : ""} style="width:22px;height:22px;margin:0"> Bipes do timer</label>
      </div>
      <div class="card">
        <h3>Backup</h3>
        <p class="small muted">Seus dados ficam salvos só neste aparelho/navegador. Exporte de vez em quando para não perder nada.</p>
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
      <p class="small muted">Treino: November Shred Challenge (@trainwithpb_). Aqueça antes, hidrate-se e pare se algo parecer errado. Em caso de problemas de saúde, consulte um médico.</p>`;
  }
  function bindSettings() {
    $("#sStart").onchange = (e) => { if (e.target.value) { S.settings.start = e.target.value; save(); toast("Data atualizada"); } };
    $$("#sLevel button").forEach((b) => (b.onclick = () => { S.settings.level = b.dataset.level; save(); $$("#sLevel button").forEach((x) => x.classList.toggle("on", x === b)); }));
    $("#sBell").onchange = (e) => { S.settings.bell = +e.target.value || 0; save(); };
    $("#sSound").onchange = (e) => { S.settings.sound = e.target.checked; save(); };
    $("#exp").onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `november-shred-backup-${isoDate(new Date())}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $("#imp").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data.settings || !data.logs) throw new Error();
        if (!confirm("Substituir os dados atuais pelo backup?")) return;
        S = { settings: Object.assign({}, DEFAULT.settings, data.settings), logs: data.logs, body: data.body || [], videos: data.videos || {} };
        save(); toast("Backup importado"); route();
      } catch (err) { toast("Arquivo inválido"); }
    };
    $("#reset").onclick = () => {
      if (confirm("Apagar TODO o progresso? Isso não pode ser desfeito.")) { S = JSON.parse(JSON.stringify(DEFAULT)); save(); toast("Dados apagados"); route(); }
    };
  }

  // ---------- Init ----------
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && T.running) keepAwake(true); });
  route();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
