function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyKey(body, signature, timestamp, publicKey) {
  try {
    if (!signature || !timestamp || !publicKey) return false;
    const issuedAt = Number(timestamp);
    if (!Number.isFinite(issuedAt)) return false;
    if (Math.abs(Date.now() / 1000 - issuedAt) > 5 * 60) return false;

    const signatureBytes = hexToBytes(signature);
    const keyBytes = hexToBytes(publicKey);
    if (!signatureBytes || !keyBytes) return false;

    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const message = new TextEncoder().encode(timestamp + body);
    return crypto.subtle.verify({ name: 'Ed25519' }, key, signatureBytes, message);
  } catch {
    return false;
  }
}
