# 09 · Reproducir las mediciones en tu hardware

[← Limitaciones](08-limitaciones.md) · [Índice](../../README.es.md) · [Referencias →](referencias.md)

El objetivo no es igualar nuestros números absolutos sino **medir los mismos efectos en tu máquina** antes de cambiar una configuración de producción. Requisitos: Node.js ≥ 20 (sin paquetes), un `llama-server` con las opciones del [doc 06](06-recetas.md) y un GGUF con cabeza MTP.

## 1. Preparación

```bash
git clone https://github.com/joanmedina/qwen3-llama-cpp-inference-tuning.git
cd qwen3-llama-cpp-inference-tuning
node tools/gguf-header.mjs /models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf     # debe mostrar nextn_predict_layers: 1 y tensores nextn
cp configs/llama-server/models.example.ini models.ini                     # edita rutas y nombres de dispositivo
llama-server --models-preset models.ini --models-max 1 --host 127.0.0.1 --port 8097 --api-key probe
```

Usa un **puerto aparte y una copia de tu preset real** para los experimentos, y cambia **una clave cada vez** ([doc 02](02-metodologia.md) §2).

## 2. Velocidad de generación y aceptación (`bench/spec-bench.mjs`)

```bash
node bench/spec-bench.mjs --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe \
     --label mtp2-ngram --seeds 11,23 --pp 8000,32000 --out results/mtp2-ngram.json
```

Carga el modelo (modo router), lo calienta, envía las cargas del [doc 02](02-metodologia.md) §3 con semillas fijas e imprime, a partir de los propios `timings` del servidor:

```
TG copy         ... tok/s | ... tokens | acceptance .. % | copy fidelity .. %
TG edit         ...
TG edit-tool    ... | exact old_string n/n
TG prose / reasoning ...
PP   8000 requested | ... prompt tokens (... processed, 0 cached) | ... tok/s
```

Repite con otro `spec-type` / `spec-draft-n-max` / `repeat-penalty` en el preset y compara los ficheros JSON (el script imprime una tabla Markdown lista para pegar en una incidencia). Comprobaciones que te dicen que el experimento es válido:

- `acceptance` es distinta de cero en toda variante especulativa (0 significa que el servidor no está especulando: el GGUF no tiene cabeza MTP o `spec-type` es incorrecto) y **exactamente 0/0 (`n/a`) en la variante base sin especulación**.
- La *fidelidad de la copia* se mantiene alta (una copia rápida pero errónea no es una mejora).
- Ejecuta dos veces la primera variante y descarta la primera ejecución (máquina en frío). No ejecutes otros clientes mientras tanto.

**Qué esperar.** La *forma* de las [figuras 2–5](../../figures/es/): `ngram-mod` debería multiplicar `copy` y `edit`, dejar casi igual `reasoning`, y `spec-draft-n-max` por encima de 2 debería ayudar a la copia y perjudicar a `prose`/`reasoning`. Los números absolutos dependen de tu ancho de banda.

## 3. Caché del prompt y compactación (`bench/cache-bench.mjs`)

```bash
node bench/cache-bench.mjs --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe \
     --steps 24 --step-tokens 2300 --out results/cache-default.json
```

Hace crecer un chat paso a paso (cada petición lleva todo el historial), envía una petición ajena que ocupa el único slot, **vuelve al chat** y envía una **petición de resumen al estilo de la compactación** sobre el primer 78 % del historial. La tabla muestra, para cada petición, el tamaño del prompt, los tokens *procesados* y los leídos *de la caché*, y los segundos. Salida sana: las filas RETURN y SUMMARY procesan solo los tokens nuevos (unos pocos miles como mucho). Un «procesados» cercano al prompt completo significa que ningún punto de control ni entrada de la caché de RAM cubrió ese prefijo: sube `cache-ram` y mantén `ctx-checkpoints ≥ 8` ([doc 04](04-cache-contexto-y-compactacion.md)). Usa `--steps 68 --step-tokens 2300` para llegar al chat de ~160 000 tokens del informe (lleva tiempo: el prefill en profundidad es lento).

Salida de la ejecución de validación de este repositorio (Qwen3.6 con [`models.example.ini`](../../configs/llama-server/models.example.ini): `cache-ram 8192`, 32 puntos de control, 16 pasos; un router desechable, así que los segundos absolutos son más lentos que en producción):

```
| request                                            | prompt tokens | processed | from cache | seconds |
| last step of the build-up                          |         45294 |      2836 |      42458 |    14.9 |
| foreign request (takes the only slot)              |            26 |        26 |          0 |     4.2 |
| RETURN to the chat (+1 step)                       |         48132 |      2842 |      45290 |    14.9 |
| COMPACTION SUMMARY (prefix = first 12 of 16 steps) |         33982 |        21 |      33961 |     1.3 |
```

Ejecútalo una vez con `--parallel 1` (como aquí); con más slots la «petición ajena» ya no desaloja el chat y el escenario cambia.

## 4. Niveles de pensamiento

```bash
node bench/thinking-check.mjs --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe          # Qwen3.8: añade --effort medium
```

[`bench/thinking-check.mjs`](../../bench/thinking-check.mjs) envía un prompt de razonamiento (con semilla fija) sin control, con el pensamiento desactivado y con presupuestos de 32 / 512 / 2048 tokens por los dos nombres de campo (`thinking_budget_tokens` y su alias `reasoning_budget_tokens`), e imprime cuánto pensó cada variante y durante cuánto tiempo. Para tu propio cliente, envía el mismo prompt con cada traducción del [doc 05](05-presupuestos-de-pensamiento.md) §2 y compara `usage.completion_tokens`, la longitud de `reasoning_content` y el tiempo. Para la precisión usa tu propia batería pequeña de problemas con una única respuesta comprobable; la usada aquí no se publica (es fácil de reconstruir: 10 problemas fáciles y 8 difíciles, comprobación de la respuesta final, tope de 4500 tokens).

## 5. Regenerar figuras y tablas

```bash
node figures/make-figures.mjs      # escribe figures/en/*.svg y figures/es/*.svg a partir de data/*.json
```

Si reproduces un experimento y quieres compartirlo, añade tus números como un nuevo `data/<nombre>.json` siguiendo los ficheros existentes (configuración, unidad, valores, fuente) y abre una *pull request* ([CONTRIBUTING](../../CONTRIBUTING.md)).
