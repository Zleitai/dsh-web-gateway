import sodium from 'libsodium-wrappers';
import { z } from 'zod';
import { envelopeSchema, parseJson, type Envelope } from './schema.js';

export interface Identity { publicKey: string; privateKey: string }
export const ready = sodium.ready;
export const b64 = (bytes: Uint8Array): string => sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
export const bytes = (text: string): Uint8Array => sodium.from_base64(text, sodium.base64_variants.ORIGINAL);
export function identity(): Identity { const k = sodium.crypto_box_keypair(); return { publicKey: b64(k.publicKey), privateKey: b64(k.privateKey) }; }
export function secret(): string { return b64(sodium.randombytes_buf(32)); }
export function fingerprint(hostKey: string, phoneKey: string): string { return sodium.to_hex(sodium.crypto_generichash(16, hostKey + ':' + phoneKey, null)).match(/.{4}/g)!.join(' '); }
export function equalSecret(a: string, b: string): boolean { try { return sodium.memcmp(bytes(a), bytes(b)); } catch { return false; } }
const key = z.string().refine(v => { try { return bytes(v).length === 32; } catch { return false; } });
const offerSchema = z.object({ kind: z.literal('offer'), channel: z.string().uuid(), challenge: key, ephemeral: key }).strict();
const authSchema = z.object({ kind: z.literal('auth'), channel: z.string().uuid(), challenge: key, ephemeral: key, header: z.string(), token: z.string().max(100).optional(), name: z.string().trim().min(1).max(80) }).strict();
const acceptedSchema = z.object({ kind: z.literal('accepted'), channel: z.string().uuid(), challenge: key, header: z.string() }).strict();

/** Box handshakes authenticate ephemeral keys against identities bound during physical pairing. */
function box(local: Identity, remoteKey: string, data: unknown): Envelope {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  return { type: 'box', nonce: b64(nonce), data: b64(sodium.crypto_box_easy(JSON.stringify(data), nonce, bytes(remoteKey), bytes(local.privateKey))) };
}
function unbox(local: Identity, remoteKey: string, input: unknown): unknown {
  const envelope = envelopeSchema.parse(input);
  if (envelope.type !== 'box' || !envelope.nonce) throw new Error('HANDSHAKE_REQUIRED');
  const value = sodium.crypto_box_open_easy(bytes(envelope.data), bytes(envelope.nonce), bytes(remoteKey), bytes(local.privateKey));
  return parseJson(sodium.to_string(value));
}

/** Ordered, authenticated streams are recreated on every physical connection. */
export class SecureStream {
  private tx: ReturnType<typeof sodium.crypto_secretstream_xchacha20poly1305_init_push>['state'];
  private rx: ReturnType<typeof sodium.crypto_secretstream_xchacha20poly1305_init_pull> | undefined;
  readonly header: string;
  constructor(txKey: Uint8Array, private readonly rxKey: Uint8Array) {
    const push = sodium.crypto_secretstream_xchacha20poly1305_init_push(txKey);
    this.tx = push.state; this.header = b64(push.header);
    sodium.memzero(txKey);
  }
  receiveHeader(header: string): void {
    if (this.rx !== undefined) throw new Error('HEADER_ALREADY_SET');
    this.rx = sodium.crypto_secretstream_xchacha20poly1305_init_pull(bytes(header), this.rxKey);
    sodium.memzero(this.rxKey);
  }
  encrypt(data: unknown): Envelope {
    if (this.rx === undefined) throw new Error('NOT_READY');
    const text = JSON.stringify(data);
    if (new TextEncoder().encode(text).length > 350000) throw new Error('FRAME_TOO_LARGE');
    return { type: 'stream', data: b64(sodium.crypto_secretstream_xchacha20poly1305_push(this.tx, text, null, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE)) };
  }
  decrypt(input: unknown): unknown {
    const envelope = envelopeSchema.parse(input);
    if (envelope.type !== 'stream' || this.rx === undefined) throw new Error('NOT_READY');
    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(this.rx, bytes(envelope.data), null);
    if (!result || result.tag !== sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE) throw new Error('INVALID_STREAM');
    return parseJson(sodium.to_string(result.message));
  }
}
export class HostHandshake {
  private ephemeral = sodium.crypto_kx_keypair();
  private challenge = secret();
  private consumed = false;
  constructor(private local: Identity, private remoteKey: string, readonly channel: string) {}
  offer(): Envelope { return box(this.local, this.remoteKey, { kind: 'offer', channel: this.channel, challenge: this.challenge, ephemeral: b64(this.ephemeral.publicKey) }); }
  async accept(input: unknown, authorize: (request: { name: string; token?: string }) => Promise<boolean>): Promise<{ reply: Envelope; stream: SecureStream }> {
    if (this.consumed) throw new Error('HANDSHAKE_REPLAY');
    this.consumed = true;
    const auth = authSchema.parse(unbox(this.local, this.remoteKey, input));
    if (auth.channel !== this.channel || !equalSecret(auth.challenge, this.challenge)) throw new Error('WRONG_CHANNEL');
    if (!await authorize(auth)) throw new Error('NOT_AUTHORIZED');
    const keys = sodium.crypto_kx_server_session_keys(this.ephemeral.publicKey, this.ephemeral.privateKey, bytes(auth.ephemeral));
    sodium.memzero(this.ephemeral.privateKey);
    const stream = new SecureStream(keys.sharedTx, keys.sharedRx);
    stream.receiveHeader(auth.header);
    return { stream, reply: box(this.local, this.remoteKey, { kind: 'accepted', channel: this.channel, challenge: this.challenge, header: stream.header }) };
  }
}
export class PhoneHandshake {
  private ephemeral = sodium.crypto_kx_keypair();
  private offerData: z.infer<typeof offerSchema> | undefined;
  private stream: SecureStream | undefined;
  private completed = false;
  constructor(private local: Identity, private remoteKey: string, private channel: string) {}
  acceptOffer(input: unknown, name: string, token?: string): Envelope {
    if (this.offerData) throw new Error('HANDSHAKE_REPLAY');
    const offer = offerSchema.parse(unbox(this.local, this.remoteKey, input));
    if (offer.channel !== this.channel) throw new Error('WRONG_CHANNEL');
    this.offerData = offer;
    const keys = sodium.crypto_kx_client_session_keys(this.ephemeral.publicKey, this.ephemeral.privateKey, bytes(offer.ephemeral));
    this.stream = new SecureStream(keys.sharedTx, keys.sharedRx);
    const result = box(this.local, this.remoteKey, { kind: 'auth', channel: this.channel, challenge: offer.challenge, ephemeral: b64(this.ephemeral.publicKey), header: this.stream.header, name, ...(token ? { token } : {}) });
    sodium.memzero(this.ephemeral.privateKey);
    return result;
  }
  acceptReady(input: unknown): SecureStream {
    if (this.completed || !this.offerData || !this.stream) throw new Error('HANDSHAKE_STATE');
    const accepted = acceptedSchema.parse(unbox(this.local, this.remoteKey, input));
    if (accepted.channel !== this.channel || !equalSecret(accepted.challenge, this.offerData.challenge)) throw new Error('WRONG_CHANNEL');
    this.stream.receiveHeader(accepted.header); this.completed = true;
    return this.stream;
  }
}
