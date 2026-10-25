# 07 · Trampas y resultados negativos

[← Recetas](06-recetas.md) · [Índice](../../README.es.md) · [Siguiente: Limitaciones →](08-limitaciones.md)

Los resultados negativos también son resultados: cada fila siguiente es algo que se probó, se midió y **no** se adoptó, o un fallo que costó tiempo hasta que se entendió. Los números se refieren al punto de partida del experimento correspondiente.

## 1. Probado, medido y no adoptado

| Idea | Resultado | Dónde |
|---|---|---|
| 3 o 4 tokens borrador de MTP en lugar de 2 (Qwen3.6, MoE) | +5 % / +8 % al copiar, **−21 % en prosa, −12 % en pasos de agente, −11 % en razonamiento** (4 frente a 2) | [03 §3](03-decodificacion-especulativa.md) |
| Muestreo probabilístico del borrador; probabilidad mínima del borrador 0,5 | +2–8 % en copy/edit, **pierde en razonamiento** | [03 §3](03-decodificacion-especulativa.md) |
| Autoespeculación `ngram-map-k` | sin mejora sobre MTP solo (57,7 frente a 59,3 de media) | [datos](../../data/qwen36-ngram-mod-repeat-penalty.json) |
| Ventana de `ngram-mod` distinta de la de por omisión | 16/16/64, 16/8/64, 20/20/96, todas dentro del ruido (89,6–92,5 tok/s); por debajo de 16 el servidor avisa `n_match=12 is too small` y es más lento | [03 §4](03-decodificacion-especulativa.md) |
| `ngram-mod` **sin** la cabeza MTP (Qwen3.6) | media 82,4 frente a 95,3; razonamiento −10 % | [03 §4](03-decodificacion-especulativa.md) |
| MTP 3/4 sobre `ngram-mod` (Qwen3.8, denso) | empate con MTP 2 (±2 %); menor aceptación al razonar (73 → 62 → 56 %) | [03 §7](03-decodificacion-especulativa.md) |
| Menos hilos de CPU (2/4/8 de 16) y sin busy-poll | de +0 a +3 %: ruido. El modelo se ejecuta entero en la GPU | [datos](../../data/qwen36-ngram-mod-repeat-penalty.json) |
| Micro-lote mayor (`ubatch 2048`, `batch 4096`) | prefill **−23 a −28 %** | [04 §8](04-cache-contexto-y-compactacion.md) |
| Caché KV `f16` en lugar de `q8_0` | sin cambio de velocidad (`q8_0` reduce la memoria a la mitad) | [04 §8](04-cache-contexto-y-compactacion.md) |
| `--backend-sampling` (experimental) | 60,0 frente a 59,7 tok/s: sin efecto | [datos](../../data/qwen36-ngram-mod-repeat-penalty.json) |
| Repartir entre la iGPU y una RTX 3080 Ti (Vulkan + CUDA, 80:20) | generación **−20 %**, prefill −10 a −18 % | [fig. 9](../../figures/es/fig09-igpu-vs-dual-gpu.svg) |
| 4 puntos de control de contexto para ahorrar RAM | ahorra ~1,7 GiB por chat guardado; cada resumen de compactación cuesta **313 s** en lugar de 15 s | [04 §5](04-cache-contexto-y-compactacion.md) |
| Presupuestos de pensamiento mayores («High», o sin control) | no son más precisos que Medium; pueden pensar 81 s y quedar cortados en el tope de tokens | [05 §3](05-presupuestos-de-pensamiento.md) |

## 2. Fallos que eran invisibles hasta medirlos

| Síntoma | Causa | Solución |
|---|---|---|
| El nivel de pensamiento **«Off»** del cliente no cambia nada; las preguntas «triviales» tardan segundos | el cliente no envía ningún control, así que el servidor piensa hasta su tope por omisión (8192 tokens) | enviar `chat_template_kwargs {"enable_thinking": false}` para Off ([05 §2](05-presupuestos-de-pensamiento.md)) |
| **HTTP 500** en cada chat con el nivel «High» del cliente en Qwen3.8 | el cliente envía `reasoning_effort: high`; la plantilla solo acepta `xhigh`, `medium`, `low` y lanza una excepción | traducir `high → xhigh` |
| Cada chat nuevo espera **~23 s** antes de responder | una petición oculta de *título de sesión* (mismo modelo, sin control de pensamiento, tope de 4096 tokens) retiene el único slot mientras razona | la petición del título debe ejecutarse sin pensamiento: 22,8 s → 0,5 s |
| El agente acaba con **«Output token limit reached»**; «continúa» no ayuda; el indicador de contexto marca el 50 % | el cliente creía 262 144 tokens y el slot tenía 131 072 → el cliente nunca llegó a su umbral de compactación y el servidor truncó | declarar el contexto real por slot ([04 §6](04-cache-contexto-y-compactacion.md)) |
| Volver a un chat largo lo reprocesa todo (**> 5 min** en Qwen3.8) | `prompt state size … exceeds cache size limit`: el estado guardado es mayor que `--cache-ram` | dimensionar `cache-ram` con la fórmula; mantener ≥ 8 puntos de control ([04 §4](04-cache-contexto-y-compactacion.md)) |
| La compactación del contexto tarda **5 minutos** en lugar de segundos | muy pocos puntos de control: ninguno queda antes del prefijo de la petición de resumen | `ctx-checkpoints ≥ 8` |
| Un agente que envía un mensaje `system` a mitad de conversación recibe un error | la plantilla de fábrica de Qwen3.6 lanza *«System message must be at the beginning»* | parche de una línea en la plantilla ([06 §1.3](06-recetas.md)) |
| `failed to parse server config file` y el router nunca abre su puerto | el fichero INI empieza con una **marca de orden de bytes (BOM)** (`Set-Content -Encoding UTF8` de PowerShell 5.1) | escribir el fichero sin BOM |
| **`draft-mtp` no hace nada** (aceptación 0 en todas las peticiones) | el GGUF no tiene tensores MTP: algunas recuantizaciones y ajustes finos de la comunidad los eliminan | comprobar con `tools/gguf-header.mjs` antes de descargar 20 GB |
| Un panel que consulta el modelo **carga o desaloja** modelos | las peticiones de monitorización sin `autoload=false` cuentan como peticiones | usar `?model=<id>&autoload=false` en `/props`, `/slots`, `/metrics` |

## 3. Trampas de medición (cambiaron conclusiones antes de entenderse)

| Trampa | Síntoma | Defensa |
|---|---|---|
| **Máquina en frío** | la primera ejecución tras un reinicio o una carga de modelo es ~30 % más lenta con texto y aceptación idénticos (82,0 frente a 112,6 / 113,5 tok/s) | calentar, descartar la primera ejecución, no medir nunca justo después de un reinicio |
| **Los textos repetidos inflan copy/edit** | un ajuste fino de Qwen3.6 con la misma arquitectura copió a 131 → 168 → 233 tok/s en tres ejecuciones de *los mismos* textos (Qwen3.6 base: 118 → 165 → 148) | cambiar los textos entre variantes o comparar seguidas; la causa probable es el conjunto compartido de n-gramas (no verificado) |
| **Colocación de la memoria** | la misma configuración fue ~15 % más lenta con los pesos en memoria compartida en lugar de dedicada | mantener el conjunto residente dentro de la memoria dedicada |
| **Tiempos de espera del cliente** | un límite de 300 s del cliente cortó justo la ejecución que debía mostrar el problema (reprocesamiento completo) | un tiempo de espera mayor o `node:http` |
| **Estimaciones tomadas de otro modelo** | una estimación temprana del tamaño del punto de control de Qwen3.6 (≈188 MiB) era 3 veces mayor que los 62,8 MiB medidos y llevó a una afirmación errónea de «no cabrá» | medir cada modelo |
| **Las medias esconden la mezcla** | `ngram-mod` es +113 % al copiar y +0,5 % al razonar | informar siempre de números por carga, y decir qué parte de *tu* tráfico es copia |
