import pino from 'pino';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { APIGatewayEvent } from 'aws-lambda';
import verifyRequest from '../services/verify';
import { extractDataFromEvent, parseRequestBody } from '../services/requests';

export async function handler(event: APIGatewayEvent) {
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

  const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

  const command = new SendMessageCommand({
    QueueUrl: process.env.SLACK_INGRESS_QUEUE_URL || '',
    MessageBody: JSON.stringify(jsonBody),
  });

  try {
    await sqsClient.send(command);
  } catch (error) {
    logger.error(`Failed to send message to SQS: ${error}`);
    return {
      statusCode: 500,
      body: 'Internal Server Error',
    };
  }

  return { statusCode: 200 };
}
