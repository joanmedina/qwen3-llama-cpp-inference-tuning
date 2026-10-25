# 06 · Recetas: configurar Qwen3.6 y Qwen3.8 paso a paso

[← Presupuestos de pensamiento](05-presupuestos-de-pensamiento.md) · [Índice](../../README.es.md) · [Siguiente: Trampas y resultados negativos →](07-trampas-y-resultados-negativos.md)

Todo lo que sigue se aplicó en la máquina del [doc 01](01-hardware-y-software.md). Los números de la columna «por qué» enlazan con la evidencia. Adapta los nombres de dispositivo, las rutas y la memoria a tu hardware; vuelve a medir con [`bench/spec-bench.mjs`](../../bench/spec-bench.mjs) antes de fiarte de una mejora.

## 0. Requisitos previos

1. Un `llama-server` que conozca las opciones usadas aquí. Comprobación: `llama-server --help | grep -E "spec-type|ctx-checkpoints|cache-ram|reasoning-budget"`. Se usó la compilación **11721** (Vulkan).
2. Un GGUF **que incluya la cabeza MTP**. Comprobación: `node tools/gguf-header.mjs model.gguf` → `nextn_predict_layers: 1` y tensores llamados `…nextn…` ([doc 03](03-decodificacion-especulativa.md) §9). Si no muestra ninguno, `draft-mtp` no está disponible para ese fichero.
3. Memoria: Qwen3.6-35B-A3B Q4_K_M ≈ 22,3 GB de pesos, Qwen3.8-27B Q4_K_M ≈ 16,8 GB, más la caché KV, los puntos de control y ~0,9 GB por proyector de visión.
4. En Windows con una tarjeta NVIDIA presente y una iGPU de AMD como destino: define `VK_LOADER_DRIVERS_SELECT=*amd*` para que `Vulkan0` sea la iGPU.

## 1. Qwen3.6-35B-A3B (modelo del día a día)

### 1.1 Preset del router (`models.ini`)

```ini
version = 1

[*]
jinja = true
n-gpu-layers = 999
flash-attn = on
parallel = 1
cache-type-k = q8_0
cache-type-v = q8_0
metrics = true
reasoning-format = deepseek
reasoning = on
reasoning-budget = 8192
batch-size = 2048
ubatch-size = 1024

[qwen3.6]
model = /models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf
mmproj = /models/mmproj-Qwen_Qwen3.6-35B-A3B-f16.gguf
mmproj-device = Vulkan0
image-max-tokens = 1024
ctx-size = 262144
device = Vulkan0
spec-type = draft-mtp,ngram-mod
spec-draft-n-max = 2
reasoning-budget-message = Stop thinking: act now.
cache-ram = 8192
ctx-checkpoints = 32
temp = 0.6
top-p = 0.95
top-k = 20
min-p = 0
repeat-penalty = 1.0
load-on-startup = true
```

Arranque: `llama-server --models-preset models.ini --models-max 3 --host 127.0.0.1 --port 8080 --api-key <clave>`. Una línea de comandos de un solo modelo con las mismas opciones está en [`configs/llama-server/qwen3.6-35b-a3b.sh`](../../configs/llama-server/qwen3.6-35b-a3b.sh).

### 1.2 Para qué sirve cada línea

| Clave | Valor | Por qué | Evidencia |
|---|---|---|---|
| `spec-type` | `draft-mtp,ngram-mod` | cabeza MTP + autoespeculación con n-gramas: **+73 % de generación** en producción | [03 §4–6](03-decodificacion-especulativa.md) |
| `spec-draft-n-max` | `2` | 3–4 ganan en copia pero pierden en prosa/agente/razonamiento; el valor por omisión del servidor es 3 | [03 §3](03-decodificacion-especulativa.md) |
| `repeat-penalty` | `1.0` | +9 % por sí sola, +27 % al reescribir con n-gramas; recomendado por la ficha del modelo; sin pérdida de calidad en las baterías | [03 §5](03-decodificacion-especulativa.md) |
| `ctx-size` | `262144` | contexto nativo; un slot; KV en `q8_0`. El cliente debe declarar el mismo número | [04 §6](04-cache-contexto-y-compactacion.md) |
| `parallel` | `1` | un slot da la ventana completa; un segundo cliente *espera en cola* (visible como `requests_deferred` en `/metrics`) | [04 §1](04-cache-contexto-y-compactacion.md) |
| `cache-ram` / `ctx-checkpoints` | `8192` / `32` (valores por omisión) | vuelta a un chat de 161 000 tokens en 14 s; petición de resumen en 15 s. **No bajes de 8 puntos de control** | [04 §3, §5](04-cache-contexto-y-compactacion.md) |
| `batch-size` / `ubatch-size` | `2048` / `1024` | `ubatch 2048` es un 23–28 % más lento en el prefill | [04 §8](04-cache-contexto-y-compactacion.md) |
| `cache-type-k/v` | `q8_0` | misma velocidad que `f16`, la mitad de memoria | [04 §8](04-cache-contexto-y-compactacion.md) |
| `reasoning-budget` | `8192` | tope de pensamiento por omisión para todo el servidor; los clientes lo sobrescriben por petición | [05](05-presupuestos-de-pensamiento.md) |
| `temp` / `top-p` / `top-k` / `min-p` | `0.6 / 0.95 / 20 / 0` | el muestreo usado en todas las mediciones | [02](02-metodologia.md) |
| `device`, `mmproj-device` | `Vulkan0` | solo la iGPU; una segunda GPU la ralentizó | [fig. 9](../../figures/es/fig09-igpu-vs-dual-gpu.svg) |

### 1.3 Plantilla de chat: mensajes de sistema a mitad de conversación

La plantilla de chat de fábrica de Qwen3.6 **lanza un error si un mensaje `system` no es el primero**. Algunos agentes (Codex, por ejemplo) envían mensajes de sistema/desarrollador a mitad de conversación y fallan con un error HTTP. Un cambio de una línea en la plantilla hace que los deje pasar (los ficheros de plantilla derivan de los de Qwen, con licencia Apache-2.0; aquí solo se distribuye la diferencia — [`configs/chat-template/qwen3.6-system-mid-conversation.diff`](../../configs/chat-template/qwen3.6-system-mid-conversation.diff)):

```diff
     {%- if message.role == "system" %}
         {%- if not loop.first %}
-            {{- raise_exception('System message must be at the beginning.') }}
+            {#- agents send system messages mid-conversation: pass them through instead of failing #}
+            {{- '<|im_start|>system\n' + content + '<|im_end|>\n' }}
         {%- endif %}
```

Extrae la plantilla incrustada con `node tools/gguf-header.mjs --chat-template model.gguf > template.jinja` (o tómala del repositorio del modelo), aplica el cambio y pásala con `chat-template-file = …` (con `jinja = true`).

## 2. Qwen3.8-27B (modelo para tareas pesadas / complejas)

```ini
[qwen3.8-27b]
model = /models/Qwen3.8-27B-Q4_K_M.gguf
mmproj = /models/mmproj-Qwen3.8-27B-BF16.gguf
mmproj-device = Vulkan0
image-max-tokens = 1024
ctx-size = 131072
device = Vulkan0
spec-type = draft-mtp,ngram-mod
spec-draft-n-max = 2
reasoning-effort = medium
cache-ram = 8192
ctx-checkpoints = 8
temp = 1.0
top-p = 0.95
top-k = 20
min-p = 0
repeat-penalty = 1.0
load-on-startup = false
```

Diferencias con la sección de Qwen3.6 y por qué:

| Clave | Qwen3.8 | Por qué |
|---|---|---|
| `spec-type` / `spec-draft-n-max` | igual que Qwen3.6 | 12,6 → 56,9–60,6 tok/s; MTP 2/3/4 empatan cuando `ngram-mod` está activo, y 2 acepta más al razonar ([03 §7](03-decodificacion-especulativa.md)) |
| `cache-ram` / `ctx-checkpoints` | **`8192` / `8`** (no los `4096`/32 con los que partía este preset; el valor por omisión del servidor es 8192/32) | la combinación 4096/32 ni siquiera guarda un chat de 65 000 tokens (estado de 7230 MiB) → > 5 min para volver; con 8192/8 → 13,6 s. Una ventana de 262 000 necesitaría ~12 288 ([04 §4](04-cache-contexto-y-compactacion.md)) |
| `ctx-size` | `131072` | lo que se ejecutó; el contexto nativo del modelo es 262 144 (no probado aquí: sube `cache-ram` y la ventana declarada del cliente a la vez) |
| `temp` / `repeat-penalty` | `1.0` / `1.0` | el muestreo recomendado en la ficha del modelo para el modo de pensamiento |
| `reasoning-effort` | `medium` | valor por omisión para clientes que no envían nada; la plantilla solo acepta `xhigh`/`medium`/`low` ([05 §1](05-presupuestos-de-pensamiento.md)). Los clientes deben enviar `xhigh` para su «High» |
| `load-on-startup` | `false` | se carga bajo demanda: 16,8 GB residentes solo cuando una tarea difícil lo pide |

## 3. Qué modelo para qué

| | Qwen3.6-35B-A3B | Qwen3.8-27B |
|---|---|---|
| Generación, razonamiento / edición–copia (tok/s) | ~74 / 150–170 (producción) | ~25 / 64–107 (router temporal) |
| Lectura del prompt (tok/s) | 720 → 196 al crecer el contexto hasta 200 000 | 225 → 149 entre 2000 y 65 000 |
| Coste de un punto de control / de un chat guardado | 62,8 MiB / 12,4 MiB por cada 1000 tokens | 149,6 MiB / 39 MiB por cada 1000 tokens |
| Índice de calidad independiente (Artificial Analysis v4.3.2, consultado el 2026-10-24; **no reproducido aquí**) | 18 | **34** (xhigh) — [fuente](https://artificialanalysis.ai/models/qwen3-8-27b) |

Lectura: Qwen3.6 es el caballo de batalla interactivo —aproximadamente tres veces más rápido por token porque solo ~3 B de parámetros están activos—; Qwen3.8 es el modelo que se carga bajo demanda cuando la calidad de la respuesta importa más que la latencia. Las cifras de velocidad son nuestras; el índice de calidad es de un tercero.

## 4. Aplicar un cambio con seguridad (el procedimiento usado en todos los cambios de este repositorio)

1. **Haz una copia de seguridad** del preset (`cp models.ini models.ini.before`).
2. **Edita** el preset. Recuerda que el router lo lee **solo al arrancar**.
3. **Valida** con un router desechable en otro puerto que no cargue nada: copia el preset, sustituye cada `load-on-startup = true` por `false` y arranca `llama-server --models-preset copia.ini --models-max 1 --port 8098 --api-key probe`; `GET /models` debe listar el modelo, y `args` muestra las claves que usará. **Escribe la copia sin marca de orden de bytes (BOM)**: el `Set-Content -Encoding UTF8` de Windows PowerShell 5.1 añade una, y el servidor responde *«failed to parse server config file»* y nunca abre su puerto.
4. **Reinicia** el router real cuando nadie esté generando (aproximadamente un minuto sin servicio; vigila el modelo con `GET /models`).
5. **Mide** con las mismas cargas que antes, en caliente ([doc 02](02-metodologia.md) §5).
6. **Revertir** = restaurar la copia de seguridad y reiniciar.

Otras operaciones usadas en todo el trabajo: `POST /models/unload {"model":"<id>"}` libera un modelo sin reiniciar; `GET /slots?model=<id>&autoload=false` y `GET /metrics?model=<id>&autoload=false` leen el estado sin cargar nada.

## 5. Ajustes del cliente-agente que deben coincidir

- **Ventana de contexto** = el contexto real por slot del servidor ([doc 04](04-cache-contexto-y-compactacion.md) §6): aquí, 262 144 para Qwen3.6 y 131 072 para Qwen3.8.
- **Niveles de pensamiento** traducidos a la plantilla ([doc 05](05-presupuestos-de-pensamiento.md) §2); en Qwen3.8, `high → xhigh`.
- **Política de compactación** que se dispare bastante antes de que se llene la ventana (este trabajo usó el 65 % de la ventana, un margen de 8192 tokens y retención).
- Entradas de proveedor/modelo para los dos modelos: [`configs/clients/`](../../configs/clients/).
