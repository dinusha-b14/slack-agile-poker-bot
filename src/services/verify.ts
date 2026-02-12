import { APIGatewayEvent } from 'aws-lambda';
import crypto from 'crypto';

type ExtractedData = {
  timestamp: string;
  signature: string;
  requestBody: string;
}

type VerifyRequestResponse = {
  isValid: boolean;
  requestBody: string;
}

export default function verifyRequest(event: APIGatewayEvent): VerifyRequestResponse {
  const { timestamp, signature, requestBody } = extractDataFromEvent(event);
  const signingSecret = process.env.SLACK_SIGNING_SECRET || '';
  if (Date.now() / 1000 - parseInt(timestamp, 10) > 60 * 5) {
    return { isValid: false, requestBody };
  }

  const baseString = `v0:${timestamp}:${requestBody}`;
  const computedSignature = `v0=${crypto.createHmac("sha256", signingSecret).update(baseString, "utf8").digest("hex")}`;

  if (computedSignature.length !== signature.length) return { isValid: false, requestBody };

  return {
    isValid: crypto.timingSafeEqual(
      Buffer.from(computedSignature, "utf8"),
      Buffer.from(signature, "utf8")
    ),
    requestBody,
  };
}

function extractDataFromEvent(event: APIGatewayEvent): ExtractedData {
  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  const isBase64Encoded = event.isBase64Encoded ?? false;
  const requestBody = isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
    : event.body ?? '';

  return {
    timestamp: headers['x-slack-request-timestamp'] || '',
    signature: headers['x-slack-signature'] || '',
    requestBody,
  };
}


