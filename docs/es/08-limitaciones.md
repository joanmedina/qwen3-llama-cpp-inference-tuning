# 08 · Limitaciones y amenazas a la validez

[← Trampas y resultados negativos](07-trampas-y-resultados-negativos.md) · [Índice](../../README.es.md) · [Siguiente: Reproducir →](09-reproducir.md)

Esto es un informe de ingeniería hecho en la máquina de una persona, no un estudio de benchmarks controlado. La lista siguiente dice qué respalda la evidencia, qué no, y qué no se midió nunca.

## 1. Validez externa (¿se trasladará?)

| Límite | Consecuencia |
|---|---|
| **Una máquina**: mini PC AMD Ryzen AI Max+ 395 (Strix Halo), 128 GB de LPDDR5X unificada, Windows 11, backend **Vulkan**, llama.cpp **compilación 11721** (octubre de 2026) | Los tokens/s absolutos son propios de ella. Los efectos **relativos** (decodificación especulativa, puntos de control, topes de pensamiento) deberían trasladarse a otras configuraciones limitadas por el ancho de banda; los resultados de dos GPU y de colocación de memoria son propios de una APU de memoria unificada |
| **Otros backends y sistemas operativos no probados**: ROCm, solo CUDA, Metal, Linux | El comportamiento específico de Vulkan (p. ej. flash attention, tamaños de lote) puede diferir |
| **Una cuantización por modelo** (Q4_K_M, de cuantizadores concretos) | No se compararon las variantes Q5/Q6/Q8/IQ ni su aceptación MTP o su calidad. La calidad de la cuantización (perplejidad/KL) **no** se midió |
| **Modelos**: solo Qwen3.6-35B-A3B y Qwen3.8-27B | Las recetas deberían aplicarse a otros modelos híbridos Qwen3.x (otras versiones y ajustes finos) con cabeza MTP, pero es una extrapolación (una comprobación en un híbrido que no es de Qwen mostró que la mitad de n-gramas se generaliza, [doc 03](03-decodificacion-especulativa.md) §8) |
| **El software cambia deprisa** | Las opciones, los valores por omisión y las velocidades cambian entre compilaciones de llama.cpp. Vuelve a medir al actualizar; trátalo como una instantánea fechada |

## 2. Validez interna (¿son correctos los números?)

- **Muestras pequeñas.** Los lotes rápidos usan 3 fragmentos de código × 1 semilla; las afirmaciones clave se replicaron con 3 × 3; el antes/después de producción es una pasada cada uno (más tres ejecuciones en caliente posteriores). Con la iGPU sola, dos pasadas idénticas difirieron un **±15–20 %**. Las conclusiones descansan en efectos mayores o en replicaciones, y los documentos lo dicen donde una cifra está dentro del ruido (una diferencia del 15 % entre dos modelos medidos una vez cada uno se lee como «no más lento», nunca como «más rápido»).
- **Secuencial, no aleatorizado.** Las variantes de un lote se ejecutaron seguidas y con calentamiento, pero el orden no se aleatorizó y el estado térmico y de caché deriva. El efecto del arranque en frío (~30 %) muestra que el estado importa.
- **Texto con semilla fija.** Con semillas fijas las tasas de aceptación se repiten exactamente entre pasadas; las velocidades, no. Una semilla fija también significa una *única trayectoria de muestreo* por celda: la aceptación con otros textos puede diferir.
- **La colocación de la memoria confundió algunas comparaciones tempranas** (memoria de GPU compartida o dedicada, [doc 01](01-hardware-y-software.md) §4); los cambios relativos fueron coherentes entre colocaciones, los valores absolutos no.
- **Concurrencia.** Otros clientes en el servidor durante una medición la distorsionarían; las comprobaciones se basaron en contadores del servidor y no fueron exhaustivas en todos los lotes tempranos.

## 3. Validez de constructo (¿significan los tok/s «un agente más rápido»?)

- Las cargas son **sustitutos sintéticos** del comportamiento de un agente (copiar, editar, llamada a herramienta de edición, razonar). No son tiempos de finalización de tareas de extremo a extremo. La mejora en una tarea real depende de **cuánta parte de su salida repite el contexto** (un perfil medido *antes* del ajuste: [doc 03](03-decodificacion-especulativa.md) §2); una carga de escritura libre casi no ve nada de la mejora de `ngram-mod`.
- El código de nuestras ejecuciones era TypeScript. Otros lenguajes o formatos (prosa, JSON, tablas) cambian la estructura de repetición.
- Las **baterías de calidad son diminutas** (10 + 8 problemas, una ejecución por ajuste; un problema son 12,5 puntos en el conjunto difícil). Son barandillas contra «más rápido pero roto», no una evaluación del modelo. **No se midieron aquí tareas largas con herramientas.**
- `repeat-penalty 1.0` se comprobó solo con esas baterías; es posible un bucle de razonamiento en un caso que no cubren.
- El resultado «Medium es el punto óptimo» es para Qwen3.6 (con un ajuste fino de la misma arquitectura como contraste). En Qwen3.8 se verificó que los niveles *funcionan* (HTTP 200, traducción), no se evaluó su precisión.
- La **comparación de calidad entre los dos modelos es de un tercero** (Artificial Analysis Intelligence Index v4.3.2, leído el 2026-10-24). No se reprodujo.

## 4. Nunca medido

Linux/ROCm; solo CUDA; contextos de más de ~200 000 tokens en Qwen3.8 y una ventana de 262 144 para él; `--parallel` > 1 y el comportamiento del KV unificado; `--checkpoint-min-step` distinto de 8192; la velocidad con el proyector de visión en uso; consumo eléctrico, temperatura y el plan de energía del SO; el efecto del proyector de visión en el tamaño de las cachés; una medición de campo a largo plazo de la aceptación tras el cambio (la tasa de aceptación del 77,3 % es de *antes* de él); variantes de muestreo distintas de las indicadas.

## 5. Qué se publica y qué no

- Publicado: todos los números usados en tablas y figuras, y las observaciones sueltas citadas en el texto ([`data/`](../../data/), con configuración y procedencia por fichero), los ficheros de configuración, los benchmarks, el generador de figuras y la herramienta de cabeceras. Los datos de hardware (fecha de la BIOS, versión del controlador, tamaños de memoria) salen de la información del sistema y del registro de arranque del servidor, y no se repiten en `data/`.
- **No publicado**: los registros en bruto del servidor y las salidas por petición, porque los prompts de las ejecuciones originales contenían fragmentos de una base de código privada. Los benchmarks incluidos usan fragmentos sintéticos para que cualquiera pueda repetir el *método*, pero sus números absolutos no coincidirán exactamente con los nuestros.
- Los números se transcribieron de informes internos de medición a `data/*.json`; las figuras se generan a partir de esos ficheros, así que una errata en una tabla puede contrastarse con el JSON.

## 6. Cómo leer una afirmación de este repositorio

1. Localiza el **fichero de datos** y la línea de **configuración** de la tabla.
2. Comprueba si el efecto es mayor que el ruido del [doc 02](02-metodologia.md) §4.
3. Comprueba si se **replicó** (el texto lo dice) o es un único lote.
4. Vuelve a medir en tu hardware con [`bench/`](../../bench/) antes de adoptarla.

Las correcciones y las reproducciones independientes son bienvenidas (véase [CONTRIBUTING](../../CONTRIBUTING.md)).
