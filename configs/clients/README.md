# Client-side settings

Server-side tuning only pays off if the **client** (the coding agent) agrees with it. Three settings of the client must match the server, and one habit saves a lot of debugging.

| # | Client setting | Rule | Why | Details |
|---|---|---|---|---|
| 1 | **Context window** the client believes it has | exactly the server's real per-slot context (`n_ctx_slot` in the log, or `n_ctx` under `default_generation_settings` in `GET /props`) | with a larger number the client never reaches its compaction threshold and the server truncates (*"Output token limit reached"*) | [doc 04 §6](../../docs/en/04-prompt-cache-context-compaction.md) |
| 2 | **Thinking levels** | map every entry of the menu to what the chat template understands | an "Off" that sends nothing does not switch thinking off; Qwen3.8 answers HTTP 500 to `reasoning_effort: high` | [doc 05 §2](../../docs/en/05-thinking-budgets.md) |
| 3 | **Compaction threshold** | clearly below the window, with headroom for one large tool result | the margin decides whether a single huge result can overflow before compaction acts | [doc 04 §5–7](../../docs/en/04-prompt-cache-context-compaction.md) |
| 4 | **Habit: look at the wire** | log what your client really sends before assuming | every one of the failures above was invisible in the client's own menu | [`tools/log-requests.mjs`](../../tools/log-requests.mjs) |

## Files

| File | What it is |
|---|---|
| [`thinking-levels.json`](thinking-levels.json) | the Off / Low / Medium / High mapping for Qwen3.6 and Qwen3.8 as data: the exact fields to add to the request body |
| [`opencode.example.json`](opencode.example.json) | an [OpenCode](https://opencode.ai) provider with the three models and their variants (`limit.context` = the server's real context) |
| [`litellm.example.yaml`](litellm.example.yaml) | a [LiteLLM](https://docs.litellm.ai) proxy with one alias per (model, thinking level) |
| [`agent-harness.example.yml`](agent-harness.example.yml) | the provider block of the harness used in this work (DSH), with the context window, the level mapping and the budgets |

No file contains a key: put yours in an environment variable (`LLAMA_API_KEY`) or replace the placeholder.

## Find out what your client sends

```bash
node tools/log-requests.mjs --port 8099
# point the client at http://127.0.0.1:8099/v1 (any key, any model id), pick each thinking level, send a message
```

Each request prints one line with the model, the caps, the sampling values, **the thinking controls**, the roles of the messages and every top-level field that is not part of the standard OpenAI schema:

```
2026-10-25T14:12:41.956Z {"model":"qwen3.6","stream":false,"max_tokens":32768,"temperature":0.6,…,"controls_and_extra_fields":{"chat_template_kwargs":{"enable_thinking":true,"preserve_thinking":true},"thinking_budget_tokens":2048}}
```

Compare it with [`thinking-levels.json`](thinking-levels.json). A level that prints `controls_and_extra_fields: {}` is a level that controls nothing.

## Find out the real per-slot context

```bash
curl -s "http://127.0.0.1:8080/props?model=qwen3.6&autoload=false" -H "Authorization: Bearer $LLAMA_API_KEY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log("slots:",p.total_slots,"n_ctx per slot:",p.default_generation_settings?.n_ctx)})'
```

Remember that with `--parallel N` and a non-unified KV cache each slot gets `ctx-size / N`. `autoload=false` makes the call read the state of a model **without loading it**.
