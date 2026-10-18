import { createSupabaseStore } from '../accounts/supabase-store.mjs';
try {
  await createSupabaseStore().healthActivities();
  console.log('Conexión correcta: actividades, revisiones y guardado eficiente disponibles. No se modificaron datos.');
} catch {
  console.error('Falta configurar o actualizar Supabase. Consulta ACTIVIDADES_SETUP.md: el guardado eficiente requiere 202610170005_efficient_sync.sql después de las migraciones 003 y 004. No se modificaron datos.');
  process.exitCode = 1;
}
