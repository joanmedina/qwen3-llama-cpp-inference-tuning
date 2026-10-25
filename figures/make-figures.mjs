#!/usr/bin/env node
// Generates every SVG figure of the repository (English and Spanish) from data/*.json. No dependencies.
//   node figures/make-figures.mjs
// Output: figures/en/*.svg and figures/es/*.svg
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = name => JSON.parse(readFileSync(join(ROOT, 'data', name + '.json'), 'utf8'));
const FONT = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const C = {ink: '#1f2328', mute: '#57606a', grid: '#e6e8eb', axis: '#8c959f', bg: '#ffffff', border: '#d0d7de',
  grey: '#8c959f', blue: '#0969da', green: '#1a7f37', orange: '#d4670a', purple: '#8250df', red: '#cf222e', teal: '#0a7f88', gold: '#bf8700'};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (lang, v, d = 0) => { const s = Number(v).toFixed(d); return lang === 'es' ? s.replace('.', ',') : s; };

// ---------------------------------------------------------------- layout helpers
function wrap(text, n) {
  const lines = []; let cur = '';
  for (const word of String(text).split(' ')) {
    if (cur && (cur + ' ' + word).length > n) { lines.push(cur); cur = word; } else cur = (cur + ' ' + word).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

function frame({w = 880, h = 480, title, subtitle, note, body, desc}) {
  const notes = String(note || '').split('\n');
  const titleSize = Math.min(20, Math.floor((w - 48) / (title.length * 0.6)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d" font-family='${FONT}'>
<title id="t">${esc(title)}</title><desc id="d">${esc(desc || subtitle || title)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
<text x="24" y="36" font-size="${titleSize}" font-weight="700" fill="${C.ink}">${esc(title)}</text>
${wrap(subtitle, 124).map((line, i) => `<text x="24" y="${58 + i * 15}" font-size="13" fill="${C.mute}">${esc(line)}</text>`).join('\n')}
${body}
${notes.map((n, i) => `<text x="24" y="${h - 14 - (notes.length - 1 - i) * 14}" font-size="11" fill="${C.mute}">${esc(n)}</text>`).join('\n')}
</svg>
`;
}

function nice(max, ticks = 5) {
  const raw = max / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return {step, top: Math.ceil(max / step - 1e-9) * step};
}

function legend(items, x, y, lang) {
  let cx = x, out = '';
  for (const it of items) {
    out += `<rect x="${cx}" y="${y - 10}" width="12" height="12" rx="2" fill="${it.color}"/><text x="${cx + 18}" y="${y}" font-size="12" fill="${C.ink}">${esc(it.name)}</text>`;
    cx += 18 + it.name.length * 6.6 + 22;
  }
  return out;
}

// Grouped vertical bars as an SVG fragment. series: [{name,color,values:[...]}]; annotations: {seriesIndex: [text per category]}
function groupedBars({lang, categories, series, plot, yLabel, yMax, decimals = 0, annotations = {}, valueSize = 11, highlight = {}}) {
  const {x, y, w, h} = plot;
  const max = yMax ?? Math.max(...series.flatMap(s => s.values.filter(v => v != null)));
  const {step, top} = nice(max * 1.12);
  const sy = v => y + h - (v / top) * h;
  let out = '';
  for (let t = 0; t <= top + 1e-9; t += step) {
    out += `<line x1="${x}" y1="${sy(t)}" x2="${x + w}" y2="${sy(t)}" stroke="${t === 0 ? C.axis : C.grid}" stroke-width="${t === 0 ? 1.2 : 1}"/>`;
    out += `<text x="${x - 8}" y="${sy(t) + 4}" font-size="11" text-anchor="end" fill="${C.mute}">${num(lang, t, Number.isInteger(step) ? 0 : 1)}</text>`;
  }
  if (yLabel) out += `<text transform="translate(${x - 52} ${y + h / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="${C.mute}">${esc(yLabel)}</text>`;
  const gw = w / categories.length, inner = gw * 0.78, bw = inner / series.length;
  categories.forEach((cat, i) => {
    const gx = x + i * gw + (gw - inner) / 2;
    series.forEach((s, k) => {
      const v = s.values[i];
      if (v == null) return;
      const bx = gx + k * bw, by = sy(v), color = (highlight[k] && highlight[k][i]) || s.color;
      out += `<rect x="${(bx + 1).toFixed(1)}" y="${by.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(y + h - by).toFixed(1)}" rx="2" fill="${color}"/>`;
      out += `<text x="${(bx + bw / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" font-size="${valueSize}" text-anchor="middle" fill="${C.ink}">${num(lang, v, decimals)}</text>`;
      const ann = annotations[k]?.[i];
      if (ann) out += `<text x="${(bx + bw / 2).toFixed(1)}" y="${(by - 17).toFixed(1)}" font-size="${valueSize}" font-weight="700" text-anchor="middle" fill="${String(ann).startsWith('-') ? C.red : C.green}">${esc(ann)}</text>`;
    });
    String(cat).split('\n').forEach((line, li) => {
      out += `<text x="${(x + i * gw + gw / 2).toFixed(1)}" y="${y + h + 18 + li * 14}" font-size="12" text-anchor="middle" fill="${C.ink}">${esc(line)}</text>`;
    });
  });
  return out;
}

// ---------------------------------------------------------------- strings
const T = {
  en: {
    srcDir: 'Source', tok: 'tokens/s (generation)', tokp: 'tokens/s (prompt processing)',
    f01: {title: 'Where the time goes in real agent use of Qwen3.6', sub: '461 requests from coding agents; read-only analysis of the llama-server log (before any tuning)',
      b1: 'Model time', b2: 'Prompt tokens', gen: 'Generating tokens', pp: 'Processing the prompt', cache: 'Read from the prefix cache', proc: 'Actually processed', min: 'min'},
    f02: {title: 'Qwen3.6-35B-A3B: generation speed vs MTP draft length', sub: 'More draft tokens help copying and editing code but hurt prose and reasoning (MoE: each verified token activates other experts)',
      cats: ['No\nspeculation', 'MTP 1', 'MTP 2\n(chosen)', 'MTP 3\n(server default)', 'MTP 4'], copy: 'Copy code', edit: 'Edit code', prose: 'Prose', reasoning: 'Reasoning'},
    f03: {title: 'Qwen3.6-35B-A3B: ngram-mod and repeat-penalty 1.0 on top of MTP 2', sub: 'Self-speculation only pays when the output repeats text already in the context; repeat-penalty 1.0 helps everywhere',
      cats: ['Copy code', 'Edit code', 'Edit tool call', 'Reasoning'], s0: 'MTP 2 (starting point)', s1: '+ ngram-mod', s2: '+ ngram-mod + repeat-penalty 1.0'},
    f04: {title: 'Qwen3.6-35B-A3B in the real server: before vs after', sub: 'Same four loads sent to the production router before and after the configuration change (dedicated GPU memory)',
      cats: ['Mean of\n4 loads', 'Copy code', 'Edit code', 'Edit tool call', 'Reasoning'], before: 'Before (MTP 2, repeat-penalty 1.1)', after: 'After (+ ngram-mod, repeat-penalty 1.0)'},
    f05: {title: 'Qwen3.8-27B (dense): generation speed by speculative configuration', sub: 'MTP doubles the speed of the dense model; on top of MTP 2, ngram-mod multiplies copying by 3.7 and editing by 2.5 and leaves reasoning untouched',
      cats: ['No\nspeculation', 'MTP 2', 'MTP 3', 'MTP 2 +\nngram-mod', 'MTP 3 +\nngram-mod'], copy: 'Copy code', edit: 'Edit code', tool: 'Edit tool call', reasoning: 'Reasoning'},
    f06: {title: 'Context checkpoints and RAM cache decide whether long chats survive', sub: 'Wall-clock time of one request, log scale. Hybrid (Gated DeltaNet) models cannot partially reuse a cache without a checkpoint',
      axis: 'seconds (log scale)', lb: 'lower bound: the run was cut at 300 s',
      i1: 'Qwen3.8-27B, return to a 65.7K-token chat\nafter a foreign request', i1a: 'cache-ram 4096, 32 checkpoints (state does not fit)', i1b: 'cache-ram 8192, 8 checkpoints',
      i2: 'Qwen3.6-35B-A3B, compaction summary request\n(126K-token prefix of a 161K-token chat)', i2a: '4 checkpoints', i2b: '8 checkpoints', i2c: '32 checkpoints (default)'},
    f07: {title: 'Thinking levels of Qwen3.6-35B-A3B: accuracy vs time', sub: 'Hard cap of 4,500 tokens; level = thinking budget of 512 / 2048 / 8192 tokens; one run per setting',
      easy: '10 easy problems', hard: '8 hard problems', x: 'mean time per problem (s)', y: 'correct answers (%)', off: 'Off', low: 'Low', medium: 'Medium', high: 'High', base: 'No control'},
    f08: {title: 'Prompt-processing speed falls as the context grows', sub: 'Average speed of each large chunk processed on top of the existing context (production router)',
      x: 'context size after the chunk (tokens)', q36: 'Qwen3.6-35B-A3B (MoE, 3B active)', q38: 'Qwen3.8-27B (dense)'},
    f09: {title: 'Splitting Qwen3.6 across the iGPU and an RTX 3080 Ti is slower, not faster', sub: 'Same configuration; iGPU alone (Vulkan) vs iGPU + RTX 3080 Ti (Vulkan + CUDA, tensor split 80:20); mean of two passes',
      gen: 'Generation', pp: 'Prompt processing', cats1: ['Mean of\n4 loads', 'Copy code', 'Edit code', 'Reasoning'], cats2: ['8K new\ntokens', '32K new\ntokens'], igpu: 'iGPU only', dual: 'iGPU + RTX 3080 Ti'}
  },
  es: {
    srcDir: 'Fuente', tok: 'tokens/s (generación)', tokp: 'tokens/s (lectura del prompt)',
    f01: {title: 'Dónde se va el tiempo en el uso real de Qwen3.6 por agentes', sub: '461 peticiones de agentes de programación; análisis de solo lectura del registro de llama-server (antes de ajustar nada)',
      b1: 'Tiempo del modelo', b2: 'Tokens del prompt', gen: 'Generando tokens', pp: 'Procesando el prompt', cache: 'Leído de la caché de prefijo', proc: 'Procesado de verdad', min: 'min'},
    f02: {title: 'Qwen3.6-35B-A3B: velocidad de generación según los tokens de borrador MTP', sub: 'Más tokens de borrador ayudan al copiar y editar código pero perjudican la prosa y el razonamiento (MoE: cada token verificado activa otros expertos)',
      cats: ['Sin\nespeculación', 'MTP 1', 'MTP 2\n(elegido)', 'MTP 3\n(por omisión)', 'MTP 4'], copy: 'Copiar código', edit: 'Editar código', prose: 'Prosa', reasoning: 'Razonamiento'},
    f03: {title: 'Qwen3.6-35B-A3B: ngram-mod y repeat-penalty 1.0 sobre MTP 2', sub: 'La autoespeculación solo compensa cuando la salida repite texto ya presente en el contexto; repeat-penalty 1.0 ayuda en todo',
      cats: ['Copiar código', 'Editar código', 'Llamada a\nherramienta edit', 'Razonamiento'], s0: 'MTP 2 (punto de partida)', s1: '+ ngram-mod', s2: '+ ngram-mod + repeat-penalty 1.0'},
    f04: {title: 'Qwen3.6-35B-A3B en el servidor real: antes y después', sub: 'Las mismas cuatro cargas enviadas al router de producción antes y después del cambio de configuración (memoria dedicada de la GPU)',
      cats: ['Media de\n4 cargas', 'Copiar código', 'Editar código', 'Llamada a\nherramienta edit', 'Razonamiento'], before: 'Antes (MTP 2, repeat-penalty 1.1)', after: 'Después (+ ngram-mod, repeat-penalty 1.0)'},
    f05: {title: 'Qwen3.8-27B (denso): velocidad de generación por configuración especulativa', sub: 'MTP duplica la velocidad del denso; sobre MTP 2, ngram-mod multiplica por 3,7 la copia y por 2,5 la edición y no toca el razonamiento',
      cats: ['Sin\nespeculación', 'MTP 2', 'MTP 3', 'MTP 2 +\nngram-mod', 'MTP 3 +\nngram-mod'], copy: 'Copiar código', edit: 'Editar código', tool: 'Llamada a edit', reasoning: 'Razonamiento'},
    f06: {title: 'Puntos de control y caché de RAM deciden si los chats largos sobreviven', sub: 'Tiempo real de una petición, escala logarítmica. Los modelos híbridos (Gated DeltaNet) no pueden reutilizar parte de la caché sin un punto de control',
      axis: 'segundos (escala logarítmica)', lb: 'cota inferior: la prueba se cortó a los 300 s',
      i1: 'Qwen3.8-27B, vuelta a un chat de 65,7K tokens\ntras una petición ajena', i1a: 'cache-ram 4096, 32 puntos (el estado no cabe)', i1b: 'cache-ram 8192, 8 puntos',
      i2: 'Qwen3.6-35B-A3B, petición de resumen de compactación\n(prefijo de 126K tokens de un chat de 161K)', i2a: '4 puntos de control', i2b: '8 puntos de control', i2c: '32 puntos de control (por omisión)'},
    f07: {title: 'Niveles de pensamiento de Qwen3.6-35B-A3B: aciertos frente a tiempo', sub: 'Tope duro de 4500 tokens; nivel = presupuesto de pensamiento de 512 / 2048 / 8192 tokens; una ejecución por ajuste',
      easy: '10 problemas fáciles', hard: '8 problemas difíciles', x: 'tiempo medio por problema (s)', y: 'respuestas correctas (%)', off: 'Off', low: 'Low', medium: 'Medium', high: 'High', base: 'Sin control'},
    f08: {title: 'La lectura del prompt se ralentiza al crecer el contexto', sub: 'Velocidad media de cada bloque grande procesado sobre el contexto existente (router de producción)',
      x: 'tamaño del contexto tras el bloque (tokens)', q36: 'Qwen3.6-35B-A3B (MoE, 3B activos)', q38: 'Qwen3.8-27B (denso)'},
    f09: {title: 'Repartir Qwen3.6 entre la iGPU y una RTX 3080 Ti es más lento, no más rápido', sub: 'Misma configuración; solo la iGPU (Vulkan) frente a iGPU + RTX 3080 Ti (Vulkan + CUDA, reparto 80:20); media de dos pasadas',
      gen: 'Generación', pp: 'Lectura del prompt', cats1: ['Media de\n4 cargas', 'Copiar código', 'Editar código', 'Razonamiento'], cats2: ['8K tokens\nnuevos', '32K tokens\nnuevos'], igpu: 'Solo iGPU', dual: 'iGPU + RTX 3080 Ti'}
  }
};

// ---------------------------------------------------------------- figures
const figures = [];

figures.push(['fig01-where-the-time-goes', lang => {
  const t = T[lang].f01, d = data('real-usage-profile').qwen36;
  const x0 = 220, w = 616;
  const bar = (y, parts) => {
    let cx = x0, out = '';
    for (const p of parts) {
      const pw = w * p.share;
      out += `<rect x="${cx.toFixed(1)}" y="${y}" width="${pw.toFixed(1)}" height="64" fill="${p.color}"/>`;
      if (p.share >= 0.1) out += `<text x="${(cx + pw / 2).toFixed(1)}" y="${y + 28}" font-size="${Math.min(15, Math.floor(pw / (p.top.length * 0.62)))}" font-weight="700" text-anchor="middle" fill="#fff">${esc(p.top)}</text>`;
      if (p.share >= 0.1) out += `<text x="${(cx + pw / 2).toFixed(1)}" y="${y + 48}" font-size="12" text-anchor="middle" fill="#fff">${esc(p.bottom)}</text>`;
      cx += pw;
    }
    return out;
  };
  const gen = d.generation_time_min, pp = d.prompt_time_min, shareGen = gen / (gen + pp);
  const procShare = d.prompt_processed_share_pct / 100;
  let body = '';
  body += `<text x="24" y="150" font-size="14" font-weight="700" fill="${C.ink}">${esc(t.b1)}</text>`;
  body += `<text x="24" y="170" font-size="12" fill="${C.mute}">${num(lang, gen + pp, 1)} ${t.min}</text>`;
  body += bar(118, [{share: shareGen, color: C.blue, top: `${t.gen}`, bottom: `${num(lang, gen, 1)} ${t.min} · ${num(lang, 100 * shareGen, 0)} %`},
    {share: 1 - shareGen, color: C.grey, top: `${t.pp}`, bottom: `${num(lang, pp, 1)} ${t.min}`}]);
  body += `<text x="24" y="280" font-size="14" font-weight="700" fill="${C.ink}">${esc(t.b2)}</text>`;
  body += `<text x="24" y="300" font-size="12" fill="${C.mute}">${num(lang, d.prompt_tokens_total / 1e6, 2)} M</text>`;
  body += bar(248, [{share: 1 - procShare, color: C.green, top: `${t.cache}`, bottom: `${num(lang, 100 - d.prompt_processed_share_pct, 1)} %`},
    {share: procShare, color: C.orange, top: `${num(lang, d.prompt_processed_share_pct, 1)} %`, bottom: ''}]);
  body += `<text x="${x0 + w}" y="338" font-size="12" text-anchor="end" fill="${C.orange}">${esc(t.proc)}: ${num(lang, d.prompt_processed_share_pct, 1)} %</text>`;
  body += `<text x="24" y="392" font-size="13" fill="${C.ink}">${lang === 'es'
    ? 'La generación domina; el prompt apenas cuesta porque la caché de prefijo funciona. Por eso se acelera la generación y se protege la caché.'
    : 'Generation dominates; the prompt is cheap because the prefix cache works. Hence: speed up generation and protect the cache.'}</text>`;
  return frame({h: 440, title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/real-usage-profile.json`});
}]);

figures.push(['fig02-qwen36-mtp-draft-length', lang => {
  const t = T[lang].f02, d = data('qwen36-mtp-draft-length');
  const pick = k => d.variants.map(v => v.tg[k]);
  const body = groupedBars({lang, categories: t.cats, plot: {x: 78, y: 86, w: 780, h: 296}, yLabel: T[lang].tok, decimals: 0, valueSize: 10,
    series: [{name: t.copy, color: C.blue, values: pick('copy')}, {name: t.edit, color: C.teal, values: pick('edit')},
      {name: t.prose, color: C.orange, values: pick('prose')}, {name: t.reasoning, color: C.purple, values: pick('reasoning')}]})
    + legend([{name: t.copy, color: C.blue}, {name: t.edit, color: C.teal}, {name: t.prose, color: C.orange}, {name: t.reasoning, color: C.purple}], 78, 440, lang);
  return frame({title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/qwen36-mtp-draft-length.json ${lang === "es" ? "(router temporal, iGPU, llama.cpp b11721)" : "(temporary router, iGPU, llama.cpp b11721)"}`});
}]);

figures.push(['fig03-qwen36-ngram-mod-repeat-penalty', lang => {
  const t = T[lang].f03, d = data('qwen36-ngram-mod-repeat-penalty').tuning_table;
  const row = id => d.variants.find(v => v.id === id).values;           // [mean, edit_tool, copy, edit, reasoning]
  const base = row('today'), a = row('ngram-default'), b = row('ngram-default-rp1');
  const idx = {copy: 2, edit: 3, tool: 1, reasoning: 4};
  const pickRow = r => [r[idx.copy], r[idx.edit], r[idx.tool], r[idx.reasoning]];
  const pct = (x, y) => `+${Math.round(100 * (x / y - 1))}%`;
  const body = groupedBars({lang, categories: t.cats, plot: {x: 78, y: 86, w: 780, h: 296}, yLabel: T[lang].tok, decimals: 0, valueSize: 11,
    series: [{name: t.s0, color: C.grey, values: pickRow(base)}, {name: t.s1, color: C.blue, values: pickRow(a)}, {name: t.s2, color: C.green, values: pickRow(b)}],
    annotations: {2: pickRow(b).map((v, i) => pct(v, pickRow(base)[i]))}})
    + legend([{name: t.s0, color: C.grey}, {name: t.s1, color: C.blue}, {name: t.s2, color: C.green}], 78, 440, lang);
  return frame({title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/qwen36-ngram-mod-repeat-penalty.json ${lang === "es" ? "(router temporal, 3 fragmentos, 1 semilla)" : "(temporary router, 3 fragments, 1 seed)"}`});
}]);

figures.push(['fig04-qwen36-production-before-after', lang => {
  const t = T[lang].f04, d = data('qwen36-production-before-after');
  const o = [0, 2, 3, 1, 4];                                            // mean, copy, edit, edit_tool, reasoning (data order: mean, edit_tool, copy, edit, reasoning)
  const bef = o.map(i => d.before[i]), aft = o.map(i => d.after[i]);
  const body = groupedBars({lang, categories: t.cats, plot: {x: 78, y: 86, w: 780, h: 296}, yLabel: T[lang].tok, decimals: 1, valueSize: 11,
    series: [{name: t.before, color: C.grey, values: bef}, {name: t.after, color: C.green, values: aft}],
    annotations: {1: aft.map((v, i) => `+${Math.round(100 * (v / bef[i] - 1))}%`)}})
    + legend([{name: t.before, color: C.grey}, {name: t.after, color: C.green}], 78, 440, lang);
  return frame({title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/qwen36-production-before-after.json ${lang === "es" ? "(23/10/2026, router de producción :8080)" : "(2026-10-23, production router :8080)"}`});
}]);

figures.push(['fig05-qwen38-speculative-decoding', lang => {
  const t = T[lang].f05, d = data('qwen38-speculative-decoding');       // values: [mean, edit_tool, copy, edit, reasoning]
  const pick = i => d.variants.map(v => v.values[i]);
  const body = groupedBars({lang, categories: t.cats, plot: {x: 78, y: 86, w: 780, h: 296}, yLabel: T[lang].tok, decimals: 0, valueSize: 10,
    series: [{name: t.copy, color: C.blue, values: pick(2)}, {name: t.edit, color: C.teal, values: pick(3)},
      {name: t.tool, color: C.orange, values: pick(1)}, {name: t.reasoning, color: C.purple, values: pick(4)}]})
    + legend([{name: t.copy, color: C.blue}, {name: t.edit, color: C.teal}, {name: t.tool, color: C.orange}, {name: t.reasoning, color: C.purple}], 78, 440, lang);
  return frame({title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/qwen38-speculative-decoding.json ${lang === "es" ? "(router temporal, iGPU, 1 semilla)" : "(temporary router, iGPU, 1 seed)"}`});
}]);

figures.push(['fig06-checkpoints-and-ram-cache', lang => {
  const t = T[lang].f06, x0 = 400, w = 450, min = 1, max = 1000;
  const sx = v => x0 + (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) * w;
  let body = '';
  for (const tick of [1, 10, 100, 1000]) {
    body += `<line x1="${sx(tick)}" y1="92" x2="${sx(tick)}" y2="372" stroke="${C.grid}"/><text x="${sx(tick)}" y="390" font-size="11" text-anchor="middle" fill="${C.mute}">${tick}</text>`;
  }
  body += `<text x="${x0 + w / 2}" y="410" font-size="12" text-anchor="middle" fill="${C.mute}">${esc(t.axis)}</text>`;
  const groups = [
    {title: t.i1, items: [{name: t.i1a, v: 300, c: C.red, lb: true}, {name: t.i1b, v: 13.6, c: C.green}]},
    {title: t.i2, items: [{name: t.i2a, v: 313, c: C.red}, {name: t.i2b, v: 14.7, c: C.green}, {name: t.i2c, v: 15.2, c: C.blue}]},
  ];
  let y = 100;
  for (const g of groups) {
    g.title.split('\n').forEach((line, i) => { body += `<text x="24" y="${y + 6 + i * 15}" font-size="13" font-weight="700" fill="${C.ink}">${esc(line)}</text>`; });
    y += 34;
    for (const it of g.items) {
      body += `<text x="${x0 - 10}" y="${y + 17}" font-size="12" text-anchor="end" fill="${C.ink}">${esc(it.name)}</text>`;
      body += `<rect x="${x0}" y="${y}" width="${(sx(it.v) - x0).toFixed(1)}" height="26" rx="3" fill="${it.c}"/>`;
      body += `<text x="${(sx(it.v) + 8).toFixed(1)}" y="${y + 17}" font-size="12" font-weight="700" fill="${C.ink}">${it.lb ? '≥ ' : ''}${num(lang, it.v, it.v < 100 ? 1 : 0)} s</text>`;
      y += 34;
    }
    y += 26;
  }
  body += `<text x="${x0}" y="426" font-size="11" fill="${C.mute}">≥ ${esc(t.lb)}</text>`;
  return frame({h: 470, title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/prompt-cache-checkpoints.json`});
}]);

figures.push(['fig07-thinking-levels', lang => {
  const t = T[lang].f07, d = data('thinking-budget-levels');
  const panel = (x0, name, pts, xMax, xStep) => {
    const px = x0, py = 100, pw = 380, ph = 270;
    const sx = v => px + v / xMax * pw, sy = v => py + ph - v / 112 * ph;
    let out = `<text x="${px}" y="${py - 14}" font-size="14" font-weight="700" fill="${C.ink}">${esc(name)}</text>`;
    for (let v = 0; v <= 100; v += 25) out += `<line x1="${px}" y1="${sy(v)}" x2="${px + pw}" y2="${sy(v)}" stroke="${v === 0 ? C.axis : C.grid}"/><text x="${px - 8}" y="${sy(v) + 4}" font-size="11" text-anchor="end" fill="${C.mute}">${v}</text>`;
    for (let v = 0; v <= xMax; v += xStep) out += `<text x="${sx(v)}" y="${py + ph + 16}" font-size="11" text-anchor="middle" fill="${C.mute}">${num(lang, v, 0)}</text>`;
    out += `<text x="${px + pw / 2}" y="${py + ph + 36}" font-size="12" text-anchor="middle" fill="${C.mute}">${esc(t.x)}</text>`;
    out += `<text transform="translate(${px - 40} ${py + ph / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="${C.mute}">${esc(t.y)}</text>`;
    for (const p of pts) {
      out += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="7" fill="${p.c}" stroke="#fff" stroke-width="1.5"/>`;
      out += `<text x="${(sx(p.x) + (p.dx ?? 12)).toFixed(1)}" y="${(sy(p.y) + (p.dy ?? 4)).toFixed(1)}" font-size="12" font-weight="700" text-anchor="${p.a ?? 'start'}" fill="${C.ink}">${esc(p.l)}</text>`;
    }
    return out;
  };
  const e = d.easy_10, h = d.hard_8;
  const easy = [{l: `${t.base} (${num(lang, e.mean_time_s.base, 1)} s)`, x: e.mean_time_s.base, y: e.correct.base * 10, c: C.grey, dx: -12, dy: 22, a: 'end'},
    {l: t.off, x: e.mean_time_s.off, y: e.correct.off * 10, c: C.red}, {l: t.low, x: e.mean_time_s.low, y: e.correct.low * 10, c: C.green, dy: -12, dx: 0, a: 'middle'},
    {l: t.medium, x: e.mean_time_s.medium, y: e.correct.medium * 10, c: C.blue, dx: 4, dy: -14, a: 'middle'}, {l: t.high, x: e.mean_time_s.high, y: e.correct.high * 10, c: C.orange}];
  const hard = [{l: t.off, x: h.mean_time_s.off, y: h.correct.off / 8 * 100, c: C.red}, {l: t.low, x: h.mean_time_s.low, y: h.correct.low / 8 * 100, c: C.green},
    {l: t.medium, x: h.mean_time_s.medium, y: h.correct.medium / 8 * 100, c: C.blue, dy: -12, dx: 0, a: 'middle'}, {l: t.high, x: h.mean_time_s.high, y: h.correct.high / 8 * 100, c: C.orange, dx: -12, dy: 22, a: 'end'}];
  const body = panel(78, t.easy, easy, 25, 5) + panel(490, t.hard, hard, 40, 10);
  return frame({title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/thinking-budget-levels.json`});
}]);

figures.push(['fig08-prompt-speed-vs-context', lang => {
  const t = T[lang].f08, d = data('prompt-processing-speed');
  const px = 78, py = 90, pw = 770, ph = 290, xMax = 220000, yMax = 800;
  const sx = v => px + v / xMax * pw, sy = v => py + ph - v / yMax * ph;
  let body = '';
  for (let v = 0; v <= yMax; v += 200) body += `<line x1="${px}" y1="${sy(v)}" x2="${px + pw}" y2="${sy(v)}" stroke="${v === 0 ? C.axis : C.grid}"/><text x="${px - 8}" y="${sy(v) + 4}" font-size="11" text-anchor="end" fill="${C.mute}">${v}</text>`;
  for (let v = 0; v <= xMax; v += 50000) body += `<text x="${sx(v)}" y="${py + ph + 18}" font-size="11" text-anchor="middle" fill="${C.mute}">${v / 1000}k</text>`;
  body += `<text x="${px + pw / 2}" y="${py + ph + 40}" font-size="12" text-anchor="middle" fill="${C.mute}">${esc(t.x)}</text>`;
  body += `<text transform="translate(${px - 52} ${py + ph / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="${C.mute}">${esc(T[lang].tokp)}</text>`;
  const series = [
    {name: t.q36, color: C.blue, dash: '', pts: d.qwen36_vs_context_depth.points.map(p => [p.context_after, p.tok_s])},
    {name: t.q38, color: C.orange, dash: '6 4', pts: d.qwen38_vs_context_depth.points.map(p => [p.context_mid, p.tok_s])},
  ];
  for (const s of series) {
    body += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} points="${s.pts.map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}"/>`;
    for (const p of s.pts) body += `<circle cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="5" fill="${s.color}" stroke="#fff"/><text x="${(sx(p[0]) + 8).toFixed(1)}" y="${(sy(p[1]) - 9).toFixed(1)}" font-size="12" font-weight="700" fill="${C.ink}">${p[1]}</text>`;
  }
  body += legend(series.map(s => ({name: s.name, color: s.color})), 78, 440, lang);
  return frame({title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/prompt-processing-speed.json\n${lang === 'es'
    ? 'Qwen3.6: contexto tras cada bloque de 43-55K tokens. Qwen3.8: punto medio de los rangos 2-30K y 45-65K (del registro del servidor).'
    : 'Qwen3.6: context after each 43-55K-token chunk. Qwen3.8: midpoints of the 2-30K and 45-65K ranges (from the server log).'}`});
}]);

figures.push(['fig09-igpu-vs-dual-gpu', lang => {
  const t = T[lang].f09, d = data('dual-gpu-vs-igpu-only');
  const get = m => d.rows.find(r => r.metric === m);
  const mean = r => [r.igpu_only[0], r.dual[0]];
  const gen = ['generation, mean of 4 loads', 'copy code', 'rewrite with comments', 'free reasoning'].map(m => mean(get(m)));
  const pp = ['prompt, 8K new tokens', 'prompt, 32K new tokens'].map(m => mean(get(m)));
  const left = groupedBars({lang, categories: t.cats1, plot: {x: 78, y: 110, w: 420, h: 262}, yLabel: T[lang].tok, decimals: 0,
    series: [{name: t.igpu, color: C.blue, values: gen.map(g => g[0])}, {name: t.dual, color: C.grey, values: gen.map(g => g[1])}],
    annotations: {1: gen.map(g => `${Math.round(100 * (g[1] / g[0] - 1))}%`)}});
  const right = groupedBars({lang, categories: t.cats2, plot: {x: 576, y: 110, w: 280, h: 262}, yLabel: T[lang].tokp, decimals: 0,
    series: [{name: t.igpu, color: C.blue, values: pp.map(g => g[0])}, {name: t.dual, color: C.grey, values: pp.map(g => g[1])}],
    annotations: {1: pp.map(g => `${Math.round(100 * (g[1] / g[0] - 1))}%`)}});
  const body = `<text x="78" y="96" font-size="14" font-weight="700" fill="${C.ink}">${esc(t.gen)}</text><text x="576" y="96" font-size="14" font-weight="700" fill="${C.ink}">${esc(t.pp)}</text>`
    + left + right + legend([{name: t.igpu, color: C.blue}, {name: t.dual, color: C.grey}], 78, 448, lang);
  return frame({title: t.title, subtitle: t.sub, body, note: `${T[lang].srcDir}: data/dual-gpu-vs-igpu-only.json`});
}]);

// ---------------------------------------------------------------- social preview (1280 x 640, the image GitHub shows when the repository is shared)
function socialPreview() {
  const p = data('qwen36-production-before-after'), q = data('qwen38-speculative-decoding'), c = data('prompt-cache-checkpoints').qwen36_compaction_summary_request.rows;
  const q38 = id => q.variants.find(v => v.id === id).values[0];
  const slow = c.find(r => r.checkpoints === 4).summary_s, fast = c.find(r => r.checkpoints === 8).summary_s;
  const tile = (x, big, l1, l2) => `<rect x="${x}" y="330" width="368" height="190" rx="14" fill="#f6f8fa" stroke="${C.border}"/>`
    + `<text x="${x + 184}" y="423" font-size="68" font-weight="800" text-anchor="middle" fill="${C.green}">${esc(big)}</text>`
    + `<text x="${x + 184}" y="466" font-size="22" font-weight="600" text-anchor="middle" fill="${C.ink}">${esc(l1)}</text>`
    + `<text x="${x + 184}" y="496" font-size="18" text-anchor="middle" fill="${C.mute}">${esc(l2)}</text>`;
  const title = 'Qwen3.6 & Qwen3.8 on llama.cpp: faster local inference';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640" role="img" aria-labelledby="t d" font-family='${FONT}'>
<title id="t">${esc(title)}</title><desc id="d">MTP and n-gram speculative decoding, prompt-cache tuning and thinking budgets on an AMD Ryzen AI Max+ 395 (Strix Halo)</desc>
<rect width="1280" height="640" fill="${C.bg}"/><rect width="1280" height="12" fill="${C.blue}"/>
<text x="60" y="78" font-size="24" font-weight="600" fill="${C.blue}">llama.cpp  ·  Vulkan  ·  AMD Ryzen AI Max+ 395 (Strix Halo)</text>
<text x="60" y="160" font-size="60" font-weight="800" fill="${C.ink}">Qwen3.6 &amp; Qwen3.8 on llama.cpp</text>
<text x="60" y="214" font-size="30" fill="${C.ink}">MTP + n-gram speculative decoding</text>
<text x="60" y="256" font-size="30" fill="${C.ink}">Prompt-cache checkpoints · 262K context · thinking budgets</text>
<text x="60" y="304" font-size="20" fill="${C.mute}">Measured on one machine, with the data, the scripts and the configurations to repeat it</text>
${tile(60, `+${Math.round(100 * (p.after[0] / p.before[0] - 1))} %`, 'Qwen3.6-35B-A3B generation', `${num('en', p.before[0], 1)} → ${num('en', p.after[0], 1)} tok/s`)}
${tile(456, `×${num('en', q38('mtp2-ngram') / q38('none'), 1)}`, 'Qwen3.8-27B generation', `${num('en', q38('none'), 1)} → ${num('en', q38('mtp2-ngram'), 1)} tok/s`)}
${tile(852, `−${Math.round(100 * (1 - fast / slow))} %`, 'Context-compaction time', `${num('en', slow, 0)} s → ${num('en', fast, 1)} s`)}
<text x="60" y="590" font-size="22" fill="${C.mute}">Configs · benchmarks · charts · raw data  —  English / Español  —  MIT</text>
</svg>
`;
}

// ---------------------------------------------------------------- write
for (const lang of ['en', 'es']) {
  mkdirSync(join(ROOT, 'figures', lang), {recursive: true});
  for (const [name, make] of figures) writeFileSync(join(ROOT, 'figures', lang, `${name}.svg`), make(lang));
}
writeFileSync(join(ROOT, 'figures', 'social-preview.svg'), socialPreview());
console.log(`${figures.length} figures x 2 languages written to figures/{en,es}/ and figures/social-preview.svg`);
