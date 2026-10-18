import { createSupabaseStore } from '../accounts/supabase-store.mjs';
try {
  await createSupabaseStore().health();
  console.log('Conexión correcta: las tres tablas de Aula Python están disponibles.');
} catch {
  console.error('No se pudo verificar Supabase. Revisa .env, ejecuta la migración SQL y confirma que el proyecto está activo. No se modificaron datos.');
  process.exitCode = 1;
}
