# Aula Python · Prueba técnica

Prototipo local del entorno de actividades. Ejecuta Python real con **Pyodide 0.27.7**, sin un servidor de ejecución ni base de datos. Incluye un editor de notebooks, importación/exportación `.ipynb` y una vista de alumno para probar bloqueos.

El módulo de **cuentas, alumnos y grupos con Supabase** ya tiene backend e interfaz independientes. Seguir [SUPABASE_SETUP.md](SUPABASE_SETUP.md) para ejecutar la migración, completar `.env`, crear el profesor y abrir `npm run accounts` en el puerto 4180. Requiere Node.js 22 o posterior; no afecta al guardado del laboratorio existente.

Para **crear actividades, asignarlas a grupos y contestarlas con las cuentas reales**, seguir [ACTIVIDADES_SETUP.md](ACTIVIDADES_SETUP.md). El módulo incluye notebooks, ejercicios con varios archivos, avances, entregas, calificaciones de 0 a 100, comentarios y devolución para correcciones con historial. Requiere las migraciones `202610170003_activities.sql` y `202610170004_reviews.sql` y reiniciar ambos servidores; si ya usas actividades, ejecutar solo la nueva migración 004.

La app con cuentas ahora es instalable y permite preparar actividades y Python para trabajar sin conexión. Consulta [PWA_OFFLINE.md](PWA_OFFLINE.md) para instalarla, conservar avances y sincronizarlos al recuperar Internet.

## Iniciar

Para publicar la app y permitir acceso desde otros equipos, consultar [PUBLICAR_RENDER.md](PUBLICAR_RENDER.md). Incluye un Blueprint para un servidor gratuito y una consola estática separada; Supabase conserva los datos existentes.

El guardado eficiente requiere la migración `202610170005_efficient_sync.sql`: autoguardado cada 60 segundos si hay cambios, envío de diferencias después del primer guardado, reintentos con el mismo identificador y seguimiento del profesor con frecuencia adaptable. Consultar [ACTIVIDADES_SETUP.md](ACTIVIDADES_SETUP.md) para los detalles de recuperación y actualización.

Requiere Node.js 20 o posterior.

```powershell
cd E:\ws\ActividadesPython
npm run dev
```

Abrir **http://127.0.0.1:4173** en Chrome o Edge actualizado. Mantener la terminal abierta; Ctrl+C detiene el servidor. No abrir `dist/index.html` directamente: `input()` y las interrupciones requieren las cabeceras de aislamiento que añade `server.mjs`.

El prototipo no necesita instalar dependencias para servir la página. La primera ejecución descarga Python y Matplotlib desde jsDelivr; puede tardar y requiere internet. Los recursos quedan sujetos al caché HTTP del navegador: aún no existe un modo offline garantizado.

## Prueba manual

1. En **Notebook**, pulsar **Ejecutar todas**.
2. Las primeras celdas deben mostrar los datos y un promedio de **15.8** usando las variables de la celda anterior.
3. Al aparecer la consola de entrada, escribir el nombre y pulsar **Enviar**. El saludo debe incluirlo y conservar el promedio.
4. La cuarta celda debe dibujar cinco barras y la línea del promedio.
5. Modificar `numeros` en la primera celda y volver a ejecutar las celdas: el cálculo y la gráfica deben cambiar.
6. En **Archivos Python**, ejecutar `main.py`. Escribir el nombre: deben aparecer el saludo importado desde `utilidades.py` y el promedio **9.0**.
7. Modificar la función de `utilidades.py` y ejecutar de nuevo sin recargar. Debe usarse la versión nueva.
8. Crear `extra.py` con `valor = 42`. Añadir `from extra import valor` y `print(valor)` a `main.py`; ejecutar para comprobar un tercer módulo.
9. Volver a Notebook; el cambio de espacio reinicia Python. Añadir una celda con `while True: pass` y ejecutarla. Pulsar **Detener**; el editor debe seguir respondiendo. Hay interrupción normal y reinicio forzado tras 1.5 segundos si el motor no responde.
10. Recargar la página: deben conservarse el código y los archivos. Las variables requieren volver a ejecutar las celdas.

## Comportamiento definido

### Editor de notebooks e importación

1. Recargar la página después de actualizar los archivos. Si el servidor sigue abierto, no hace falta reiniciarlo.
2. En la vista **Profesor**, usar **Descargar ejemplo** para obtener `actividad.ipynb`. También puedes usar tu propio notebook de Python.
3. Pulsar **Importar .ipynb** y elegir el archivo. Revisar el resumen antes de confirmar: cancelar conserva el notebook actual.
4. Tras importar el ejemplo, aparecerán una celda Markdown bloqueada, un ejemplo Python bloqueado y una celda de solución editable. La importación no ejecuta código.
5. Editar un título y el contenido de una celda. Agregar una celda **Instrucciones Markdown** para probar títulos (`##`), listas, negritas, cursivas y bloques de código. La vista previa se actualiza al escribir. Las nuevas instrucciones quedan bloqueadas para alumnos de forma predeterminada; el profesor sigue pudiendo editarlas.
6. Probar **Bloquear/Desbloquear**, los botones de subir/bajar, **Eliminar** y el selector de tipo de cada celda. Los cambios de estructura reinician la memoria Python.
7. Elegir **Vista → Alumno (prueba)**. Las instrucciones bloqueadas se muestran como texto formateado; el código bloqueado se puede ejecutar, pero es de solo lectura. No aparecen los controles del profesor.
8. Ejecutar el ejemplo y escribir `print(sum(calificaciones) / len(calificaciones))` en la celda de solución; el resultado debe ser `9.0`. **Ejecutar todas** salta las celdas Markdown y raw y ejecuta el código en orden.
9. Regresar a Profesor: la solución de prueba del alumno no debe haber cambiado la plantilla. Al entrar de nuevo a Alumno se conserva su copia. **Restablecer mi copia** descarta esas respuestas después de confirmar.
10. En Profesor, habilitar permisos de estructura y volver a Alumno. Se podrán agregar celdas, eliminar editables o intercambiar celdas editables según los permisos seleccionados. No se puede mover una celda a través de una bloqueada, eliminarla ni cambiar su bloqueo.
11. Pulsar **Descargar .ipynb** en Profesor, volver a importarlo y comprobar que conserva títulos, contenido, tipos, bloqueos y permisos. Se exporta la plantilla del profesor, sin resultados de ejecución ni respuestas de la copia de prueba.
12. Recargar: se conservan la plantilla, sus permisos y la copia de prueba. Por claridad, la página siempre inicia en vista Profesor. El guardado de la primera versión migra automáticamente sin perder código ni archivos.

La vista de alumno es una **simulación local**, no una cuenta autenticada. Editar la plantilla o sus permisos descarta la copia de respuestas de prueba; esto no representa todavía el comportamiento de una actividad publicada con alumnos reales. Al cambiar de vista se reinicia Python para separar las sesiones.

Se admiten notebooks `nbformat` 4 de Python, hasta **100 celdas y 2 MB**. Los campos `source` pueden ser texto o listas de líneas; se respetan `metadata.editable: false` y los bloqueos propios bajo `metadata.aula_python`. Los IDs ausentes, inválidos o duplicados se regeneran.

Las salidas importadas se descartan con aviso y nunca se interpreta su HTML. Los adjuntos se conservan al exportar, pero todavía no se muestran. Las celdas raw se conservan como texto sin ejecutar. Markdown admite títulos, listas, tablas, citas, negritas, cursivas (`*texto*` y `_texto_`) y bloques de código multilínea con backticks, tildes o sangría. Los bloques conservan sus saltos de línea y espacios. No incluye imágenes, enlaces activos, HTML ni LaTeX. Se avisa de comandos especiales de Jupyter (`%`, `!`); no se convierten automáticamente ni se garantiza su ejecución con Pyodide.

Los mensajes de descarga de Pillow y preparación de fuentes de Matplotlib son normales: aparecen en **Detalles de preparación de Python**, separados de la salida de las celdas. Los errores reales conservan el traceback y un aviso visible. Las salidas y errores se mantienen al agregar o reordenar celdas y al alternar entre las vistas durante la sesión; solo se reemplazan al volver a ejecutar esa celda. Importar un notebook, crear uno nuevo o restablecer la copia de alumno descarta los resultados correspondientes. Recargar la página también descarta las salidas, pues aún no se guardan en disco.

### Ejecución y guardado

- Las celdas comparten un diccionario de variables y el mismo intérprete durante la sesión del notebook.
- Cada ejecución del programa de archivos crea un diccionario de variables nuevo y elimina del intérprete los módulos locales de la ejecución anterior, incluidos sus archivos de bytecode. No es una máquina virtual nueva por ejecución.
- Cambiar entre Notebook y Archivos destruye el worker anterior. Así no se mezclan los dos espacios; al regresar al notebook hay que volver a ejecutar las celdas.
- `input()` usa memoria compartida y espera en el worker, no en el hilo de la interfaz. Admite Unicode, líneas vacías y varias preguntas consecutivas. Límite: 64 KB por respuesta.
- Matplotlib utiliza el backend Agg. `plt.show()` envía imágenes PNG a la interfaz; también se muestran las figuras abiertas al terminar una ejecución. No hay widgets gráficos interactivos.
- Se guardan código y archivos en `localStorage` del origen actual. No se guardan salidas, gráficas ni objetos Python. No cambiar entre `localhost` y `127.0.0.1` para recuperar el mismo guardado.
- Hay un límite de 30 segundos por ejecución (el tiempo esperando `input()` no se cuenta) y 100 000 caracteres de salida. Cada respuesta a `input()` inicia un nuevo tramo de 30 segundos.
- Se permite copiar y pegar para facilitar la prueba técnica. En vista Alumno las celdas bloqueadas son de solo lectura; aún no se implementa el bloqueo general del portapapeles.
- El editor usa textareas con sangría mediante Tab. El laboratorio de esta sección sigue siendo una prueba independiente; las cuentas, actividades y calificaciones reales están en el módulo del puerto 4180. El resaltado de sintaxis queda para una siguiente fase.

## Verificación automatizada

```powershell
npm ci
npm test
```

Solo las pruebas y el mantenimiento necesitan las dependencias npm. La primera vez las pruebas descargan paquetes de Pyodide a `.runtime-cache/`; en ejecuciones posteriores se reutilizan. Las pruebas requieren permiso para conexiones a localhost y, en la primera ejecución, al CDN. Se recomienda Node.js 22.12 o posterior para ejecutar las pruebas con la versión instalada de jsdom. El analizador Markdown (Marked) y su licencia están incluidos en `dist/vendor/`: la página no lo descarga de terceros al abrirse.

`tests/runtime.test.mjs` ejecuta **el mismo archivo de worker usado por la aplicación**, con un adaptador de `worker_threads` en Node. Verifica variables y objetos compartidos, entrada Unicode y vacía, firma PNG de Matplotlib, imports actualizados, separación de variables entre programas, recuperación después de errores y detención. `tests/model.test.mjs` verifica recuperación de código, validaciones y cabeceras HTTP.

`tests/notebook.test.mjs` valida importación/exportación, errores, migración del guardado y las reglas de bloqueo. `tests/notebook-ui.test.mjs` ejercita el editor real contra un DOM de jsdom: controles del profesor, copia de alumno, confirmación de importación, texto seguro y orden de ejecución.

`tests/markdown.test.mjs` reproduce los formatos de cursiva y código multilínea reportados. `tests/app-runtime.test.mjs` carga el módulo real de la aplicación en jsdom y conecta su protocolo de worker al motor Pyodide real en Node: prueba la ejecución del alumno, un NameError legible, la conservación de su salida, los mensajes de preparación separados, `input()` y una gráfica PNG.

Las pruebas `accounts*` verifican el CSV, el cambio obligatorio de clave, la autorización de la API y la interfaz administrativa. La migración SQL se ejecuta en PostgreSQL embebido con PGlite para verificar RLS y el aprovisionamiento atómico de perfiles. La conexión al proyecto Supabase del usuario requiere configuración; estas pruebas no usan sus datos reales.

Las pruebas `activities*` verifican permisos de respuesta, versiones publicadas, guardado, entregas, PostgreSQL y el flujo de interfaz con cuentas de prueba. `runner.test.mjs` verifica el ejecutor aislado usando el motor Python real y un DOM de Node.

**Alcance de verificación:** el usuario probó el editor y reportó fallos de formato y mensajes de preparación que parecían errores. Estos casos se reprodujeron y corrigieron mediante pruebas de Markdown y de la aplicación con el motor real. El intento de prueba visual volvió a ser rechazado por un permiso guardado del navegador para localhost; no se automatizó otro navegador para eludirlo. Las pruebas de Node no verifican la tipografía final en pantalla.

## Antes de usar con alumnos

Esta es una prueba local sin cuentas ni datos personales. El servidor solo escucha en `127.0.0.1` y solo publica `dist/`. Este apartado describe el laboratorio original de dist/. La app de cuentas tiene un ejecutor separado, validación de permisos en el servidor y preparación PWA; consulta PWA_OFFLINE.md y PUBLICAR_RENDER.md.

El worker se ejecuta en el mismo origen de la interfaz y el código Python puede acceder a APIs JavaScript. Antes de introducir autenticación, se debe mover el ejecutor a un origen separado sin tokens ni datos de usuarios, restringir red y mensajes, sanear futuras salidas HTML y añadir las reglas de autorización del servidor. Los bloqueos actuales se aplican en la interfaz y en las funciones de edición locales: cuando exista backend se debe comprobar contra la plantilla del profesor todo cambio recibido. Un Web Worker ni un selector local de roles son una frontera de seguridad para código hostil.

Los archivos son virtuales, creados dentro del editor. No hay carga de archivos externos, acceso directo al disco, Tkinter ni instalación arbitraria de paquetes. Para esta prueba se carga Matplotlib; otras bibliotecas se deben habilitar y verificar explícitamente.

## Estructura

| Archivo | Propósito |
| --- | --- |
| `dist/index.html`, `dist/styles.css` | Interfaz responsive |
| `dist/app.js` | Celdas, archivos, consola, memoria compartida y guardado |
| `dist/model.js` | Datos iniciales y validación del guardado |
| `dist/notebook.js` | Formato ipynb y reglas de edición de celdas |
| `dist/notebook-editor.js`, `dist/code-editor.js` | Editor y vista de alumno |
| `dist/markdown.js`, `dist/vendor/marked.js` | Analizador Markdown y renderizado DOM sin interpretar HTML |
| `dist/examples/actividad.ipynb` | Notebook de ejemplo para probar importación y bloqueos |
| `dist/python-worker.js` | Intérprete Python, entrada/salida y gráficas |
| `server.mjs` | Servidor local con COOP/COEP |
| `tests/` | Pruebas del motor y del servidor |

Documentación: [Pyodide](https://pyodide.org/en/0.27.7/usage/index.html), [entrada y salida](https://pyodide.org/en/0.27.7/usage/streams.html), [interrupciones](https://pyodide.org/en/0.27.7/usage/keyboard-interrupts.html).
