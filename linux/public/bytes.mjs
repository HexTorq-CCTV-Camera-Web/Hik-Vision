export function decodeBase64(value) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(value);
  const raw = atob(value), bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
