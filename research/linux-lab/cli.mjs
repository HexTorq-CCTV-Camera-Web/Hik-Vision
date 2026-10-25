import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { PersonalClient, PortalError } from './lib/personal-client.mjs';

async function credentials() {
  if (process.argv.includes('--stdin')) {
    if (stdin.isTTY) throw new PortalError('--stdin requires a JSON input pipe.');
    let text = '';
    for await (const chunk of stdin) {
      text += chunk;
      if (text.length > 12000) throw new PortalError('Credential input exceeded its limit.');
    }
    try { return JSON.parse(text); } catch { throw new PortalError('Expected a JSON credential object on stdin.'); }
  }
  if (!stdin.isTTY) throw new PortalError('Use an interactive terminal or pipe credentials with --stdin.');
  let hidden = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!hidden) stdout.write(chunk, encoding); done(); } });
  const terminal = createInterface({ input: stdin, output, terminal: true });
  try {
    const account = await terminal.question('Hik-Connect account: ');
    stdout.write('Password (hidden): '); hidden = true;
    const password = await terminal.question('');
    hidden = false; stdout.write('\n');
    return { account, password };
  } finally { hidden = false; terminal.close(); }
}

let client;
try {
  client = new PersonalClient({ origin: process.env.HIK_LAB_ORIGIN,
    featureCode: process.env.HIK_LAB_FEATURE_CODE });
  const command = process.argv[2];
  if (command === 'probe') {
    const key = await client.publicKey();
    console.log(JSON.stringify({ state: 'public-key-reachable', origin: client.origin,
      keyType: key.asymmetricKeyType, keyBits: key.asymmetricKeyDetails.modulusLength,
      platform: process.platform, chromeRequired: false, windowsSdkRequired: false }));
  } else if (command === 'login') {
    const input = await credentials();
    let result;
    try { result = await client.login(input); }
    finally { if (input && typeof input === 'object') { delete input.password; delete input.imageCode; } }
    console.log(JSON.stringify(result));
    if (result.state === 'signed-in') console.log(JSON.stringify(await client.sharedSummary()));
    else process.exitCode = 2;
  } else throw new PortalError('Usage: node cli.mjs probe | login [--stdin]');
} catch (error) {
  console.error(JSON.stringify(error instanceof PortalError
    ? { state: 'blocked', message: error.message, code: error.code, status: error.status }
    : { state: 'blocked', message: 'The experiment failed; no raw response or credential was logged.' }));
  process.exitCode = 1;
} finally { client?.close(); }
