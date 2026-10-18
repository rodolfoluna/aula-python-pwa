# Publicar Aula Python en Render gratuito

Se conserva el proyecto de Supabase y sus cuentas, grupos, actividades y respuestas. Render alojará dos servicios con dominios HTTPS distintos:

- **aula-python**: servidor Node y pantalla de acceso, plan **Free**. Solo este servicio recibe las variables privadas de Supabase.
- **aula-python-consola**: sitio estático de ejecución Python, gratuito. No recibe claves, cuentas ni acceso a la base de datos. Python y Matplotlib se ejecutan en el equipo del alumno.

## Repositorio y Blueprint

1. El código debe estar en un repositorio privado de GitHub. No subir `.env`, claves, CSV de accesos, `node_modules`, capturas ni archivos del profesor o de alumnos.
2. Crear una cuenta gratuita de Render, aceptar sus términos e iniciar sesión.
3. Conectar a Render solamente el repositorio de Aula Python.
4. En **New → Blueprint**, seleccionar el repositorio y la rama `main`. Render leerá `render.yaml`.
5. Confirmar que se crean un sitio estático y un servidor **Free**, sin base de datos de Render ni discos de pago.
6. Introducir `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` desde la configuración privada de Supabase. Solo se guardan como variables del servidor, nunca en GitHub ni en la consola estática.
7. Iniciar el despliegue. El Blueprint enlaza automáticamente la consola mediante `RUNNER_HOSTNAME`; Render proporciona `RENDER_EXTERNAL_URL` para validar las peticiones del aula.

La aceptación de términos, las contraseñas de cuentas externas y permisos nuevos del proveedor Git se completan desde el navegador por su titular. No hace falta compartir claves en el chat.

## Comprobar y compartir

- Esperar a que ambos servicios indiquen **Live**.
- Abrir la URL HTTPS del servicio **aula-python**, iniciar sesión como profesor y revisar grupos y actividades.
- Probar con PRUEBA001: abrir el notebook, ejecutar las celdas, completar `input()`, generar la gráfica, guardar y volver a entrar para confirmar la respuesta.
- La consola debe indicar aislamiento habilitado. Las cabeceras COOP/COEP y el permiso `cross-origin-isolated` son necesarios; no alojar Python en el mismo origen que el acceso de las cuentas.
- Compartir únicamente la URL HTTPS del aula con los alumnos. Cada alumno usa su número de control y contraseña. No compartir el panel de Render, Supabase ni las claves administrativas.
- Para comprobar un alojamiento existente: `/healthz` devuelve `{"ok":true}` cuando el servidor tiene su configuración, sin consultar ni mostrar datos de alumnos. No sustituye la prueba funcional con una cuenta.

## Límites prácticos del plan gratuito

Según [Render](https://render.com/docs/free), el servidor se suspende después de 15 minutos sin tráfico y puede tardar alrededor de un minuto en despertar. Abrir el aula antes de clase. La cuota de horas gratuitas se comparte por espacio de trabajo; un sitio estático no consume horas de servidor.

Las sesiones del aula duran hasta ocho horas y están en memoria del servidor: una suspensión o reinicio puede exigir iniciar sesión otra vez. El código ya sincronizado permanece en Supabase; los cambios pendientes se conservan localmente en ese navegador y se recuperan al reabrir con la misma cuenta y revisión. No limpiar el almacenamiento del navegador si hay trabajo pendiente.

El plan gratuito tiene cuotas de transferencia y compilación. Sin método de pago, Render puede suspender el servicio al agotar las cuotas; si se añade una tarjeta, revisar los cargos por excesos. No se garantiza capacidad ni disponibilidad de producción. Revisar el consumo real durante una clase de 40 alumnos antes de depender del servicio para evaluaciones.

Supabase mantiene sus cuotas y condiciones gratuitas por separado. Los cambios de código se guardan cada 30 segundos solo si hubo modificaciones; las revisiones históricas se crean al revisar una entrega, no con cada autoguardado. Los paquetes grandes de Python se descargan desde el CDN de Pyodide, sin pasar por el servidor de cuentas.

## Actualizaciones

Después de probar un cambio, subirlo a la rama de despliegue del repositorio. Render recompila los servicios. No volver a ejecutar migraciones SQL ya instaladas; aplicar únicamente las nuevas cuando una actualización lo requiera. El despliegue no crea otra cuenta de profesor ni modifica sus contraseñas.

Para otro proveedor Node: configurar `NODE_ENV=production`, `PORT`, `APP_ORIGIN`, `RUNNER_ORIGIN` y las tres variables de Supabase. El servidor escucha en `0.0.0.0` en producción, usa cookies `Secure` y rechaza orígenes que no coincidan con el aula. Las direcciones deben ser orígenes HTTPS completos y distintos, sin rutas.
