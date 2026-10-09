// Types for the http_ece dev dependency (used only by webpush.test.ts to decrypt what
// webpush.ts encrypts, as an independent RFC 8188 implementation).
declare module 'http_ece' {
  import type { ECDH } from 'node:crypto';

  interface EceParams {
    version?: 'aes128gcm' | 'aesgcm';
    key?: string | Buffer;
    salt?: string | Buffer;
    rs?: number;
    keyid?: string | Buffer;
    /** The receiver's key pair when decrypting (the sender's when encrypting). */
    privateKey?: ECDH;
    /** The other side's public key. */
    dh?: string | Buffer;
    authSecret?: string | Buffer;
    pad?: number;
  }

  const ece: {
    encrypt(buffer: Buffer, params: EceParams): Buffer;
    decrypt(buffer: Buffer, params: EceParams): Buffer;
  };
  export default ece;
}
