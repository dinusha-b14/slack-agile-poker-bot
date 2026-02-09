import pino from 'pino';
import type { APIGatewayEvent } from 'aws-lambda';
import verifyRequest from '../services/verify';

export async function handler(event: APIGatewayEvent) {
  const logger = pino();

  const isBase64Encoded = event.isBase64Encoded ?? false;
  const timestamp = event.headers['X-Slack-Request-Timestamp'] || '';
  const signature = event.headers['X-Slack-Signature'] || '';
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
