// Credential-bearing stdout: consume through a private SSH pipe only.
import { Vault } from './operator/windows-vault.mjs';
import path from 'node:path';
if (process.stdout.isTTY) throw new Error('Use a private transport pipe.');
const v = await new Vault(process.env.HIK_PRODUCT_DATA_DIR || path.join(process.env.LOCALAPPDATA, 'HikvisionCameraProductV2')).open();
const s = await v.load(); process.stdout.write(JSON.stringify({version:1,owner:s.owner,provider:s.provider,preferences:s.preferences || {}}));
