import { APIGatewayEvent } from 'aws-lambda';

type ExtractedData = {
  timestamp: string;
  signature: string;
  requestBody: string;
}

export function extractDataFromEvent(event: APIGatewayEvent): ExtractedData {
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

export function parseRequestBody(requestBody: string): Record<string, any> {
  const params = new URLSearchParams(requestBody);
  const result: Record<string, any> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}
