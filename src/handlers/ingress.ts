import pino from 'pino';
import type { APIGatewayEvent } from 'aws-lambda';
import verifyRequest from '../services/verify';

export async function handler(event: APIGatewayEvent) {
  const logger = pino();

  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  const isBase64Encoded = event.isBase64Encoded ?? false;
  const timestamp = headers['x-slack-request-timestamp'] || '';
  const signature = headers['x-slack-signature'] || '';
  const requestBody = isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
    : event.body ?? '';

  if (!verifyRequest(requestBody, process.env.SLACK_SIGNING_SECRET || '', timestamp, signature)) {
    logger.error('Request verification failed');
    return {
      statusCode: 400,
      body: 'Bad Request',
    };
  }

  logger.info('Request verified successfully');

  return { statusCode: 200 };
}
