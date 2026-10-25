#!/usr/bin/env node
// A fake OpenAI-compatible provider that only LOGS what a client sends, so you can see which thinking controls, sampling values and extra fields
// your coding agent really puts on the wire (docs/en/05-thinking-budgets.md, section 2). No GPU and no model needed.
//
//   node tools/log-requests.mjs [--port 8099] [--full]
//   then point the client at http://127.0.0.1:8099/v1 (any API key, any model id) and use its thinking-level menu.
//
// One line per request: model, stream, caps, sampling, reasoning controls, chat_template_kwargs, message roles, tool count and every top-level
// field that is not part of the standard OpenAI schema (vendor-specific controls show up there). --full prints the whole request body as well
// (it can contain your prompts: do not paste it into issues without reading it). Replies with a short valid completion so the client carries on.
import http from 'node:http';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8099;
const full = args.includes('--full');

const STANDARD = new Set(['model', 'messages', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'n', 'stop', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'seed', 'tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'logprobs', 'top_logprobs']);

function summarise(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const roles = messages.map((m) => m.role);
  const extra = {};
  for (const [k, v] of Object.entries(body)) if (!STANDARD.has(k)) extra[k] = v;
  const midSystem = roles.some((r, i) => i > 0 && (r === 'system' || r === 'developer'));
  return {
    model: body.model,
    stream: !!body.stream,
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? null,
    temperature: body.temperature ?? null,
    top_p: body.top_p ?? null,
    presence_penalty: body.presence_penalty ?? null,
    messages: messages.length,
    roles: roles.length > 12 ? [...roles.slice(0, 4), '…', ...roles.slice(-4)].join(',') : roles.join(','),
    system_or_developer_after_first_message: midSystem,
    tools: Array.isArray(body.tools) ? body.tools.length : 0,
    prompt_chars: JSON.stringify(messages).length,
    controls_and_extra_fields: extra,
  };
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = req.url.split('?')[0];
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) return json(200, { object: 'list', data: [{ id: 'fake-model', object: 'model' }] });
    if (req.method === 'GET') return json(200, { status: 'ok' });
    if (req.method !== 'POST' || !url.endsWith('/chat/completions')) return json(404, { error: 'only POST /v1/chat/completions is implemented' });
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return json(400, { error: 'invalid JSON: ' + e.message }); }
    console.log(new Date().toISOString(), JSON.stringify(summarise(body)));
    if (full) console.log(JSON.stringify(body, null, 2));
    const base = { id: 'chatcmpl-log', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model || 'fake-model' };
    if (!body.stream) {
      return json(200, { ...base, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (delta, finish) => `data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.write(chunk({ role: 'assistant', content: 'ok' }, null));
    res.write(chunk({}, 'stop'));
    if (body.stream_options?.include_usage) res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});

server.listen(port, '127.0.0.1', () => console.log(`log-requests: listening on http://127.0.0.1:${port}/v1  (Ctrl+C to stop${full ? '; --full prints bodies' : ''})`));
