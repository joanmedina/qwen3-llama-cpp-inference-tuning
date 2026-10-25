# 02 · Metodología

[← Hardware y software](01-hardware-y-software.md) · [Índice](../../README.es.md) · [Siguiente: Decodificación especulativa →](03-decodificacion-especulativa.md)

Esta página explica cómo se obtuvieron los números, qué pueden y qué no pueden sustentar, y qué factores de confusión aparecieron por el camino. El objetivo es que alguien con otra máquina pueda repetir el *método* aunque los números absolutos difieran ([doc 09](09-reproducir.md)).

## 1. Preguntas de investigación

1. **Velocidad de generación.** ¿Qué ajustes de decodificación especulativa de `llama-server` maximizan los tokens/s para la carga de un agente de programación (mucho copiar y editar texto que ya está en el contexto, más razonamiento)?
2. **Caché del prompt y contexto.** ¿Cómo hay que dimensionar la caché del prompt en RAM y los puntos de control de contexto para que los chats largos, las peticiones ajenas y la compactación del contexto del agente no obliguen a reprocesar todo el historial?
3. **Pensamiento.** ¿Cómo equilibran precisión y tiempo los presupuestos de pensamiento y el interruptor de encendido/apagado, y qué envía realmente un cliente al servidor?
4. **Ajustes que no importaron.** ¿Cambian algo los hilos de CPU, los tamaños de lote, el tipo de caché KV, el muestreo en el backend o una segunda GPU?

## 2. Diseño: un factor cada vez, sobre una copia de la configuración real

- El router de producción (`:8080`) **no se modificó nunca mientras se medía**. Todas las variantes se ejecutaron en un *router temporal* en otro puerto (`--models-max 1`), lanzado desde una **copia del preset de producción en la que solo cambiaba el factor bajo prueba**. Cada variante cargó el modelo desde cero (sin estado heredado) y recibió una petición de calentamiento antes de medir.
- La configuración candidata final se validó entera (el modelo carga, responde y el servidor muestra los argumentos nuevos en `/models`) **antes** de aplicarla; se aplicó con copias de seguridad y un reinicio del router, y se volvió a medir en producción con las mismas cargas. Todos los cambios de este repositorio tienen una reversión exacta.
- El punto de partida de cada experimento es la configuración que estaba en producción antes de él (indicada en cada tabla). No era una configuración por omisión: ya usaba MTP con 2 tokens borrador, un contexto de 262 144 tokens, caché KV `q8_0`, flash attention y tamaños de lote 2048/1024.

## 3. Cargas de trabajo

Un agente de programación pasa la mayor parte del tiempo reescribiendo ficheros y citando texto que ya está en su contexto, intercalado con razonamiento y llamadas a herramientas. Se definieron seis cargas (el [`bench/spec-bench.mjs`](../../bench/spec-bench.mjs) del repositorio implementa las mismas con código sintético incluido):

| Carga | Qué le pide al modelo | Qué pone a prueba |
|---|---|---|
| `copy` | copiar literalmente un fragmento de código de ~1400 caracteres | el mejor caso para la autoespeculación con n-gramas |
| `edit` | reescribir el fragmento añadiendo un comentario de una línea sobre cada función | tramos largos copiados con pequeñas inserciones |
| `edit-tool` | una llamada a una herramienta `edit` cuyo `old_string` hay que copiar del contexto y cuyo `new_string` contiene el cambio | el paso realista de un agente |
| `prose` | explicación de ~300 palabras | poco que copiar; solo MTP |
| `agent` | un paso de agente con definiciones de herramientas y razonamiento acotado | mixta |
| `reasoning` | razonamiento libre acotado a unos cientos de tokens | nada que copiar: los n-gramas especulativos no pueden ayudar |

En nuestras ejecuciones los fragmentos eran código fuente real (TypeScript, tres ficheros distintos); las salidas en bruto contienen ese código y por eso **no se publican**. Las tablas y las figuras sí.

## 3.1 Métricas

| Métrica | Definición |
|---|---|
| **TG** | tokens/s de generación, tal como los devuelve el servidor: `timings.predicted_per_second` |
| **PP** | tokens/s de procesamiento del prompt (prefill): `timings.prompt_per_second` |
| **Aceptación** | `timings.draft_n_accepted / timings.draft_n`: la proporción de tokens borrador propuestos que el modelo objetivo aceptó |
| **Tiempo de vuelta** | segundos reales de la petición que vuelve a un chat largo después de que una petición ajena ocupara el único slot |
| **Precisión** | respuestas correctas sobre un conjunto fijo de problemas con una única respuesta comprobable (solo se evalúa el contenido final) |
| **Medida de repetición** | proporción de grupos de 6 palabras repetidos en una respuesta; el texto natural da 0,05–0,25, un bucle de razonamiento supera 0,5 |

## 4. Semillas, repeticiones y qué cuenta como efecto

- Cada petición usó una **semilla de muestreo fija**; con semilla fija el *texto* es idéntico entre ejecuciones, así que las diferencias de velocidad vienen del servidor y de la máquina, no de salidas distintas. (Consecuencia: las tasas de aceptación se repiten exactamente entre pasadas; las velocidades, no.)
- Lotes rápidos: 3 fragmentos × 1 semilla. Las afirmaciones clave se **replicaron** con 3 fragmentos × 3 semillas, y la producción se midió tres veces.
- **Ruido.** Con la iGPU sola, dos pasadas de la misma configuración difirieron un **±15–20 %**; la configuración con dos GPU, un ±3 %. Las diferencias de menos de un 3 % aproximadamente dentro de un mismo lote se trataron como ruido, y nunca se usa una sola ejecución para afirmar una mejora inferior a ~15 %. Por eso resultados como «un 15 % más rápido» al cambiar de modelo se presentan como «no más lento».
- Los porcentajes son relativos al punto de partida de la misma tabla y se calcularon con medias sin redondear.

## 5. Factores de confusión encontrados (y cómo se trataron)

| Factor de confusión | Evidencia | Tratamiento |
|---|---|---|
| **Máquina en frío.** La primera medición tras reiniciar el router o cargar un modelo es más lenta | 82,0 tok/s en la primera ejecución de producción frente a 112,6 y 113,5 en las dos siguientes, con texto y aceptación del borrador idénticos | petición de calentamiento; descartar la primera ejecución; no medir nunca justo después de un reinicio |
| **Colocación de la memoria** (memoria de GPU dedicada o compartida) | 60,3 tok/s en un router temporal frente a 70,3 en producción para la misma configuración de partida | comparar variantes solo con la misma colocación; véase el [doc 01](01-hardware-y-software.md) §4 |
| **Los textos repetidos inflan copy/edit** | velocidad de copia de un ajuste fino de Qwen3.6 con la misma arquitectura: 131 → 168 → 233 tok/s en tres repeticiones de los mismos textos, aceptación 81–91 % (el Qwen3.6 base fue 118 → 165 → 148, y su primera ejecución era la de la máquina en frío) | probablemente el conjunto de n-gramas que el servidor comparte entre peticiones (no verificado); variar los textos al comparar y comparar las variantes seguidas |
| **Otros clientes en el servidor** | otra sesión usó el modelo durante una pasada | leer los contadores del servidor (`/metrics`) antes y después de cada etapa; en una comprobación posterior de otra variante de Qwen3.6 el modelo de producción tuvo `+0` tokens durante las etapas de velocidad |
| **Tiempos de espera del cliente** | un reprocesamiento de ~100 000 tokens lo cortó a los 300 s el cliente HTTP (`fetch` de Node) | usar `node:http` o un tiempo de espera mayor en las peticiones largas |

## 6. Comprobaciones de calidad

Dos baterías pequeñas protegen frente a «más rápido pero peor»: 10 problemas *fáciles* y 8 *difíciles* con una única respuesta comprobable (aritmética de varios pasos, lógica, qué imprime un fragmento, un fallo de código, una consulta SQL, horarios, conteo, una probabilidad), una ejecución por ajuste, con la generación limitada a 4500 tokens. Son **deliberadamente pequeñas y baratas**: con 8 problemas, una respuesta son 12,5 puntos porcentuales, así que solo se comentan como diferencia las de dos o más problemas. No miden la calidad de un agente en tareas largas.

## 7. Regla de decisión

Un cambio se adoptó solo si (1) su mejora quedaba fuera de la banda de ruido **y se replicó**, (2) las cargas de razonamiento no empeoraron, (3) las baterías de calidad no cambiaron y (4) podía revertirse con un comando de una línea. Los cambios que no cumplieron (1) están en el [doc 07](07-trampas-y-resultados-negativos.md).

## 8. Datos y figuras

`data/*.json` contiene los números medidos con su configuración y procedencia; [`figures/make-figures.mjs`](../../figures/make-figures.mjs) regenera todas las figuras a partir de ellos (`node figures/make-figures.mjs`). Las tablas de estas páginas están transcritas de los mismos ficheros.
