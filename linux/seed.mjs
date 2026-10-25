// One-time private import over SSH stdin. Never print account material.
import { Vault } from './lib/vault.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
let input = ''; for await (const part of process.stdin) input += part;
const { state, appId } = JSON.parse(input); input = '';
if (!state?.owner?.hash || !state.provider?.sessionId || !state.provider.sdkAccessToken || !/^[a-fA-F0-9]{32}$/.test(appId)) throw new Error('Incomplete private import');
const directory = '/home/mohan/cam/data'; await mkdir(directory, { recursive:true, mode:0o700 });
const vault = await new Vault(directory).open(); const current = await vault.load();
const next = current || { version:1, owner:state.owner, sessions:[], preferences:state.preferences || {} };
next.provider = state.provider; await vault.save(next);
await writeFile('/home/mohan/cam/config/receiver.env', `HIK_SDK_APP_ID=${appId}\nHIK_SDK_DIRECTORY=Z:\\work\\sdk\n`, { mode:0o600 });
console.log(JSON.stringify({imported:true,ownerPreserved:Boolean(current),providerConnected:true}));
