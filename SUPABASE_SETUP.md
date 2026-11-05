# Preparar Supabase

1. Abrir https://supabase.com/dashboard y elegir **New project**.
2. Seleccionar una organización del plan **Free**; si no existe, crearla con ese plan.
3. Nombrar el proyecto `aula-python`.
4. Generar una contraseña para la base de datos y guardarla en un gestor de contraseñas. No es la contraseña de los alumnos y no se debe enviar por chat.
5. Seleccionar una región cercana a los alumnos y crear el proyecto. Esperar a que termine la preparación.
6. En el diálogo **Connect**, localizar la URL del proyecto. En **Settings → API Keys**, localizar la clave **Publishable**. La clave **Secret** se utilizará exclusivamente en el servidor del futuro módulo de administración.
7. Copiar `.env.example` como `.env` en esta carpeta. Reemplazar los valores de ejemplo directamente en el editor local; no pegarlos en el chat. `.env` está excluido de Git y fuera de `dist/`, que es la única carpeta publicada por el servidor local.

## Crear las tablas

8. En el panel de Supabase, abrir **SQL Editor → New query**.
9. Abrir `supabase/migrations/202610170001_accounts.sql` en este proyecto, copiar todo su contenido al editor SQL y pulsar **Run**. Ejecutar una sola vez sobre el proyecto nuevo. El script crea las tablas, el aprovisionamiento de perfiles y los permisos RLS dentro de una transacción.

La migración se verifica en PostgreSQL de prueba. No se ha ejecutado en tu proyecto real: esa operación queda pendiente hasta este paso.

## Crear tu cuenta de profesor

Antes de crear la cuenta, comprobar la conexión sin modificar datos:

```powershell
npm run supabase:check
```

Debe confirmar que las tres tablas están disponibles. Nunca imprime las claves.

10. En una terminal situada en `E:\ws\ActividadesPython`, ejecutar:

```powershell
npm run teacher:init
```

Introducir tu nombre, correo y una contraseña propia de al menos 12 caracteres. La contraseña no se muestra en la terminal ni se guarda en un archivo local. Esta cuenta es distinta de tu cuenta del panel Supabase y de la contraseña de PostgreSQL.

El script crea una cuenta confirmada y su perfil de profesor con el cliente administrativo de Supabase. No envía invitaciones por correo. Si la cuenta ya existe, el script falla sin cambiar su contraseña: no lo uses para recuperar contraseñas.

Si olvidaste la contraseña del profesor, ejecuta `npm run teacher:reset` en una terminal local. Introduce el correo de la cuenta y una nueva contraseña de 12 a 128 caracteres dos veces. La contraseña no se muestra ni se guarda en archivos. Solo permite restablecer profesores activos; conserva su cuenta, alumnos, grupos y actividades. Al terminar, reinicia `npm run accounts` para cerrar las sesiones anteriores. No compartas contraseñas ni claves de Supabase por chat.

### Reparar «Falta el perfil» en instalaciones anteriores

La primera versión del disparador solo escuchaba inserciones. Supabase Auth puede insertar la cuenta antes de escribir `app_metadata`; por ello podía existir la cuenta sin el perfil del aula.

Si ya ejecutaste la migración inicial anterior, ejecuta **solo** `supabase/migrations/202610170002_profile_trigger_fix.sql` en SQL Editor. Se puede repetir: corrige el disparador y recupera perfiles pendientes de profesor sin borrar cuentas ni cambiar contraseñas o perfiles existentes. No vuelvas a ejecutar la migración inicial sobre tablas ya creadas.

Para recuperar un profesor pendiente directamente desde esta carpeta:

```powershell
npm run teacher:repair -- --check
npm run teacher:repair
```

El primer comando solo cuenta perfiles faltantes. El segundo completa los perfiles de profesor identificados por sus metadatos administrativos; no utiliza los metadatos editables del usuario y no reactiva cuentas desactivadas. Los nuevos registros también incluyen un respaldo en el backend para instalaciones con el disparador anterior. Después de actualizar código, reinicia `npm run accounts` para cargarlo.

## Iniciar alumnos y grupos

11. Ejecutar en otra terminal:

```powershell
npm run accounts
```

12. Abrir **http://127.0.0.1:4180**, iniciar sesión con tu correo de profesor y crear un grupo. Después puedes registrar alumnos individualmente o importar el CSV de ejemplo descargable desde la interfaz. Guarda el CSV de claves generadas antes de cerrar su ventana.

Para probar como alumno, cerrar la sesión de profesor y entrar con el número de control y la clave temporal. El servidor solo permitirá consultar el perfil, cambiar la contraseña o cerrar sesión hasta completar el cambio obligatorio. Se recomienda un perfil de navegador separado para probar ambos roles sin cerrar la sesión del profesor.

Los alumnos usan internamente una identidad con correo sintético bajo `alumnos.aula.invalid`; no necesitan correo real y la aplicación no envía mensajes a esas direcciones. Los números de control se normalizan a mayúsculas, conservando ceros iniciales, y son únicos en el proyecto.

### Si aparece un problema

- **Falta configurar .env:** copiar `.env.example` a `.env`, completar las tres variables y reiniciar `npm run accounts`.
- **Faltan tablas o no se pudo crear el profesor:** ejecutar primero el SQL del paso 9 y comprobar que el proyecto está activo.
- **Proyecto URL:** se obtiene en **Connect** y suele ser `https://<identificador>.supabase.co`; no usar la URL del panel ni la conexión `postgresql://`.
- **API keys:** usar **Publishable** (`sb_publishable_...`) y **Secret** (`sb_secret_...`), no la contraseña de PostgreSQL. No compartirlas por chat.
- **El puerto está ocupado:** cerrar únicamente la terminal anterior de este módulo o configurar `ACCOUNTS_PORT` en `.env`. Si cambias el puerto, utiliza esa misma dirección en el navegador.

## Límites de esta fase

El módulo de cuentas es un backend Node local separado del prototipo de notebooks, que continúa en el puerto 4173. Las cookies son HttpOnly y las peticiones a la API se comprueban por origen; el código Python no comparte el origen del módulo de cuentas. No alojar el intérprete en el origen 4180 ni añadir el laboratorio a la lista de orígenes permitidos.

El servidor solo escucha en la interfaz local. Las sesiones duran ocho horas y están en memoria: reiniciar cierra las sesiones, pero no borra los alumnos y grupos guardados en Supabase. Las claves temporales solo se devuelven al crearlas o restablecerlas, no se almacenan en texto legible. Restablecer una clave o desactivar una cuenta invalida sus sesiones de esta aplicación.

Las cuentas ya se pueden vincular con actividades, entregas y avances siguiendo **ACTIVIDADES_SETUP.md** y ejecutando la migración adicional de actividades. La interfaz del puerto 4180 utiliza el ejecutor aislado del puerto 4173. El laboratorio antiguo del puerto 4173 conserva su selector de vista de prueba y no expone cuentas ni respuestas. Cloudflare Pages por sí solo no ejecuta este servidor Node; el backend deberá adaptarse a un servicio de ejecución antes de alojar el conjunto.

Documentación oficial:

- https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- https://supabase.com/docs/guides/getting-started/api-keys

## Registro independiente e integrantes de grupos

La creación individual y la importación CSV registran cuentas sin grupo. Los grupos existentes y sus integrantes se conservan. Desde **Alumnos y grupos → Integrantes del grupo**, selecciona el grupo y usa **Añadir al grupo** para cada alumno registrado; puede pertenecer a varios grupos del mismo profesor.

Aplica `supabase/migrations/202611040002_group_membership_cleanup.sql` después de las migraciones de actividades y plazos individuales. Esta migración no borra alumnos, pertenencias ni trabajos existentes. Al confirmar **Quitar del grupo**, la aplicación elimina de forma atómica sus avances y entregas de las asignaciones de ese grupo, junto con revisiones y plazos individuales. Conserva su cuenta, sus otros grupos, los trabajos de sus compañeros, las asignaciones y las plantillas del profesor. La acción no se puede deshacer; si lo vuelves a añadir, empieza sin esos trabajos.

Las inscripciones nuevas tienen una versión que vincula sus borradores al grupo. Los guardados del servidor bloquean la pertenencia durante la operación y rechazan versiones anteriores, incluso tras volver a añadir al alumno. Al conectar, se retiran las copias de actividades que ya no están disponibles. Un equipo desconectado puede conservar temporalmente su copia, pero no puede restaurar automáticamente los trabajos eliminados al sincronizar. Las pertenencias anteriores a la migración mantienen válidos sus borradores y guardados pendientes.
