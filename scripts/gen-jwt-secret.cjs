#!/usr/bin/env node
/**
 * Generates a cryptographically random JWT_SECRET (48 bytes → 64 base64 chars).
 * Just prints it — copy-paste into .env.
 *
 * Usage:
 *   node scripts/gen-jwt-secret.cjs
 */

const crypto = require('node:crypto');
const secret = crypto.randomBytes(48).toString('base64');
console.log(secret);
