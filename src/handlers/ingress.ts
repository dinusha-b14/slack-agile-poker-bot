import pino from 'pino';
import type { APIGatewayEvent } from 'aws-lambda';
import verifyRequest from '../services/verify';
import { extractDataFromEvent, parseRequestBody } from '../services/requests';

export async function ingressHandler(event: APIGatewayEvent) {
  const logger = pino();

  const { timestamp, signature, requestBody } = extractDataFromEvent(event);

  if (!verifyRequest(requestBody, process.env.SLACK_SIGNING_SECRET || '', timestamp, signature)) {
    logger.error('Request verification failed');
    return {
      statusCode: 400,
      body: 'Bad Request',
    };
  }

  logger.info('Request verified successfully');

  const jsonBody = parseRequestBody(requestBody);

  logger.info(`Parsed request body: ${JSON.stringify(jsonBody)}`);

  return { statusCode: 200 };
}
