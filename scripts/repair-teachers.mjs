import { createSupabaseStore } from '../accounts/supabase-store.mjs';
try {
  const store = createSupabaseStore();
  await store.health();
  const dryRun = process.argv.includes('--check');
  const { missing, repaired } = await store.repairTeacherProfiles({ dryRun });
  console.log(dryRun ? `Perfiles de profesor pendientes: ${missing}. No se modificaron datos.` : `Perfiles de profesor recuperados: ${repaired}. No se cambiaron contraseñas ni perfiles existentes.`);
} catch {
  console.error('No se pudo completar la revisión de perfiles. Revisa .env y las migraciones SQL; no se imprimieron claves ni datos de cuentas.');
  process.exitCode = 1;
}
