import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayEvent } from 'aws-lambda';
import pino from 'pino';
import { docClient } from '../db/dynamo-client';
import { parseRequestBody } from '../services/requests';
import verifyRequest from '../services/verify';

type SlackInteractionRequest = {
  type: string;
  team: { id: string; domain: string };
  user: { id: string; username: string };
  channel: { id: string; name: string };
  actions: Record<string, any>[];
  message: { ts: string; };
  triggerId: string;
  responseUrl: string;
}

export async function handler(event: APIGatewayEvent) {
  const logger = pino();

  const { isValid, requestBody } = verifyRequest(event);

  if (!isValid) {
    logger.error('Request verification failed');
    return {
      statusCode: 400,
        body: 'Bad Request',
      };
    }

  logger.info('Request verified successfully');

  const jsonBody = parseRequestBody(requestBody);

  logger.info(`Parsed request body: ${JSON.stringify(jsonBody)}`);

  const payload = JSON.parse(jsonBody.payload);
  const slackInteractionRequest: SlackInteractionRequest = {
    type: payload.type,
    team: payload.team,
    user: payload.user,
    channel: payload.channel,
    actions: payload.actions,
    message: payload.message,
    triggerId: payload.trigger_id,
    responseUrl: payload.response_url,
  };

  await handleInteraction(slackInteractionRequest, logger);

  return { statusCode: 200 };
}

async function handleInteraction(slackInteractionRequest: SlackInteractionRequest, logger: pino.Logger) {
  const {
    team: { id: teamId },
    channel: { id: channelId },
    user: { id: userId },
    responseUrl,
    actions,
  } = slackInteractionRequest;

  const action = actions[0]?.action_id;
  const value = actions[0]?.value;

  switch (action) {
    case 'poker_cancel':
      logger.info(`Handling cancel action for session ${value}`);
      return cancelSession(teamId, channelId, value, responseUrl, logger);
    default:
      logger.warn(`Unknown action: ${action}`);
      return { statusCode: 200 };
  }
}

async function cancelSession(teamId: string, channelId: string, sessionId: string, responseUrl: string, logger: pino.Logger) {
  logger.info(`Cancelling session ${sessionId}`);
  // Update session status in DB to 'CANCELLED'
  const sessionRecord = await docClient.send(new GetCommand({
    TableName: process.env.SCRUM_POKER_TABLE_NAME,
    Key: {
      PK: `TEAM#${teamId}#CHANNEL#${channelId}`,
      SK: `SESSION#${sessionId}`,
    },
  }));

  // Session may have been deleted manually
  if (!sessionRecord.Item) {
    logger.error(`Session not found: ${sessionId}`);
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: true,
        text: `Poker session has been cancelled.`,
      }),
    });

    return {
      statusCode: 200,
    };
  }

  await docClient.send(new PutCommand({
    TableName: process.env.SCRUM_POKER_TABLE_NAME,
    Item: {
      ...sessionRecord.Item,
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString(),
    },
  }));

  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replace_original: true,
      text: `Poker session has been cancelled.`,
    }),
  });

  logger.info(`Session ${sessionId} cancelled successfully`);

  return { statusCode: 200 };
}
