import { Injectable } from "@nestjs/common";
import * as crypto from "crypto";

const VERSION = "v1";
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
};

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString("base64url");
    const derivedKey = await this.scrypt(
      password,
      salt,
      KEY_LENGTH,
      SCRYPT_PARAMS,
    );

    return [
      "scrypt",
      VERSION,
      SCRYPT_PARAMS.N,
      SCRYPT_PARAMS.r,
      SCRYPT_PARAMS.p,
      KEY_LENGTH,
      salt,
      derivedKey.toString("base64url"),
    ].join("$");
  }

  async verify(
    password: string,
    storedHash: string | null | undefined,
  ): Promise<boolean> {
    try {
      if (!storedHash) return false;

      const parts = storedHash.split("$");
      if (parts.length !== 8) return false;

      const [
        algorithm,
        version,
        nRaw,
        rRaw,
        pRaw,
        keyLengthRaw,
        salt,
        hashRaw,
      ] = parts;
      if (algorithm !== "scrypt" || version !== VERSION || !salt || !hashRaw)
        return false;

      const N = Number(nRaw);
      const r = Number(rRaw);
      const p = Number(pRaw);
      const keyLength = Number(keyLengthRaw);
      if (![N, r, p, keyLength].every(Number.isSafeInteger) || keyLength <= 0)
        return false;

      const expected = Buffer.from(hashRaw, "base64url");
      if (expected.length !== keyLength) return false;

      const actual = await this.scrypt(password, salt, keyLength, { N, r, p });
      if (actual.length !== expected.length) return false;

      return crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  private scrypt(
    password: string,
    salt: string,
    keyLength: number,
    options: crypto.ScryptOptions,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, keyLength, options, (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      });
    });
  }
}
