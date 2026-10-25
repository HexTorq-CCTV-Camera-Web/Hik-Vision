// Offline operator tool: run only while the viewer is stopped; stdout is private.
import { randomBytes } from 'node:crypto';
import { Vault } from './lib/vault.mjs';
import { sessionHash } from './lib/accounts.mjs';
if (process.stdout.isTTY) throw new Error('Use a private pipe.');
const vault = await new Vault('/home/mohan/cam/data').open();
const state = await vault.load();
if (!state?.owner) throw new Error('No owner exists.');
const token = randomBytes(32).toString('hex');
state.sessions = state.sessions.filter(session => session.expires > Date.now());
state.sessions.push({ hash: sessionHash(token), expires: Date.now() + 30 * 60000 });
await vault.save(state);
process.stdout.write(token);
