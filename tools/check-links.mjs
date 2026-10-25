#!/usr/bin/env node
// Checks that every RELATIVE link and image of every Markdown (and href/src of embedded HTML) points to a file or folder that exists.
// External links (http, https, mailto) and pure #anchors are not checked. Exit code 1 if something is broken.
//   node tools/check-links.mjs [root]
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, sep, parse } from 'node:path';

const root = resolve(process.argv[2] || '.');
const SKIP = new Set(['.git', 'node_modules', 'results']);

// Case-sensitive existence test on every platform: GitHub serves files from a case-sensitive file system, Windows and macOS do not.
function existsExact(p) {
  if (!existsSync(p)) return false;
  const { root: top } = parse(p);
  let cur = top;
  for (const part of p.slice(top.length).split(sep).filter(Boolean)) {
    if (!readdirSync(cur).includes(part)) return false;
    cur = join(cur, part);
  }
  return true;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith('.md')) yield p;
  }
}

// Remove fenced code blocks and inline code so that examples are not mistaken for links.
const strip = (text) => text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');

let files = 0, links = 0;
const broken = [];
for (const file of walk(root)) {
  files++;
  const text = strip(readFileSync(file, 'utf8'));
  const targets = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) targets.push(m[1]);
  for (const m of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) targets.push(m[1]);
  for (let t of targets) {
    if (/^(https?:|mailto:|#|data:)/i.test(t)) continue;
    t = decodeURIComponent(t.split('#')[0].split('?')[0]);
    if (!t) continue;
    links++;
    const target = t.startsWith('/') ? join(root, t) : resolve(dirname(file), t);
    if (!existsExact(target)) broken.push(`${relative(root, file).split(sep).join('/')}  ->  ${t}`);
  }
}

console.log(`check-links: ${files} Markdown files, ${links} relative links checked`);
if (broken.length) {
  console.error(`\n${broken.length} broken link(s):`);
  for (const b of broken) console.error('  ' + b);
  process.exit(1);
}
console.log('check-links: all relative links resolve');
