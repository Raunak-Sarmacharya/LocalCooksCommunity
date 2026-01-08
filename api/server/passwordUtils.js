import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64));
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(password, hash) {
  // Check if stored password is bcrypt format (starts with $2a$, $2b$, or $2y$)
  const isBcrypt = hash && (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$') || hash.startsWith('$2$'));
  
  if (isBcrypt) {
    // Use bcrypt for Neon database passwords
    const bcrypt = await import('bcryptjs');
    return await bcrypt.default.compare(password, hash);
  } else {
    // Use scrypt for legacy format (hashed.salt)
    const [hashedPassword, salt] = hash.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = (await scryptAsync(password, salt, 64));
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  }
}
