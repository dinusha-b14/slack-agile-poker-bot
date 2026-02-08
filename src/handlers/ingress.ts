import pino from 'pino';
import type { APIGatewayEvent } from 'aws-lambda';

export async function handler(event: APIGatewayEvent) {
  const logger = pino();

  const isBase64Encoded = event.isBase64Encoded ?? false;
  const body = isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
    : event.body ?? '';

  logger.info(`Decoded body: ${JSON.stringify(body)}`);
}
