#!/usr/bin/env node
// gguf-header: reads ONLY the header of a GGUF file (metadata and tensor list; never the weights) and tells you what it is:
// architecture, layer count, MTP ("nextn") layers, context length and quantisation mix. Use it before downloading a 20 GB
// file you are not sure about (the first MB of a file is enough: `curl -r 0-16777215`) and to check that a GGUF really ships the MTP head.
//
//   node tools/gguf-header.mjs <file.gguf>
//   node tools/gguf-header.mjs --compare <a.gguf> <b.gguf>     compares tensor names, shapes and types of two files
//   node tools/gguf-header.mjs --chat-template <file.gguf>     prints the chat template embedded in the file
//
// GGUF v3 layout: "GGUF", version u32, tensor count u64, key/value count u64, key/value pairs (name, type, value), tensor infos
// (name, dimensions, ggml type, offset). No dependencies.
import {openSync, readSync, statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

class Reader {
  constructor(path) { this.fd = openSync(path, 'r'); this.size = statSync(path).size; this.pos = 0; this.buf = Buffer.alloc(0); this.start = 0; }
  take(n) {
    if (!(this.pos >= this.start && this.pos + n <= this.start + this.buf.length)) {
      const b = Buffer.alloc(Math.min(Math.max(n, 16 << 20), this.size - this.pos));
      readSync(this.fd, b, 0, b.length, this.pos);
      this.buf = b; this.start = this.pos;
      if (b.length < n) throw new Error('unexpected end of file: the header is truncated');
    }
    const o = this.pos - this.start; this.pos += n; return o;
  }
  u8() { return this.buf[this.take(1)]; }
  i8() { return this.buf.readInt8(this.take(1)); }
  u16() { return this.buf.readUInt16LE(this.take(2)); }
  i16() { return this.buf.readInt16LE(this.take(2)); }
  u32() { return this.buf.readUInt32LE(this.take(4)); }
  i32() { return this.buf.readInt32LE(this.take(4)); }
  f32() { return this.buf.readFloatLE(this.take(4)); }
  u64() { return Number(this.buf.readBigUInt64LE(this.take(8))); }
  i64() { return Number(this.buf.readBigInt64LE(this.take(8))); }
  f64() { return this.buf.readDoubleLE(this.take(8)); }
  text(n) { const o = this.take(n); return this.buf.toString('utf8', o, o + n); }
  str() { return this.text(this.u64()); }
}

function value(r, type, keep = true) {
  switch (type) {
    case 0: return r.u8(); case 1: return r.i8(); case 2: return r.u16(); case 3: return r.i16(); case 4: return r.u32(); case 5: return r.i32();
    case 6: return r.f32(); case 7: return r.u8() !== 0; case 8: return r.str();
    case 9: { const t = r.u32(), n = r.u64(), out = keep && n <= 64 ? [] : null; for (let i = 0; i < n; i++) { const v = value(r, t, false); if (out) out.push(v); } return out ?? `[${n} elements of type ${t}]`; }
    case 10: return r.u64(); case 11: return r.i64(); case 12: return r.f64();
    default: throw new Error(`unknown GGUF value type ${type}`);
  }
}

export const GGML_TYPES = {0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 6: 'Q5_0', 7: 'Q5_1', 8: 'Q8_0', 9: 'Q8_1', 10: 'Q2_K', 11: 'Q3_K', 12: 'Q4_K', 13: 'Q5_K', 14: 'Q6_K', 15: 'Q8_K',
  16: 'IQ2_XXS', 17: 'IQ2_XS', 18: 'IQ3_XXS', 19: 'IQ1_S', 20: 'IQ4_NL', 21: 'IQ3_S', 22: 'IQ2_S', 23: 'IQ4_XS', 24: 'I8', 25: 'I16', 26: 'I32', 27: 'I64', 28: 'F64', 29: 'IQ1_M', 30: 'BF16'};

export function readHeader(path) {
  const r = new Reader(path);
  const magic = r.text(4);
  if (magic !== 'GGUF') throw new Error(`${path}: not a GGUF file (starts with "${magic}")`);
  const version = r.u32(), tensorCount = r.u64(), kvCount = r.u64();
  const kv = {};
  for (let i = 0; i < kvCount; i++) { const key = r.str(); kv[key] = value(r, r.u32()); }
  const tensors = [];
  for (let i = 0; i < tensorCount; i++) {
    const name = r.str(), nd = r.u32(), dims = [];
    for (let d = 0; d < nd; d++) dims.push(r.u64());
    tensors.push({name, dims, type: r.u32(), offset: r.u64()});
  }
  return {path, bytes: statSync(path).size, version, tensorCount, kv, tensors};
}

function summary(h) {
  const arch = h.kv['general.architecture'], key = k => h.kv[`${arch}.${k}`];
  const types = {};
  for (const t of h.tensors) { const n = GGML_TYPES[t.type] ?? `type ${t.type}`; types[n] = (types[n] ?? 0) + 1; }
  const blocks = new Set(h.tensors.map(t => /^blk\.(\d+)\./.exec(t.name)?.[1]).filter(x => x !== undefined));
  return {
    file: h.path, size_GB: +(h.bytes / 1e9).toFixed(2), gguf_version: h.version, tensors: h.tensorCount,
    architecture: arch, name: h.kv['general.name'], file_type: h.kv['general.file_type'],
    blocks_with_tensors: blocks.size, block_count: key('block_count'), nextn_predict_layers: key('nextn_predict_layers'),
    experts: key('expert_count'), experts_used: key('expert_used_count'), context_length: key('context_length'), embedding_length: key('embedding_length'),
    heads: key('attention.head_count'), kv_heads: key('attention.head_count_kv'), full_attention_interval: key('full_attention_interval'),
    tokenizer: h.kv['tokenizer.ggml.model'], chat_template_chars: (h.kv['tokenizer.chat_template'] || '').length,
    clip_projector: h.kv['clip.projector_type'], clip_vision_layers: h.kv['clip.vision.block_count'],
    mtp_tensors: h.tensors.filter(t => /nextn|\.mtp\./i.test(t.name)).map(t => t.name), quantisation_by_type: types,
  };
}

function compare(a, b) {
  const ma = new Map(a.tensors.map(t => [t.name, t])), mb = new Map(b.tensors.map(t => [t.name, t]));
  const onlyA = [...ma.keys()].filter(k => !mb.has(k)), onlyB = [...mb.keys()].filter(k => !ma.has(k));
  const shapes = [...ma.keys()].filter(k => mb.has(k) && ma.get(k).dims.join('x') !== mb.get(k).dims.join('x'));
  const types = [...ma.keys()].filter(k => mb.has(k) && ma.get(k).type !== mb.get(k).type);
  return {tensors_a: ma.size, tensors_b: mb.size, only_in_a: onlyA.slice(0, 20), only_in_b: onlyB.slice(0, 20), count_only_a: onlyA.length, count_only_b: onlyB.length,
    different_shape: shapes.slice(0, 20), count_different_shape: shapes.length, count_different_quantisation: types.length};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--chat-template' && args.length === 2) process.stdout.write(readHeader(args[1]).kv['tokenizer.chat_template'] ?? '');
  else if (args[0] === '--compare' && args.length === 3) console.log(JSON.stringify(compare(readHeader(args[1]), readHeader(args[2])), null, 1));
  else if (args.length === 1) console.log(JSON.stringify(summary(readHeader(args[0])), null, 1));
  else { console.error('usage: node tools/gguf-header.mjs <file.gguf> | --compare <a.gguf> <b.gguf> | --chat-template <file.gguf>'); process.exit(2); }
}
