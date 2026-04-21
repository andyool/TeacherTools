import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const certName =
  getArg('--name') || process.env.TEACHERTOOLS_MAC_SELF_SIGN_IDENTITY || 'TeacherTools Overlay Self Signed';
const outDir = path.resolve(getArg('--out-dir') || '.certs');
const days = Number.parseInt(getArg('--days') || '3650', 10);
const password =
  getArg('--password') ||
  process.env.TEACHERTOOLS_MAC_SELF_SIGN_CERT_PASSWORD ||
  randomBytes(24).toString('base64url');

if (!Number.isFinite(days) || days < 1) {
  throw new Error('--days must be a positive number.');
}

const fileBase = slugify(certName);
const certPemPath = path.join(outDir, `${fileBase}.pem`);
const certCerPath = path.join(outDir, `${fileBase}.cer`);
const p12Path = path.join(outDir, `${fileBase}.p12`);
const p12Base64Path = path.join(outDir, `${fileBase}.p12.base64.txt`);
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teachertools-self-sign-'));
const keyPath = path.join(tempDir, 'certificate-key.pem');
const configPath = path.join(tempDir, 'openssl.cnf');

await fs.mkdir(outDir, { recursive: true });

await fs.writeFile(
  configPath,
  [
    '[req]',
    'distinguished_name = dn',
    'prompt = no',
    'x509_extensions = v3_req',
    '',
    '[dn]',
    `CN = ${certName}`,
    '',
    '[v3_req]',
    'basicConstraints = critical, CA:true',
    'keyUsage = critical, digitalSignature',
    'extendedKeyUsage = codeSigning',
    'subjectKeyIdentifier = hash',
    ''
  ].join('\n')
);

try {
  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-days',
    String(days),
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPemPath,
    '-config',
    configPath
  ]);

  await execFileAsync('openssl', ['x509', '-in', certPemPath, '-outform', 'der', '-out', certCerPath]);

  await execFileAsync('openssl', [
    'pkcs12',
    '-export',
    '-inkey',
    keyPath,
    '-in',
    certPemPath,
    '-name',
    certName,
    '-out',
    p12Path,
    '-passout',
    `pass:${password}`
  ]);

  const p12Base64 = await fs.readFile(p12Path, 'base64');
  await fs.writeFile(p12Base64Path, `${p12Base64}\n`);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log(`Created self-signed macOS code-signing identity: ${certName}`);
console.log(`Public certificate: ${certCerPath}`);
console.log(`Signing certificate bundle: ${p12Path}`);
console.log(`Signing certificate base64: ${p12Base64Path}`);
console.log('');
console.log('Use these GitHub Actions secrets:');
console.log(`TEACHERTOOLS_MAC_SELF_SIGN_IDENTITY=${certName}`);
console.log(`TEACHERTOOLS_MAC_SELF_SIGN_CERT_PASSWORD=${password}`);
console.log(`TEACHERTOOLS_MAC_SELF_SIGN_CERT_BASE64=<contents of ${p12Base64Path}>`);
