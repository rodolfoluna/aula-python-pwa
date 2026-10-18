import { createSupabaseStore } from '../accounts/supabase-store.mjs';
try {
  await createSupabaseStore().healthActivities();
  console.log('Conexión correcta: actividades, respuestas, calificaciones e historial de revisiones disponibles. No se modificaron datos.');
} catch {
  console.error('Falta configurar o actualizar Supabase. Consulta ACTIVIDADES_SETUP.md: la fase de calificaciones requiere 202610170004_reviews.sql después de la migración 003. No se modificaron datos.');
  process.exitCode = 1;
}
