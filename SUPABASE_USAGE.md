# Uso de Supabase en Aula Python

El límite de llamadas no es la principal cuota del plan Free: Supabase anuncia solicitudes API ilimitadas. Las cuotas relevantes incluyen 5 GB de salida de datos, 500 MB de base de datos por proyecto, 50 000 usuarios activos mensuales y 1 GB de Storage. La salida en caché tiene una cuota independiente; no debe sumarse a la disponible para consultas REST a PostgreSQL.

Fuentes: [precios oficiales](https://supabase.com/pricing), [medición de egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress). Verificadas el 3 de noviembre de 2026. Las cuotas pueden cambiar.

## Qué consume la app

- El servidor de Render consulta Supabase para cuentas, grupos, plantillas, asignaciones, respuestas y revisiones. Las comprobaciones de acceso y las revisiones actuales se vuelven a consultar antes de modificar datos.
- Los archivos Python son texto dentro de PostgreSQL. Ocupan la cuota de base de datos, no la de archivos de Supabase Storage. Las revisiones explícitas conservan su código histórico; los guardados automáticos actualizan la respuesta actual.
- La interfaz y el editor se sirven desde Render; Python y Matplotlib se descargan desde su CDN y se conservan en la caché offline. Esas descargas no usan la transferencia de Supabase.
- No hay suscripciones permanentes de Supabase Realtime ni consultas de seguimiento por alumno.

## Reducción de tráfico aplicada

- El seguimiento docente automático solo se actualiza mientras se muestra la pantalla de avances, la pestaña es visible y hay conexión. Al revisar código, editar plantillas, volver al catálogo o pasar a otra pestaña, se detiene. En la pantalla de avances conserva el intervalo adaptable de 30 a 120 segundos y la actualización manual.
- La carga de alumnos y grupos reutiliza la consulta de grupos para buscar integrantes. Con grupos existentes elimina una de las cinco consultas del endpoint, incluida la comprobación de perfil: pasa de cinco a cuatro.
- Al abrir su actividad, el alumno reutiliza el perfil que el servidor acaba de validar en esa misma petición. Esto no crea una caché de autorizaciones ni retrasa una desactivación.
- Para revisar una entrega se consultan únicamente su revisión, entrega y plazos. El código completo se carga cuando se abre para leerlo, no para comprobar su estado.
- Cerrar o reabrir una asignación consulta y devuelve únicamente metadatos; no descarga la plantilla completa ni devuelve su proyecto en la confirmación.
- El catálogo del alumno limita los estados a las asignaciones accesibles. Si no hay asignaciones, omite la consulta de estados.
- Se mantienen los guardados diferenciales: se envían los archivos o celdas modificados, las confirmaciones son pequeñas y no se guarda si no hubo cambios. Los cambios se conservan localmente al escribir; el guardado automático con conexión se intenta cada 60 segundos y al abandonar u ocultar la página. Los fallos aplican esperas progresivas. Guardar ahora y entregar siguen disponibles.

## Cómo comprobar el consumo real

En Usage de la organización de Supabase, selecciona el proyecto y el ciclo mensual de facturación. Revisa la salida de datos por producto y el tamaño de la base de datos. Un conteo de registros, el tráfico del navegador hacia Render o una prueba con datos ficticios no sustituyen esas métricas.

Las pruebas `supabase-traffic.test.mjs`, `efficient-sync.test.mjs` y `progress-traffic-ui.test.mjs` verifican las consultas eliminadas con el SDK, los permisos y la pausa efectiva del seguimiento. No escriben en el proyecto real.

Estas optimizaciones no garantizan que nunca se alcance una cuota: el consumo también depende del número de alumnos, el tamaño de los proyectos, las revisiones conservadas, las reaperturas y otros clientes del mismo proyecto u organización. No se eliminan actividades, respuestas ni historial para reducir espacio.

## Evitar reintentos internos de conflictos de revisión

Los RPC de la app usaban SQLSTATE `40001` para un conflicto de revisión esperado. Supabase documenta que PostgREST 14 puede reintentar indefinidamente una excepción personalizada con ese código. No representa un fallo transitorio: repetir la misma revisión desactualizada nunca tendrá éxito.

La migración `202611030001_conflict_sqlstate.sql` cambia únicamente ese código a `PT409` en los tres RPC de guardado y revisión. Conserva las funciones, los permisos, la validación, las actividades, las respuestas y el historial. El adaptador Node acepta ambos códigos durante la transición y devuelve HTTP 409 para que el editor conserve la copia local y detenga la sincronización hasta resolver el conflicto.

Las conexiones que ya estuvieran atrapadas deben identificarse por PID, inicio de sesión, usuario, aplicación y consulta antes de cerrarlas individualmente. No es necesario reiniciar el proyecto ni contratar otro plan para corregir este problema.

Referencia: [Supabase: SQLSTATE 40001 e infinite retries](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions).
