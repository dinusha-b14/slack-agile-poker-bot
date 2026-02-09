import crypto from 'crypto';

export default function verifyRequest(requestBody: string, signingSecret: string, timestamp: string, signature: string): boolean {
  if (Date.now() / 1000 - parseInt(timestamp, 10) > 60 * 5) {
    return false;
  }

  const baseString = `v0:${timestamp}:${requestBody}`;
  const computedSignature = `v0=${crypto.createHmac("sha256", signingSecret).update(baseString, "utf8").digest("hex")}`;

  if (computedSignature.length !== signature.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(computedSignature, "utf8"),
    Buffer.from(signature, "utf8")
  );
}
