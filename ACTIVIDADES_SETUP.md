# Actividades, asignaciones y respuestas

## Actualizar Supabase

La cuenta de profesor ya existente se conserva. En **SQL Editor → New query**, ejecutar una vez el contenido de:

`supabase/migrations/202610170003_activities.sql`

Esta migración agrega actividades, asignaciones, respuestas, políticas RLS y la función de guardado atómico. No elimina alumnos, grupos ni cuentas. Si ya está instalada, no hay que repetirla.

Para calificar, comentar y devolver entregas, ejecutar después, una sola vez:

`supabase/migrations/202610170004_reviews.sql`

Agrega las calificaciones y el historial sin borrar respuestas anteriores. En una instalación que ya tiene actividades, ejecutar solo esta nueva migración 004.

Para el guardado eficiente, aplicar después `supabase/migrations/202610170005_efficient_sync.sql`, una sola vez. Si ya usas calificaciones, solo hace falta esta nueva migración 005. Permite enviar diferencias, reintentar un guardado sin duplicarlo y consultar un resumen compacto de avances. Los clientes anteriores pueden seguir guardando respuestas completas durante la actualización.

Después, desde esta carpeta:

```powershell
npm run activities:check
```

Debe confirmar que las tablas y columnas de actividades y revisiones están disponibles. La comprobación no muestra claves ni modifica datos.

## Iniciar la aplicación

Reiniciar las terminales anteriores para cargar el código y las cabeceras actualizadas. Mantener ambas abiertas:

```powershell
# Terminal 1: aplicación con cuentas, actividades y respuestas
npm run accounts
```

```powershell
# Terminal 2: ejecutor de Python, en un origen separado
npm run dev
```

Entrar en **http://127.0.0.1:4180** con tu cuenta de profesor. La consola de cada actividad se carga desde **http://127.0.0.1:4173/runner.html**. Usar `127.0.0.1` en ambas direcciones; no mezclar con `localhost`. Este acceso sigue siendo local: los alumnos de otros equipos no podrán conectarse todavía hasta alojar la aplicación.

## Profesor: crear un notebook

1. En **Alumnos y grupos**, verificar que el grupo tenga alumnos. Un grupo vacío también admite asignaciones, pero no tendrá respuestas hasta agregar integrantes.
2. Abrir la pestaña **Actividades y avances → Crear notebook**.
3. Escribir el título y las instrucciones generales en Markdown.
4. Editar las celdas, cambiar tipos, agregar, eliminar y reordenar. **Importar .ipynb** permite partir de un notebook existente. La importación no ejecuta código.
5. Bloquear instrucciones y ejemplos. Las nuevas instrucciones Markdown quedan bloqueadas de forma predeterminada. Puedes configurar permisos para que el alumno agregue, elimine o reordene celdas editables.
6. Probar una celda o **Ejecutar todas** en la consola aislada. La memoria Python se comparte entre las celdas de esta actividad mientras su consola siga abierta. Si se reinicia o se vuelve a abrir la actividad, hay que ejecutar de nuevo para recuperar variables.
7. Pulsar **Guardar actividad**. Los cambios de la plantilla se conservan como borrador local mientras escribes, pero solo **Guardar actividad** los registra en Supabase.

## Profesor: crear una actividad con ejercicios

1. Elegir **Crear actividad de ejercicios**.
2. Para cada ejercicio, introducir su título, enunciado y archivos iniciales.
3. Agregar y renombrar archivos `.py`, cambiar entre pestañas y elegir el archivo principal.
4. Bloquear archivos de ejemplo cuando corresponda; el alumno podrá ejecutarlos, pero el servidor rechazará cambios a su contenido.
5. Usar **Agregar ejercicio**, **Anterior** y **Siguiente**. Cada ejercicio conserva sus propios archivos. Los alumnos pueden crear, renombrar y eliminar archivos editables, sin eliminar los protegidos ni dejar el ejercicio sin archivos.
6. **Ejecutar ejercicio** inicia un entorno con variables y módulos locales limpios. Los archivos de un mismo ejercicio pueden importarse entre sí.
7. Guardar la actividad.

## Asignar a grupos

En **Asignar una versión guardada a grupos**, seleccionar la actividad, uno o varios grupos y, opcionalmente, una fecha límite. La hora se interpreta según la zona horaria del equipo y se envía como fecha UTC al servidor.

La asignación guarda una copia fija del título, instrucciones, celdas, ejercicios y bloqueos. Editar después la plantilla crea una versión nueva y no cambia las asignaciones existentes. Para publicar la versión nueva hay que asignarla de nuevo. Una misma versión no puede asignarse dos veces al mismo grupo; se informa el duplicado sin sobrescribir la asignación previa.

Los alumnos que se incorporen después al grupo también ven sus asignaciones. Quitar un alumno del grupo retira su acceso a esas asignaciones; el profesor conserva la posibilidad de revisar sus respuestas previas en los avances.

## Alumno: contestar y entregar

1. Entrar con número de control y contraseña. Si todavía es temporal, completar primero el cambio obligatorio.
2. En **Mis actividades**, abrir una asignación de sus grupos.
3. Editar las celdas o archivos permitidos y ejecutar para probar. Los ejemplos bloqueados se pueden ejecutar.
4. El código se conserva localmente tras cada cambio y se sincroniza cada **60 segundos** si hay modificaciones, conexión y la página está visible. **Guardar ahora** fuerza la sincronización. Se intenta guardar también al ocultar la pestaña y al recuperar conexión; al cerrar el navegador ese último envío es de mejor esfuerzo y la copia local sigue siendo la protección principal.
5. El estado muestra si los cambios están pendientes, guardados o en conflicto. Si hay un corte de conexión, se conserva la copia local y se reintenta posteriormente.
6. **Entregar actividad** guarda la respuesta completa y la confirma en el servidor. Después queda en solo lectura. Una actividad cerrada o con plazo vencido tampoco admite nuevas escrituras.

El servidor comprueba la pertenencia al grupo, la cuenta activa, el cambio de contraseña, los bloqueos de celdas y archivos, la revisión de la respuesta y el estado de entrega. No basta con modificar los controles del navegador para saltarse los bloqueos.

Se bloquean copiar, cortar, pegar y arrastrar texto en la interfaz autenticada del alumno y en su consola, manteniendo el acceso con gestores de contraseñas en las pantallas de autenticación. Esta restricción de interfaz no puede impedir que el usuario la eluda con herramientas externas.

## Profesor: revisar avances

En cada asignación, pulsar **Ver avances**. Se muestra el estado de cada alumno y la última sincronización; el resumen consulta inicialmente cada 30 segundos y reduce su frecuencia hasta 120 segundos si no hay cambios. Se pausa cuando la vista está oculta o el navegador está sin conexión; tras fallos aumenta la espera hasta cinco minutos. **Actualizar avances** consulta de inmediato. **Ver último avance** abre el código guardado, incluso antes de la entrega, en una vista de solo lectura que también permite ejecutarlo para comprobarlo. Volver a pulsarlo obtiene la versión más reciente; el editor de revisión no sustituye su contenido automáticamente mientras lo estás leyendo.

## Ahorro de consultas y transferencia

- Los listados cargan títulos y versiones; el contenido de una plantilla se descarga al abrirla.
- El primer guardado envía la respuesta completa. Los siguientes envían solo los campos cambiados (por ejemplo, una celda o un archivo); reordenar o agregar celdas puede requerir enviar su estructura completa.
- La respuesta completa sigue almacenada en Supabase. No hace falta reconstruir una larga cadena de diferencias para revisar avances ni para recuperar el trabajo.
- El servidor valida la respuesta completa reconstruida y mantiene una caché acotada de plantillas inmutables y respuestas confirmadas. Revisa cada vez el acceso, estado de la cuenta, grupo, plazo y revisión vigente; no usa esa caché para saltarse permisos. Un reinicio solo provoca nuevas lecturas, no elimina las respuestas guardadas.
- El seguimiento consulta un resumen en una función SQL, sin descargar código ni plantillas. Si nada cambió, devuelve únicamente un marcador y no repite la lista de alumnos.
- Si hubo cambios que después se revirtieron, no se guarda otra vez. Si se pierde el acuse de un guardado, se conserva su identificador en la copia local para repetir la misma operación sin incrementar de nuevo la revisión. Los fallos de red retrasan los reintentos automáticos; Guardar ahora permite intentarlo antes.
- Las pestañas con una versión anterior y los conflictos entre dispositivos siguen sin sobrescribir respuestas nuevas. No se garantiza que un navegador sin espacio o cuyos datos locales se borraron conserve trabajo sin sincronizar; el estado avisa si falla la copia local.

Las salidas de consola, gráficas y objetos Python no se guardan en Supabase: se guarda el código. Para volver a ver resultados es necesario ejecutar. **Cerrar actividad** impide futuras escrituras, incluidas las correcciones. Reabrir una actividad no amplía una fecha límite que ya venció. Las entregas continúan bloqueadas hasta que se devuelven individualmente.

## Calificar, comentar y devolver

1. Como profesor, abrir **Actividades y avances → Ver avances → Ver último avance** del alumno.
2. Si la respuesta está entregada, aparece **Revisar entrega**. La calificación admite valores de **0 a 100** con hasta dos decimales; dejar vacía para comentar sin nota. Los comentarios admiten Markdown y hasta 10 000 caracteres.
3. **Guardar calificación y comentarios** publica la revisión. La respuesta permanece en solo lectura; el alumno ve la nota y los comentarios al abrirla.
4. Para pedir cambios, escribir qué corregir, elegir un plazo futuro y pulsar **Devolver para correcciones**. La fecha predeterminada es dentro de siete días, en la zona horaria del equipo. El alumno debe estar activo y pertenecer al grupo; si la actividad está cerrada, reabrirla primero.
5. La devolución conserva el código del alumno y permite editarlo hasta su plazo individual, incluso si el plazo original del grupo venció. No cambia el plazo de los demás alumnos.
6. El alumno recarga o vuelve a abrir la actividad, lee los comentarios, corrige, guarda y pulsa **Entregar actividad** de nuevo. Si tenía una pestaña anterior, la revisión impide que esa pestaña sobrescriba el trabajo por accidente.
7. La nota anterior se muestra como provisional durante las correcciones y después de volver a entregar, hasta que el profesor guarde una nueva revisión.

El **Historial de revisiones** conserva cada revisión docente, los comentarios, la nota y una copia del código entregado. **Ver código de esta revisión** abre esa copia en solo lectura; **Volver a la respuesta actual** recupera el código más reciente. No se crea una copia histórica con cada autoguardado, ni se guardan salidas de consola. Un conflicto entre dos revisiones del profesor se rechaza; usar **Recargar entrega** para consultar la versión vigente antes de revisar otra vez.

## Conflictos y recuperación

Cada respuesta tiene una revisión. Si dos pestañas intentan guardar una misma revisión, el segundo guardado se rechaza sin sobrescribir el primero. Se conserva la copia local y se detiene la sincronización automática. **Recargar versión guardada** pide confirmación antes de descartar esa copia local y cargar la del servidor.

El borrador local se separa por cuenta y asignación. Al volver a abrir una respuesta con cambios pendientes se recupera cuando su revisión coincide con la del servidor. Si la respuesta ya está entregada o cerrada, se muestra únicamente la copia del servidor en modo de solo lectura; el borrador pendiente se conserva localmente para una posible reapertura. Los cambios de borrador del profesor también usan revisiones para evitar sobrescrituras entre pestañas.

## Límites y comprobación

- Hasta 100 celdas por notebook; 30 ejercicios por actividad; 20 archivos por ejercicio; 500 KB de contenido por plantilla o respuesta.
- Las importaciones `.ipynb` se revisan hasta 2 MB, pero deben reducirse al límite de la actividad al guardarse. No se guardan adjuntos ni salidas importadas; los metadatos se reducen a los necesarios para los bloqueos.
- El guardado no registra cada pulsación como una versión nueva: mantiene la última respuesta y fija el contenido al entregar. Todavía no hay historial de todas las revisiones.
- El programa Python tiene límites de tiempo y salida. La preparación de Python y Matplotlib necesita internet inicialmente.
- Las sesiones continúan en memoria del backend local. Falta el despliegue gratuito, el modo instalable PWA y la sincronización de sesiones para un backend distribuido.

Las pruebas `activities*` ejecutan el modelo de permisos, el flujo de interfaz y API, y la migración con PostgreSQL embebido. La prueba `runner.test.mjs` conecta el código real de la consola al motor Python real en Node: verifica el origen de mensajes, variables, `input()`, gráficas y archivos. Estas pruebas no sustituyen una comprobación visual en navegador del aislamiento entre los dos orígenes; el permiso guardado del navegador ha impedido esa verificación en esta sesión.


## Proyecto compartido y eliminación de asignaciones (24 de octubre de 2026)

Las actividades de archivos usan un solo proyecto (`content.project` en plantillas y
`answer.project` en respuestas). Los ejercicios contienen títulos e instrucciones;
cambiar de ejercicio conserva los archivos y la pestaña visible. El alumno puede
seleccionar el archivo principal o ejecutar directamente el archivo que está viendo.
Las plantillas anteriores siguen abriendo y se convierten al guardar en el editor.

El editor y el seguimiento de avances se muestran en vistas separadas del catálogo,
con un botón para volver. El catálogo docente incluye **Eliminar asignación**.
La confirmación explica que se borran los avances, entregas y revisiones de ese grupo;
la actividad/plantilla registrada permanece disponible para futuras asignaciones.

Antes de publicar esta versión, aplicar en Supabase, después de las migraciones
anteriores, `supabase/migrations/202610240001_assignment_delete.sql`.
Esta migración configura el borrado en cascada; no borra registros al ejecutarla.
La API comprueba que la asignación pertenece al profesor autenticado. Las escrituras
directas de alumnos y profesores continúan bloqueadas por los permisos existentes.


## Extender la fecha límite de una asignación

En **Actividades y avances**, cada asignación con vencimiento tiene el botón
**Extender fecha límite**. El profesor elige una fecha futura y posterior al plazo
actual y pulsa **Guardar nueva fecha**. Si no había vencimiento, aparece
**Establecer fecha límite**. La fecha se introduce en la zona horaria del equipo.

La ampliación se aplica solo a esa asignación del grupo, conserva el código,
las entregas, las revisiones y la plantilla publicada, y permite continuar una
actividad que solo estaba bloqueada por vencimiento. Un cierre manual permanece
cerrado hasta usar **Reabrir actividad**. Los plazos individuales de corrección
se conservan; las entregas realizadas continúan en modo de solo lectura.
Los alumnos reciben la fecha actualizada al recargar o volver a abrir con conexión.

La API comprueba al profesor propietario, exige una ampliación válida y evita
sobrescribir cambios simultáneos del plazo. Usa la columna `due_at` existente;
no requiere migración SQL.
