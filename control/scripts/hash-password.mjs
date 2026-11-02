// Prints one HPC_USERS entry. The password is read from stdin so it does not land in shell history.
//   printf '%s' 'the-password' | node scripts/hash-password.mjs viewer
import { hashPassword } from '../lib/auth.mjs';

const name = process.argv[2];
if (!/^[a-z0-9_.-]{1,40}$/.test(name || '')) {
  console.error('usage: printf %s PASSWORD | node scripts/hash-password.mjs <name>');
  process.exit(2);
}
let pw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) pw += chunk;
pw = pw.replace(/\r?\n$/, '');
if (pw.length < 12) {
  console.error('password must be at least 12 characters');
  process.exit(2);
}
console.log(`${name}:${hashPassword(pw)}`);
