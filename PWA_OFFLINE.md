# Instalar y trabajar sin conexión

La aplicación de cuentas y actividades en https://aula-python.onrender.com/ ya incluye instalación y preparación sin conexión. No requiere otra migración SQL; conserva la migración 005 del guardado eficiente.

## Preparar cada dispositivo

1. Abre la app con Internet. Usa Chrome o Edge actualizado en computadora o Android; en iPhone/iPad usa Safari. La compatibilidad de la consola aislada depende del navegador.
2. Pulsa **Instalar app** y acepta la instalación en el navegador. Si no aparece el aviso automático, usa el menú **Instalar** o **Añadir a pantalla de inicio**; en Safari está en Compartir.
3. Entra como **alumno**, cambia la contraseña temporal si corresponde y pulsa **Preparar sin conexión** en su equipo personal.
4. Mantén la app abierta hasta que confirme la preparación completa de actividades, Python y Matplotlib. La primera descarga incluye 18 archivos; requiere espacio libre y puede tardar. Si se interrumpe, reintenta: se reutilizan los archivos completos.
5. No cierres sesión antes de trabajar sin conexión: cerrar sesión retira el acceso a las actividades preparadas. Puedes cerrar la ventana y volver a abrir la app.
6. Repite la preparación cuando el profesor asigne actividades nuevas. Instalar la app por sí solo no descarga las actividades ni Python.

El profesor puede instalar la app. La administración, los avances de otros alumnos, las revisiones y las calificaciones requieren conexión.

## Trabajar y sincronizar

Con lo preparado puedes volver a abrir la app, consultar enunciados, editar notebooks y ejercicios de varios archivos, ejecutar Python con variables compartidas, `input()` y gráficas de Matplotlib. No están disponibles paquetes adicionales, servicios ni archivos remotos que no se hayan preparado.

El código se conserva en el dispositivo al editar. **Guardar ahora** sin Internet confirma únicamente la copia local. El indicador muestra las actividades pendientes; **Guardado en Supabase** y **Entrega confirmada por el servidor** son confirmaciones distintas.

Al recuperar Internet con la app abierta se sincronizan también los avances de actividades que ya cerraste en el editor. Si cerraste la app, vuelve a abrirla para sincronizar. Hay un botón **Sincronizar pendientes** y reintentos mientras la app permanece abierta; no se promete sincronización en segundo plano con la app cerrada. Si Render reinició o venció la sesión, inicia sesión de nuevo con la misma cuenta.

**Entregar actividad requiere Internet.** El servidor comprueba la pertenencia al grupo, el alumno, la revisión, los bloqueos y la fecha límite en cada guardado. Si el profesor cerró la actividad o hay cambios de otra sesión, se conserva la copia local y se avisa. Abrir la actividad permite consultar esa copia pendiente; cargar la versión del servidor exige conexión y una confirmación explícita para descartarla. No se fusionan cambios incompatibles automáticamente.

## Velocidad de ejecución

Python se ejecuta en el dispositivo, no en Render. La primera ejecución necesita
iniciar el motor; las siguientes reutilizan el motor de la actividad abierta.
Matplotlib se carga cuando el código o un archivo del proyecto lo utiliza, por lo
que un ejercicio de `print()` o `input()` no espera la preparación de gráficas.
La primera gráfica puede tardar más, incluso sin conexión: leer los archivos ya
descargados y cargar la biblioteca en memoria sigue requiriendo trabajo local.

La preparación sin conexión sigue descargando Python, Matplotlib y todas sus
dependencias. Solo se confirma la preparación completa después de terminar esa
descarga. Instalar y preparar son pasos distintos.

## Datos locales y actualizaciones

La preparación es voluntaria: usa un dispositivo personal. IndexedDB guarda exclusivamente el perfil y las actividades del alumno preparado; no guarda contraseñas, claves de Supabase ni sesiones del servidor. El service worker conserva solo la interfaz pública; nunca las rutas `/api/`. Python se conserva en el origen separado de la consola, con comprobación SHA-256 y sin enviar credenciales al CDN.

Cerrar sesión elimina el acceso offline y sus actividades preparadas de IndexedDB. Los avances aún pendientes permanecen ligados al alumno en el dispositivo para recuperarlos al volver a entrar con la misma cuenta. Si sales sin conexión, el cierre de la sesión del servidor se completa cuando vuelve Internet y se hace la siguiente solicitud de la app.

Evita navegación privada y borrar datos del sitio mientras haya pendientes. El navegador puede eliminar almacenamiento por falta de espacio; la app solicita persistencia, pero depende de la decisión del navegador. Comprueba la confirmación de sincronización antes de cambiar de equipo. Una copia local no sustituye la entrega al profesor.

Las actualizaciones de la interfaz esperan a que cierres las ventanas anteriores, sin recargar el código que estás editando. Cuando haya una nueva versión aparece **Actualizar app**. El botón comprueba los cambios pendientes antes de activar la actualización y recargar. También puedes sincronizar, cerrar todas las ventanas de Aula Python y volver a abrirla. Las copias locales y las actividades preparadas se conservan.

## Desarrollo y pruebas

`npm run accounts` y `npm run start:production` generan automáticamente iconos y el manifiesto versionado de archivos públicos. `npm run build:pwa` hace solo esa compilación. `npm run build:runner` prepara la consola estática y versiona su caché. `node scripts/prepare-runtime.mjs` regenera el inventario fijado de Python desde la dependencia de desarrollo Pyodide 0.27.7; se debe revisar y confirmar antes de cambiar versiones.

`npm test` incluye IndexedDB, reinicio offline del DOM, conservación al salir, aislamiento entre alumnos, sincronización de varias actividades, conflictos, recibos perdidos y comprobación de integridad del runtime, además de las pruebas de cuentas, PostgreSQL y Python real. Las pruebas incluyen además reinicio del motor real con acceso de red bloqueado, archivos auxiliares, input y PNG. La instalación del sistema y una desconexión física deben comprobarse en el navegador de destino.
