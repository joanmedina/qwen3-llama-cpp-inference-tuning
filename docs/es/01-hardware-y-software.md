# 01 · Hardware y software

[← Índice](../../README.es.md) · [Siguiente: Metodología →](02-metodologia.md)

Todos los números de este repositorio se midieron en **una** máquina, que se describe aquí. Léelo antes de comparar con tus resultados: las APU de memoria unificada se comportan de forma distinta a las GPU discretas, y varios hallazgos (la colocación de la memoria, el resultado con dos GPU) dependen de ello.

## 1. Máquina de pruebas

| Componente | Detalle |
|---|---|
| Sistema | mini PC GMKtec EVO-X3, BIOS `EVO-X3_V1.01` (2026-06-17) |
| CPU | AMD Ryzen AI Max+ 395 («Strix Halo»), 16 núcleos / 32 hilos; llama.cpp detecta AVX2 y AVX-512 (VBMI, VNNI, BF16) |
| GPU integrada | AMD Radeon 8060S (RDNA 3.5), controlador de Windows `32.0.32015.7029`. Dispositivo Vulkan `Vulkan0`: 114 507 MiB visibles, 108 782 MiB libres al arrancar |
| Memoria | 8 × 16 GB LPDDR5X-8000 (128 GB, unificada). La BIOS dedica **64 GB a la iGPU**; Windows ve 63,6 GB de RAM. El resto de la memoria visible para la GPU es memoria «compartida» del sistema |
| GPU discreta | NVIDIA GeForce RTX 3080 Ti (12 GB). Se usó **solo** en el experimento con dos GPU ([figura 9](../../figures/es/fig09-igpu-vs-dual-gpu.svg)); todos los demás números son solo de la iGPU |
| NPU | presente, no usada en ningún experimento |
| SO | Windows 11 Pro, compilación 10.0.26200 |

El ancho de banda teórico de memoria de esta plataforma es de unos 256 GB/s (cifra del fabricante para LPDDR5X-8000 con interfaz de 256 bits; **no se midió aquí**). La generación de un modelo cuantizado está limitada en gran medida por ese ancho de banda, y por eso importa más *cuántos tokens produce cada pasada por la memoria* (la decodificación especulativa) que cualquier opción orientada al cómputo.

## 2. Software

| Elemento | Versión / ajuste |
|---|---|
| llama.cpp | compilación **11721**, commit `ff5a23376`, Clang 20.1.8, Windows x86_64. Compilación Vulkan (`llama-server.exe`). Para la prueba con dos GPU se usó una compilación CUDA+Vulkan de la misma revisión |
| Backend | Vulkan. La variable de entorno `VK_LOADER_DRIVERS_SELECT=*amd*` oculta el controlador (ICD) de NVIDIA para que `Vulkan0` sea siempre la iGPU |
| Modo del servidor | **modo router**: `llama-server --models-preset <fichero.ini> --models-max 3 --host 127.0.0.1 --port 8080 --api-key <clave>` (un proceso hijo por modelo cargado) |
| Clientes | agentes compatibles con OpenAI (arneses de programación) que hablan con `/v1/chat/completions`; los hallazgos del lado del arnés se describen de forma genérica en [05](05-presupuestos-de-pensamiento.md) y [04](04-cache-contexto-y-compactacion.md) |

### El modo router en dos minutos

El router lee un fichero INI donde cada sección es un modelo y cada clave es una opción larga de `llama-server` sin los guiones iniciales (véase [`configs/llama-server/`](../../configs/llama-server/)). Cosas que conviene saber, todas usadas en este trabajo:

- **Los presets se leen solo cuando arranca el router.** Editar el INI no cambia nada hasta el siguiente arranque (en nuestro caso, aproximadamente un minuto sin servicio).
- `load-on-startup = true|false` por modelo; los modelos que no se cargan al arrancar se cargan con la primera petición que los nombra. `--models-max N` limita cuántos permanecen residentes.
- `GET /models` lista todos los modelos con su estado (`loaded` / `unloaded`) y los argumentos con los que se lanzaron. `POST /models/unload` con `{"model": "<id>"}` libera uno sin reiniciar el router.
- Los endpoints de monitorización aceptan `?model=<id>&autoload=false` (`/props`, `/slots`, `/metrics`), de modo que un panel puede vigilar un modelo **sin cargarlo nunca**.

## 3. Modelos

| | Qwen3.6-35B-A3B | Qwen3.8-27B |
|---|---|---|
| Tipo | Mezcla de expertos (MoE): 256 expertos, 8 activos por token (unos 3 B de parámetros activos) | Denso, 27 B de parámetros |
| GGUF usado | Q4_K_M, 22,3 GB (cuantización de bartowski) | Q4_K_M, 16,8 GB (lmstudio-community) |
| Arquitectura en llama.cpp | `qwen35moe` | `qwen35` |
| Bloques | 41 = 40 + **1 capa MTP** (`blk.40.nextn.*`) | 65 = 64 + **1 capa MTP** (`blk.64.nextn.*`) |
| Disposición de la atención | atención completa cada 4.ª capa (10) + 30 capas Gated DeltaNet | atención completa cada 4.ª capa (16) + 48 capas Gated DeltaNet |
| Estado recurrente | tamaño interno 4096, 32 cabezas | tamaño interno 6144, 48 cabezas |
| Contexto nativo | 262 144 tokens | 262 144 tokens |
| Visión | sí (`mmproj` aparte, F16, 0,9 GB) | sí (`mmproj` aparte) |
| Tamaño de un punto de control de contexto (medido) | **62,8 MiB** | **149,6 MiB** |

Las cabeceras se leyeron con [`tools/gguf-header.mjs`](../../tools/gguf-header.mjs); ambos ficheros **incluyen la cabeza de predicción de varios tokens (MTP)**, que es lo que hace disponible `--spec-type draft-mtp`. Un GGUF sin tensores `nextn` no puede usarla (compruébalo en el tuyo primero).

Por qué importa esto para todo lo que sigue: ambos modelos son **híbridos** (capas de atención lineal Gated DeltaNet más unas pocas capas de atención completa). Un modelo híbrido mantiene un *estado recurrente* que no puede rebobinarse parcialmente, de modo que el servidor solo puede reutilizar una caché hasta un **punto de control de contexto** guardado ([doc 04](04-cache-contexto-y-compactacion.md)); y la diferencia entre MoE y denso explica el comportamiento tan distinto de la decodificación especulativa ([doc 03](03-decodificacion-especulativa.md)).

## 4. Una observación sobre la colocación de la memoria

En una APU de memoria unificada, los mismos pesos pueden vivir en la reserva *dedicada* o en la memoria *compartida* del sistema. Mientras los tres modelos de producción llenaban los 64 GB de memoria dedicada, los routers temporales de prueba acababan en memoria compartida y funcionaban **un 15 % más lentos aproximadamente** con una configuración idéntica (punto de partida de Qwen3.6: 60,3 tok/s en un router temporal frente a 70,3 tok/s en producción; datos del informe en `data/qwen36-production-before-after.json`). Cuando se liberó la memoria dedicada (un solo modelo de 28 GB residente), un router temporal dio números en línea con producción (115 frente a 113–121 tok/s). La causa se dedujo de la situación; no se verificó inspeccionando dónde se colocaron los pesos ni con un perfilador. Tómalo como una advertencia práctica: **mantén el conjunto residente dentro de la memoria dedicada** y compara variantes solo cuando se midieron con la misma colocación.

## 5. Cómo leer los números

- *tok/s* significa siempre lo que informa el servidor en la respuesta (`timings.predicted_per_second` para la generación, `timings.prompt_per_second` para el procesamiento del prompt), no el tiempo real transcurrido medido en el cliente, salvo cuando una figura dice «segundos».
- El «punto de partida» de cada experimento es la configuración que estaba en producción antes de él, indicada en cada tabla.
- Las velocidades absolutas son propias de esta máquina; lo que debería trasladarse son los cambios **relativos**.
