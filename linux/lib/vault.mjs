import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';

export class VaultError extends Error {}

export class Vault {
  constructor(directory, { protect = async bytes => Buffer.from(bytes) } = {}) { this.directory = path.resolve(directory); this.protect = protect; }
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const folder = await lstat(this.directory);
    if (folder.isSymbolicLink() || folder.uid !== process.getuid() || (folder.mode & 0o077)) throw new VaultError('The account directory must belong to this user with mode 700.');
    for (const name of ['key.local', 'accounts.vault']) {
      try { const info = await lstat(path.join(this.directory, name)); if (info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new VaultError('The account files must belong to this user with mode 600.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const keyPath = path.join(this.directory, 'key.local');
    let sealed;
    try { sealed = await readFile(keyPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new VaultError('Cannot read the protected account key.');
      // Never replace a missing key for an existing vault.
      try { await readFile(path.join(this.directory, 'accounts.vault')); throw new VaultError('The account-store key is missing. Restore the key and vault together.'); }
      catch (check) { if (check.code !== 'ENOENT') throw check; }
      sealed = await this.protect(randomBytes(32), 'protect');
      try { await writeFile(keyPath, sealed, { flag: 'wx', mode: 0o600 }); }
      catch (write) { if (write.code !== 'EEXIST') throw new VaultError('Cannot save the protected account key.'); sealed = await readFile(keyPath); }
    }
    this.key = await this.protect(sealed, 'unprotect');
    if (this.key.length !== 32) throw new VaultError('The account-store key is invalid.');
    return this;
  }
  async load() {
    let bytes;
    try { bytes = await readFile(path.join(this.directory, 'accounts.vault')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new VaultError('Cannot read the encrypted account store.'); }
    try {
      if (bytes.length > 2_000_000) throw new Error();
      const envelope = JSON.parse(bytes);
      if (envelope.version !== 1) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.nonce, 'base64'));
      decipher.setAAD(Buffer.from('hikvision-linux-pilot:accounts:1'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]));
    } catch { throw new VaultError('The encrypted account store could not be verified. It was not reset or overwritten.'); }
  }
  async save(state) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from('hikvision-linux-pilot:accounts:1'));
    const data = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
    const envelope = JSON.stringify({ version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    const temporary = path.join(this.directory, `accounts.${randomBytes(8).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, envelope, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path.join(this.directory, 'accounts.vault'));
    } catch { await unlink(temporary).catch(() => {}); throw new VaultError('Could not save account changes. Check storage permissions and free space.'); }
  }
}
