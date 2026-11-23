import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const VERSION = "scrypt-v1";
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const DUMMY_HASH = [VERSION, Buffer.alloc(SALT_BYTES).toString("hex"), Buffer.alloc(KEY_BYTES).toString("hex")].join(":");
let activeDerivations = 0;

export class PasswordCapacityError extends Error {}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (activeDerivations >= 2) {
    throw new PasswordCapacityError("Password service is busy. Try again shortly.");
  }

  activeDerivations += 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, KEY_BYTES, OPTIONS, (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      });
    });
  } finally {
    activeDerivations -= 1;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return [VERSION, salt.toString("hex"), key.toString("hex")].join(":");
}

export async function verifyPassword(password: string, storedHash?: string): Promise<boolean> {
  const [version, salt, digest] = (storedHash ?? DUMMY_HASH).split(":");
  if (version !== VERSION || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(digest)) {
    return false;
  }
  const key = await derive(password, Buffer.from(salt, "hex"));
  return timingSafeEqual(key, Buffer.from(digest, "hex")) && storedHash !== undefined;
}
