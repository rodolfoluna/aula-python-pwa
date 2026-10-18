import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { createSupabaseStore } from '../accounts/supabase-store.mjs';
import { validatePassword } from '../accounts/service.mjs';

let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: stdin, output, terminal: !!stdin.isTTY });
try {
  const store = createSupabaseStore();
  await store.health();
  const name = (await rl.question('Nombre del profesor: ')).trim();
  const email = (await rl.question('Correo del profesor: ')).trim().toLowerCase();
  if (!name || name.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Nombre o correo inválidos.');
  stdout.write('Contraseña (mínimo 12 caracteres; no se muestra): '); muted = true;
  const password = await rl.question(''); muted = false; stdout.write('\n');
  validatePassword(password);
  stdout.write('Repite la contraseña: '); muted = true;
  const repeated = await rl.question(''); muted = false; stdout.write('\n');
  if (password !== repeated) throw new Error('Las contraseñas no coinciden.');
  await store.createUser({ email, password, role: 'teacher', name });
  stdout.write('Profesor creado. Ya puedes iniciar sesión en http://127.0.0.1:4180 con tu correo.\n');
} catch (error) {
  muted = false;
  // No imprimir objetos del SDK que pudieran incluir solicitudes o claves.
  stdout.write('\nNo se pudo crear el profesor. ' + error.message + '\n');
  stdout.write('Si la cuenta ya se creó pero falta su perfil, ejecuta npm run teacher:repair. No vuelvas a crearla ni cambies su contraseña.\n');
  process.exitCode = 1;
} finally { rl.close(); }
