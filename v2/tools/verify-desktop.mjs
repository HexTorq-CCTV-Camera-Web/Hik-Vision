import path from 'node:path';
import { Vault } from '../lib/vault.mjs';
import { Accounts } from '../lib/accounts.mjs';
import { createHikClient } from '../lib/hik-connect.mjs';
import { installedDesktopToken, validateSdkAccess, DesktopSdkError } from '../lib/desktop-sdk.mjs';

try {
  const directory = process.env.HIK_PRODUCT_DATA_DIR || path.join(process.env.LOCALAPPDATA, 'HikvisionCameraProductV2');
  const accounts = await Accounts.open(new Vault(directory));
  const provider = accounts.provider();
  if (!provider?.sessionId) throw new DesktopSdkError('Connect the account in Windows v2 first.');
  const sharing = await createHikClient().sharing(provider);
  const device = sharing.devices?.find(device => device.serial && device.channels?.length);
  if (!device) throw new DesktopSdkError('No shared channel is available to verify.');
  await validateSdkAccess(await installedDesktopToken(), device, device.channels[0].number);
  console.log(JSON.stringify({ state: 'verified', source: 'installed-client', readOnly: true, playbackStarted: false }));
} catch (error) {
  console.error(JSON.stringify({ state: 'blocked', message: error instanceof DesktopSdkError ? error.message : 'Could not verify the installed playback sign-in. Reconnect the account and check the installed SDK.' }));
  process.exitCode = 1;
}
