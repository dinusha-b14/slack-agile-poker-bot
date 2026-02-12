import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayEvent } from 'aws-lambda';
import pino from 'pino';
import Handlebars from 'handlebars';
import { docClient } from '../db/dynamo-client';
import { parseRequestBody } from '../services/requests';
import verifyRequest from '../services/verify';
import pokerResultsTemplate from '../responses/poker-results.json';

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

  switch (true) {
    case action.startsWith('poker_vote'):
      logger.info(`Handling vote action for user with ID ${userId}`);
      return handleVote(channelId, userId, value, responseUrl, logger);
    case action.startsWith('poker_cancel'):
      logger.info(`Handling cancel action for session ${value}`);
      return cancelSession(teamId, channelId, value, userId, responseUrl, logger);
    default:
      logger.warn(`Unknown action: ${action}`);
      return { statusCode: 200 };
  }
}

async function cancelSession(teamId: string, channelId: string, sessionId: string, userId: string, responseUrl: string, logger: pino.Logger) {
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

    return { statusCode: 200 };
  }

  if (sessionRecord.Item.facilitatorId !== userId) {
    logger.warn(`User ${userId} is not the facilitator of session ${sessionId} and cannot cancel it`);
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: false,
        text: `Only the facilitator can cancel this poker session.`,
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

  // Find all user records for this session and update their status to 'CANCELLED' (optional, depending on your implementation)
  const userRecords = await docClient.send(new QueryCommand({
    TableName: process.env.SCRUM_POKER_TABLE_NAME,
    KeyConditionExpression: 'PK = :pk and begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `TEAM#${teamId}#CHANNEL#${channelId}#SESSION#${sessionId}`,
      ':skPrefix': 'PARTICIPANT#',
    },
  }));

  for (const userRecord of userRecords.Items || []) {
    await docClient.send(new PutCommand({
      TableName: process.env.SCRUM_POKER_TABLE_NAME,
      Item: {
        ...userRecord,
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
      },
    }));
  }

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

async function handleVote(userChannelId: string,userId: string, value: string | undefined, responseUrl: string, logger: pino.Logger) {
  // Parse the button value to extract sessionId, teamId, and channelId
  const { sessionId, teamId, channelId, vote } = JSON.parse(value || '{}');
  const voteNumber = parseInt(vote || '', 10);

  logger.info(`Handling vote for user ${userId} in session ${sessionId} with vote value ${vote}`);

  // Update vote in DB
  const userVoteRecord = await docClient.send(new GetCommand({
    TableName: process.env.SCRUM_POKER_TABLE_NAME,
    Key: {
      PK: `TEAM#${teamId}#CHANNEL#${channelId}#SESSION#${sessionId}`,
      SK: `PARTICIPANT#${userId}`,
    },
  }));

  if (!userVoteRecord.Item) {
    logger.error(`User vote record not found for user ${userId} in session ${sessionId}`);
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: false,
      }),
    });

    return { statusCode: 200 };
  }

  await docClient.send(new PutCommand({
    TableName: process.env.SCRUM_POKER_TABLE_NAME,
    Item: {
      ...userVoteRecord.Item,
      vote: voteNumber,
      votedAt: new Date().toISOString(),
      status: 'VOTED',
    },
  }));

  const messageTs = userVoteRecord.Item.messageTs;

  logger.info(`Original message timestamp: ${messageTs}, channel ID: ${channelId}`);

  // Optionally, you can update the original message to reflect that the user has voted (e.g., by adding a checkmark next to their name)
  await fetch(`${process.env.SLACK_API_BASE_URL}/chat.update`, {
    method: 'POST',
    headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
    },
    body: JSON.stringify({
      channel: userChannelId,
      ts: messageTs,
      text: `Your vote of ${vote} has been recorded.`,
    }),
  });

  logger.info(`Vote for session ${sessionId} recorded successfully`);

  // Optionally, you can also check if all participants have voted and update the message to show results or next steps
  const sessionRecord = await docClient.send(new GetCommand({
    TableName: process.env.SCRUM_POKER_TABLE_NAME,
    Key: {
      PK: `TEAM#${teamId}#CHANNEL#${channelId}`,
      SK: `SESSION#${sessionId}`,
    },
  }));

  if (!sessionRecord.Item) {
    logger.error(`Session record not found for session ${sessionId}`);
    return { statusCode: 200 };
  }

  const participantCount = sessionRecord.Item.participantIds.length;
  const votedParticipants = await docClient.send(new QueryCommand({
    TableName: process.env.SCRUM_POKER_TABLE_NAME,
    KeyConditionExpression: 'PK = :pk and begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `TEAM#${teamId}#CHANNEL#${channelId}#SESSION#${sessionId}`,
      ':skPrefix': 'PARTICIPANT#',
    },
  }));

  if (votedParticipants.Items && votedParticipants.Items.length === participantCount) {
    logger.info(`All participants have voted in session ${sessionId}. Updating message to show results.`);

    const template = Handlebars.compile(JSON.stringify(pokerResultsTemplate));
    const renderedMessage = template({
      FACILITATOR: `<@${sessionRecord.Item.facilitatorId}>`,
    });

    logger.info(`Rendered poker results message: ${renderedMessage}`);

    const { text, blocks } = JSON.parse(renderedMessage) as Record<string, any>;

    const renderedBlocks = [
      ...blocks,
      {
        type: 'section',
        fields: votedParticipants.Items.map((participant) => ({
          type: 'mrkdwn',
          text: `<@${participant.SK.split('#')[1]}>: ${participant.vote}`,
        })),
      },
    ];

    logger.info(`Rendered message blocks: ${JSON.stringify(renderedBlocks)}`);

    await fetch(`${process.env.SLACK_API_BASE_URL}/chat.update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify({
        channel: channelId,
        ts: sessionRecord.Item.messageTs,
        text,
        blocks: renderedBlocks,
      }),
    });

    // Update session status to 'COMPLETED'
    await docClient.send(new PutCommand({
      TableName: process.env.SCRUM_POKER_TABLE_NAME,
      Item: {
        ...sessionRecord.Item,
        status: 'COMPLETED',
        revealedAt: new Date().toISOString(),
      },
    }));

    logger.info(`Session ${sessionId} marked as COMPLETED`);
  }

  return { statusCode: 200 };
}
