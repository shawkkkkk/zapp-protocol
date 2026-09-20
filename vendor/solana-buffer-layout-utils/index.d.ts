import type { Layout } from "@solana/buffer-layout";
import type BigNumber from "bignumber.js";
import type { PublicKey } from "@solana/web3.js";

export type EncodeDecode<T> = {
  decode(buffer: Buffer, offset?: number): T;
  encode(src: T, buffer: Buffer, offset?: number): number;
};

export declare function encodeDecode<T>(layout: Layout<T>): EncodeDecode<T>;
export declare const bigInt: (length: number) => (property?: string) => Layout<bigint>;
export declare const bigIntBE: (length: number) => (property?: string) => Layout<bigint>;
export declare const u64: (property?: string) => Layout<bigint>;
export declare const u64be: (property?: string) => Layout<bigint>;
export declare const u128: (property?: string) => Layout<bigint>;
export declare const u128be: (property?: string) => Layout<bigint>;
export declare const u192: (property?: string) => Layout<bigint>;
export declare const u192be: (property?: string) => Layout<bigint>;
export declare const u256: (property?: string) => Layout<bigint>;
export declare const u256be: (property?: string) => Layout<bigint>;
export declare const WAD: BigNumber;
export declare const decimal: (property?: string) => Layout<BigNumber>;
export declare const bool: (property?: string) => Layout<boolean>;
export declare const publicKey: (property?: string) => Layout<PublicKey>;
