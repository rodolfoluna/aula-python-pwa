import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { validatePassword } from '../accounts/service.mjs';

// Solo para el administrador local; nunca publicar este script en el cliente.
if (!stdin.isTTY) {
  console.error('Ejecuta este comando directamente en una terminal interactiva.');
  process.exitCode = 1;
} else {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) stdout.write(chunk, encoding); callback(); } });
  const rl = createInterface({ input: stdin, output, terminal: true, historySize: 0 });
  try {
    const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret } = process.env;
    if (!url || !secret || new URL(url).protocol !== 'https:') throw new Error('Revisa la configuración de Supabase en .env.');
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const email = (await rl.question('Correo del profesor: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo inválido.');
    let teacher;
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw new Error('No se pudo consultar la cuenta en Supabase.');
      teacher = data.users.find(user => user.email?.toLowerCase() === email);
      if (teacher || data.users.length < 100) break;
    }
    if (!teacher) throw new Error('No se encontró esa cuenta.');
    const { data: profile, error } = await admin.from('aula_profiles').select('role,active').eq('id', teacher.id).single();
    if (error || profile?.role !== 'teacher' || !profile.active) throw new Error('La cuenta no es un profesor activo.');
    stdout.write('Nueva contraseña (12 a 128 caracteres; no se muestra): '); muted = true;
    const password = await rl.question(''); muted = false; stdout.write('\n');
    validatePassword(password);
    stdout.write('Repite la nueva contraseña: '); muted = true;
    const repeated = await rl.question(''); muted = false; stdout.write('\n');
    if (password !== repeated) throw new Error('Las contraseñas no coinciden.');
    const changed = await admin.auth.admin.updateUserById(teacher.id, { password });
    if (changed.error) throw new Error('Supabase rechazó la nueva contraseña. Intenta con otra que cumpla los requisitos.');
    stdout.write('Contraseña actualizada. Tus alumnos, grupos y actividades se conservaron.\n');
    stdout.write('Reinicia npm run accounts para cerrar las sesiones anteriores y entra con la nueva contraseña.\n');
  } catch (error) {
    muted = false;
    stdout.write('\n' + error.message + '\n');
    process.exitCode = 1;
  } finally { rl.close(); }
}
