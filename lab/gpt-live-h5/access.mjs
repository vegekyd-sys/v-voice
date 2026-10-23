import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function createVoiceAccess(token, basePath, now = Date.now, { entry = "tianyi" } = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("Voice access token must contain at least 32 characters");
  const equal = (a, b) => {
    const left = Buffer.from(String(a)), right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
  };
  if (!/^[a-z0-9_-]{1,64}$/u.test(entry)) throw new Error("Invalid voice entry");
  const cookieName = entry === "tianyi" ? "v_voice_access" : entry === "visitor" ? "v_voice_visitor" : `v_voice_${entry}`;
  const sign = (id, expiresAt) => {
    const payload = `${id}.${expiresAt}`;
    return `${payload}.${createHmac("sha256", token).update(entry === "tianyi" ? payload : `${entry}:${payload}`).digest("base64url")}`;
  };
  return {
    accepts: value => equal(value ?? "", token),
    read(req) {
      try {
        const value = String(req.headers.cookie ?? "").split(/;\s*/u).find(part => part.startsWith(`${cookieName}=`));
        const signed = decodeURIComponent(value?.slice(cookieName.length + 1) ?? "");
        const [id, expiry, signature] = signed.split("."), expiresAt = Number(expiry);
        if (!/^[a-f0-9]{32}$/u.test(id ?? "") || !Number.isFinite(expiresAt) || expiresAt <= now() || !signature) return null;
        return equal(sign(id, expiresAt), signed) ? { id, expiresAt } : null;
      } catch { return null; }
    },
    issue(res, {id = randomBytes(16).toString("hex")} = {}) {
      if (!/^[a-f0-9]{32}$/u.test(id)) throw new Error("Invalid visitor ID");
      const visitor = { id, expiresAt: now() + 604800000 };
      res.setHeader("set-cookie", `${cookieName}=${encodeURIComponent(sign(visitor.id, visitor.expiresAt))}; Path=${basePath}/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure`);
      return visitor;
    },
  };
}
