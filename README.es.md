# Qwen3.6 y Qwen3.8 en llama.cpp — inferencia local más rápida con decodificación especulativa MTP + n-gramas, ajuste de la caché del prompt y presupuestos de pensamiento

[English](README.md) · **Español**

[![check](https://github.com/joanmedina/qwen3-llama-cpp-inference-tuning/actions/workflows/check.yml/badge.svg)](https://github.com/joanmedina/qwen3-llama-cpp-inference-tuning/actions/workflows/check.yml) · licencia MIT · llama.cpp compilación 11721 · medido en 2026-10

> Una guía de ajuste reproducible y medida para ejecutar **Qwen3.6-35B-A3B** y **Qwen3.8-27B** (modelos híbridos Gated DeltaNet) con **llama.cpp / `llama-server`** en un mini PC **AMD Ryzen AI Max+ 395 «Strix Halo»** (iGPU Radeon 8060S, Vulkan, 128 GB de memoria unificada). Configuraciones, recetas paso a paso, benchmarks, números en bruto, figuras y scripts, en español e inglés.

![Qwen3.6-35B-A3B antes y después](figures/es/fig04-qwen36-production-before-after.svg)

## Resumen — qué cambió y cuánto

| Área | Antes | Después | Cómo |
|---|---|---|---|
| **Generación de Qwen3.6-35B-A3B** (mezcla de cargas de agente, servidor de producción) | 70,3 tok/s | **121,6 tok/s (+73 %)** — copia ×2,5, edición ×2,0, razonamiento +14 % | `--spec-type draft-mtp,ngram-mod --spec-draft-n-max 2 --repeat-penalty 1.0` |
| **Generación de Qwen3.8-27B** (denso, router temporal) | 12,6 tok/s | **56,9–60,6 tok/s (×4,5–4,8)**; 107 tok/s al copiar (×8,5) | la cabeza MTP sola da 26,7; `ngram-mod` encima |
| **Vuelta a un chat largo** después de que otra petición ocupase el slot (Qwen3.8, 65 000 tokens) | reprocesamiento completo, **> 5 min** | **13,6 s** | `--cache-ram 8192 --ctx-checkpoints 8` (los `4096`/32 con los que partía ni siquiera guardan el chat) |
| **Compactación del contexto del agente** (resumen de 126 000 tokens, Qwen3.6) | **313 s** con 4 puntos de control | **14,7 s** con ≥ 8 | mantener `--ctx-checkpoints ≥ 8` |
| **Ventana de contexto** | el cliente creía 262 144, el slot del servidor tenía 131 072 → «Output token limit reached» | cliente y servidor coinciden; ventana de 262 144 tokens en un slot con KV q8_0 | declarar el contexto real por slot |
| **Control del pensamiento** | «Off» no enviaba nada; «High» en Qwen3.8 → HTTP 500; cada chat nuevo esperaba ~23 s por una petición de título oculta | Off real; `high → xhigh`; petición de título **22,8 s → 0,5 s**; **Medium iguala la precisión de High en problemas difíciles en el 73 % del tiempo** | traducir los niveles del cliente a lo que entiende la plantilla de chat |

Todos los números salen de [`data/`](data/), se midieron en una sola máquina ([hardware](docs/es/01-hardware-y-software.md)) y llevan su configuración. Las velocidades absolutas son propias de esa máquina; lo que debería trasladarse son los efectos **relativos**. Lee las [limitaciones](docs/es/08-limitaciones.md) antes de citar una cifra.

## La receta en 30 segundos

```bash
llama-server -m Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf \
  --spec-type draft-mtp,ngram-mod --spec-draft-n-max 2 --repeat-penalty 1.0 \
  -c 262144 -np 1 -ctk q8_0 -ctv q8_0 -fa on -ngl 999 \
  -cram 8192 -ctxcp 32 -b 2048 -ub 1024 \
  --jinja --reasoning-format deepseek --reasoning-budget 8192
```

| Opciones | Qué hacen | Evidencia |
|---|---|---|
| `--spec-type draft-mtp,ngram-mod --spec-draft-n-max 2` | la propia cabeza MTP del modelo propone 2 tokens; una búsqueda de n-gramas propone tramos largos cuando la salida repite el contexto | [doc 03](docs/es/03-decodificacion-especulativa.md) |
| `--repeat-penalty 1.0` | deja de pelear contra los borradores de n-gramas y contra la copia (las fichas de los modelos lo recomiendan) | [doc 03 §5](docs/es/03-decodificacion-especulativa.md) |
| `-c 262144 -np 1 -ctk q8_0 -ctv q8_0` | toda la ventana nativa en un slot, la mitad de memoria de KV a la misma velocidad | [doc 04 §6, §8](docs/es/04-cache-contexto-y-compactacion.md) |
| `-cram 8192 -ctxcp 32` (Qwen3.8: `-ctxcp 8`) | caché del prompt en RAM y puntos de control de contexto dimensionados para modelos híbridos | [doc 04 §3–5](docs/es/04-cache-contexto-y-compactacion.md) |
| `-b 2048 -ub 1024` | `ubatch 2048` es un 23–28 % *más lento* en el prefill de esta máquina | [doc 04 §8](docs/es/04-cache-contexto-y-compactacion.md) |
| `--reasoning-budget 8192` | tope del pensamiento para todo el servidor; los clientes lo bajan por petición con `thinking_budget_tokens` | [doc 05](docs/es/05-presupuestos-de-pensamiento.md) |

Las configuraciones completas y comentadas están en [`configs/`](configs/); el motivo y la evidencia de **cada** opción están en [docs/es/06-recetas.md](docs/es/06-recetas.md).

## Por qué funciona (en tres frases)

En una máquina limitada por el ancho de banda, la velocidad de generación es aproximadamente *ancho de banda de memoria ÷ bytes de pesos activos leídos por pasada*, multiplicada por los tokens producidos por pasada, así que la palanca es producir **más de un token por pasada**: la **cabeza de predicción de varios tokens** del propio modelo propone 2 tokens y una **búsqueda de n-gramas** propone tramos largos siempre que la salida repite texto que ya está en el contexto, justo lo que hace un agente de programación cuando copia y edita ficheros. Ambos modelos son **híbridos** cuyo estado recurrente no puede rebobinarse, de modo que volver a un chat largo o compactarlo solo es barato si un **punto de control de contexto** y la **caché de prompts en RAM** están dimensionados para el modelo. Y un selector de «nivel de pensamiento» no controla nada si el cliente no envía lo que la **plantilla de chat** realmente lee.

## Contenido

| | |
|---|---|
| [01 · Hardware y software](docs/es/01-hardware-y-software.md) | la máquina, el controlador, la compilación de llama.cpp, el modo router, los dos modelos y por qué son híbridos |
| [02 · Metodología](docs/es/02-metodologia.md) | un factor cada vez sobre una copia de producción, cargas, semillas, banda de ruido, factores de confusión, regla de decisión |
| [03 · Decodificación especulativa](docs/es/03-decodificacion-especulativa.md) | longitud del borrador MTP, `ngram-mod`, `repeat-penalty`, resultado en producción, Qwen3.8, comprobación sin MTP |
| [04 · Caché del prompt, contexto y compactación](docs/es/04-cache-contexto-y-compactacion.md) | puntos de control, `--cache-ram`, fórmula de dimensionado, compactación, la ventana que cree el cliente, tamaños de lote |
| [05 · Presupuestos y niveles de pensamiento](docs/es/05-presupuestos-de-pensamiento.md) | los controles que existen, qué enviaba un arnés, precisión frente a tiempo, la petición de título oculta |
| [06 · Recetas](docs/es/06-recetas.md) | configuración paso a paso de ambos modelos, línea por línea, y cómo aplicar un cambio con seguridad |
| [07 · Trampas y resultados negativos](docs/es/07-trampas-y-resultados-negativos.md) | lo que se probó y no se adoptó, fallos silenciosos, trampas de medición |
| [08 · Limitaciones](docs/es/08-limitaciones.md) | amenazas a la validez y lo que nunca se midió |
| [09 · Reproducir](docs/es/09-reproducir.md) | mide los mismos efectos en tu hardware |
| [Referencias](docs/es/referencias.md) | artículos, software y fichas de modelos |

Todo está disponible en inglés en [`docs/en/`](docs/en/).

## Inicio rápido

```bash
git clone https://github.com/joanmedina/qwen3-llama-cpp-inference-tuning.git
cd qwen3-llama-cpp-inference-tuning

node tools/gguf-header.mjs /models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf   # ¿el GGUF trae la cabeza MTP? (busca tensores `nextn`)
cp configs/llama-server/models.example.ini models.ini                   # adapta rutas y nombres de dispositivo
llama-server --models-preset models.ini --models-max 3 --host 127.0.0.1 --port 8080 --api-key change-me

node bench/spec-bench.mjs  --url http://127.0.0.1:8080 --model qwen3.6 --api-key change-me   # tok/s y aceptación del borrador por carga
node bench/cache-bench.mjs --url http://127.0.0.1:8080 --model qwen3.6 --api-key change-me   # escenario de vuelta al chat y compactación
node bench/thinking-check.mjs --url http://127.0.0.1:8080 --model qwen3.6 --api-key change-me # qué hacen los controles de pensamiento
```

Requisitos: Node.js ≥ 20 (sin paquetes) y un `llama-server` que conozca las opciones usadas aquí (se usó la compilación **11721**). Detalles y salida esperada: [docs/es/09-reproducir.md](docs/es/09-reproducir.md).

## Mapa del repositorio

```
docs/en, docs/es     el informe, en los dos idiomas (nueve capítulos + referencias)
configs/             presets y scripts de arranque de llama-server, parche de la plantilla de chat, ajustes de clientes (OpenCode, LiteLLM, arnés de agente)
bench/               spec-bench.mjs (velocidad de generación, aceptación, velocidad del prompt) · cache-bench.mjs (caché del prompt y compactación) · thinking-check.mjs (controles de pensamiento)
tools/               gguf-header.mjs (¿está la cabeza MTP?) · log-requests.mjs (¿qué envía mi cliente?) · check-links.mjs
data/                cada número medido, en JSON con su configuración y procedencia
figures/             gráficos SVG en inglés y español, generados desde data/ por make-figures.mjs
```

## Lo que conviene saber antes de empezar

- **Comprueba que tu GGUF trae la cabeza MTP** (`node tools/gguf-header.mjs`). Algunos ficheros recuantizados o «abliterados» la eliminan, y entonces `draft-mtp` no hace nada.
- **No subas `--spec-draft-n-max` por encima de 2 en el modelo MoE**: pasar a 4 gana un 7 % al copiar pero pierde un 11–21 % en prosa, pasos de agente y razonamiento, que es donde está el tráfico real (3 queda en medio).
- **`repeat-penalty 1.0`** (lo que recomiendan las fichas de los modelos) vale un +9 % por sí solo y un +27 % al reescribir texto con especulación de n-gramas.
- **Una segunda GPU lo empeoró** (−20 % de generación, reparto Vulkan + CUDA 80:20) en esta máquina de memoria unificada.
- **Mantén el conjunto residente dentro de la memoria dedicada a la GPU**: la misma configuración fue ~15 % más lenta cuando el modelo parecía caer en memoria compartida (una deducción de la situación, no un hecho medido con un perfilador — [doc 01 §4](docs/es/01-hardware-y-software.md)).
- **No midas nunca justo después de un reinicio** (la primera ejecución fue ~30 % más lenta con texto y aceptación idénticos) y **cuidado al repetir textos** (la velocidad de copia de un ajuste fino de Qwen3.6 pasó de 131 a 233 tok/s en tres repeticiones de los mismos textos).

## Limitaciones, con honestidad

Una máquina, un backend (Vulkan en Windows), una cuantización por modelo, sustitutos sintéticos del comportamiento de un agente, baterías de calidad pequeñas (10 + 8 problemas) y una banda de ruido del ±15–20 % entre dos pasadas idénticas en la iGPU. Las mejoras fuera de esa banda se replicaron antes de adoptarse; todo lo menor se presenta como «no más lento», nunca como «más rápido». Lista completa: [docs/es/08-limitaciones.md](docs/es/08-limitaciones.md). Las correcciones y las reproducciones en otro hardware son la contribución más valiosa ([CONTRIBUTING](CONTRIBUTING.md)).

## Cómo citar

Si esto te ayudó en tu trabajo, cítalo ([`CITATION.cff`](CITATION.cff)) e indica el commit que usaste: las opciones y los valores por omisión de llama.cpp que se describen aquí cambian entre compilaciones.

## Agradecimientos

A los mantenedores y colaboradores de [llama.cpp](https://github.com/ggml-org/llama.cpp) (la decodificación especulativa, MTP, los puntos de control de contexto y la caché del prompt en RAM son suyos); al equipo de Qwen por los modelos y sus fichas; a los cuantizadores de GGUF [bartowski](https://huggingface.co/bartowski) y [lmstudio-community](https://huggingface.co/lmstudio-community); y a los autores de los artículos de las [referencias](docs/es/referencias.md).

## Licencia

[MIT](LICENSE). Los pesos de los modelos se distribuyen bajo sus propias licencias; este repositorio no contiene ninguno. *Qwen3.6, Qwen3.8, AMD, Ryzen, Radeon, NVIDIA y otros nombres son marcas de sus respectivos propietarios; este es un proyecto independiente sin afiliación.*
