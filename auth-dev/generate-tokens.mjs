// Gera a chave pública e os tokens de TESTE. A chave privada existe só na memória deste processo
// e é descartada no fim: com a chave pública versionada ninguém consegue emitir tokens novos.
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ISSUER = 'corridas-auth-dev';
const AUDIENCE = 'corridas-api';
const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

const PEOPLE = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ sub: `passageiro-${n}`, role: 'passageiro' })),
  ...[1, 2].map((n) => ({ sub: `motorista-${n}`, role: 'motorista' })),
];

const folder = import.meta.dirname;
const now = Math.floor(Date.now() / 1000);

const toBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function signToken(claims, privateKey) {
  const content = `${toBase64Url({ alg: 'RS256', typ: 'JWT' })}.${toBase64Url(claims)}`;
  const signature = sign('sha256', Buffer.from(content), privateKey).toString('base64url');
  return `${content}.${signature}`;
}

const claimsFor = (person) => ({
  ...person,
  iss: ISSUER,
  aud: AUDIENCE,
  iat: now,
  exp: now + ONE_YEAR_IN_SECONDS,
});

const newKeyPair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const { publicKey, privateKey } = newKeyPair();

const tokens = Object.fromEntries(PEOPLE.map((p) => [p.sub, signToken(claimsFor(p), privateKey)]));
tokens['expired'] = signToken(
  { ...claimsFor(PEOPLE[0]), iat: now - 120, exp: now - 60 },
  privateKey,
);
tokens['other-key'] = signToken(claimsFor(PEOPLE[0]), newKeyPair().privateKey);

writeFileSync(join(folder, 'public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
mkdirSync(join(folder, 'tokens'), { recursive: true });
for (const [name, token] of Object.entries(tokens)) {
  writeFileSync(join(folder, 'tokens', `${name}.jwt`), `${token}\n`);
}

console.log(`${Object.keys(tokens).length} tokens de teste e a chave pública gerados em ${folder}`);
