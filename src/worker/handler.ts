import pino from 'pino';
import { SQSEvent } from 'aws-lambda';

export async function handler(event: SQSEvent) {
  const logger = pino();

  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    logger.info(`Received message: ${JSON.stringify(message)}`);
  }
}
