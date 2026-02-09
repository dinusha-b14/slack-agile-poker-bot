import crypto from 'crypto';

export default function verifyRequest(requestBody: string, signingSecret: string, timestamp: string, signature: string): boolean {
  if (new Date().getTime() / 1000 - parseInt(timestamp) > 60 * 5) {
    // Request is older than 5 minutes, possible replay attack
    return false;
  }

  const baseString = `v0:${timestamp}:${requestBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(baseString);
  const computedSignature = `v0=${hmac.digest('hex')}`;

  return crypto.timingSafeEqual(Buffer.from(computedSignature), Buffer.from(signature));
}
