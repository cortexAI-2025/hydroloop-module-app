#!/usr/bin/env node
// Usage : npm run auth:hash -- "mon mot de passe"   → valeur à placer dans AUTH_USERS (nom:scrypt$sel$hash)
import { randomBytes, scryptSync } from 'node:crypto';

const pwd = process.argv[2];
if (!pwd) {
  console.error('Usage : npm run auth:hash -- "mot de passe"');
  process.exit(1);
}
const salt = randomBytes(16);
console.log(`scrypt$${salt.toString('hex')}$${scryptSync(pwd, salt, 32).toString('hex')}`);
