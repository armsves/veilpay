/**
 * Local ed25519 signer for SPP (stealth burner accounts — not Freighter).
 */

import { Keypair, TransactionBuilder, hash } from "@stellar/stellar-sdk";
import type { SignOptions, WalletSigner } from "stellar-private-payments";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export class StealthKeypairSigner implements WalletSigner {
  readonly keypair: Keypair;
  readonly networkPassphrase: string;

  constructor(secret: string, networkPassphrase: string) {
    this.keypair = Keypair.fromSecret(secret);
    this.networkPassphrase = networkPassphrase;
  }

  async getPublicKey() {
    return this.keypair.publicKey();
  }

  async signTransaction(xdr: string, opts?: SignOptions) {
    const tx = TransactionBuilder.fromXDR(
      xdr,
      opts?.networkPassphrase || this.networkPassphrase,
    );
    tx.sign(this.keypair);
    return {
      signedTxXdr: tx.toXDR(),
      signerAddress: this.keypair.publicKey(),
    };
  }

  async signAuthEntry(authEntryXdr: string, _opts?: SignOptions) {
    const signedAuthEntry = bytesToB64(this.keypair.sign(hash(b64ToBytes(authEntryXdr))));
    return {
      signedAuthEntry,
      signerAddress: this.keypair.publicKey(),
    };
  }

  async signMessage(message: string, _opts?: SignOptions) {
    const payload =
      typeof message === "string" ? new TextEncoder().encode(message) : message;
    const signedMessage = bytesToB64(this.keypair.signMessage(payload));
    return {
      signedMessage,
      signerAddress: this.keypair.publicKey(),
    };
  }
}
