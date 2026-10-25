// Private transport helper: stdout is a credential-bearing pipe, never a log.
// Reads the current Windows grant; it does not modify the vault or sign in again.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Vault } from '../../windows-v2/lib/vault.mjs';
import { createHikClient } from '../../windows-v2/lib/hik-connect.mjs';

try {
  if (process.stdout.isTTY) throw new Error('Use a private transport pipe, not terminal output.');
  const sdk = process.env.HIK_SDK_DIRECTORY || 'C:\\Program Files (x86)\\iVMS-4200 Site\\iVMS-4200 Client\\Client';
  const bytes = await readFile(path.join(sdk, 'log/opensdk/opensdk.log'));
  const matches = [...bytes.subarray(-8_000_000).toString('utf8').matchAll(/\bszAppId\s*=\s*([a-fA-F0-9]{32})\b/g)];
  const appId = matches.at(-1)?.[1];
  if (!appId) throw new Error('No installed SDK identity.');
  if (process.argv.includes('--identity-only')) {
    process.stdout.write(JSON.stringify({ appId }) + '\n');
  } else {
    const directory = process.env.HIK_PRODUCT_DATA_DIR || path.join(process.env.LOCALAPPDATA, 'HikvisionCameraProductV2');
    const vault = await new Vault(directory).open();
    const provider = (await vault.load())?.provider;
    if (!provider?.sessionId || !provider.sdkAccessToken) throw new Error('Saved authorization unavailable.');
    const hik = createHikClient();
    const results = await Promise.allSettled([hik.devices(provider), hik.sharing(provider)]);
    const devices = results.flatMap(result => result.status === 'fulfilled' ? Array.isArray(result.value) ? result.value : result.value.devices || [] : []);
    const requested = process.env.HIK_TEST_DEVICE_NAME;
    const device = requested ? devices.find(device => device.name === requested && device.channels?.length) : devices.find(device => device.status === 'online' && device.channels?.length) || devices.find(device => device.channels?.length);
    if (!device?.serial) throw new Error('No authorized camera found.');
    process.stdout.write(JSON.stringify({ appId, accessToken: provider.sdkAccessToken,
      sdkDirectory: 'Z:\\work\\sdk', serial: device.serial, channel: device.channels[0].number,
      play: true, decode: false, stream: false, streamType: 2,
      captureFile: 'Z:\\work\\runtime\\capture', deviceName: device.name, deviceOnline: device.status === 'online' }) + '\n');
  }
} catch {
  console.error('Test input unavailable. Check the installed SDK identity and saved account authorization.');
  process.exitCode = 1;
}
