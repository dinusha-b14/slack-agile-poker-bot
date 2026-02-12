import pino from 'pino';
import { ulid } from 'ulid';
import type { APIGatewayEvent } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import verifyRequest from '../services/verify';
import { parseRequestBody } from '../services/requests';
import { docClient } from '../db/dynamo-client';
import { SlackTemplate } from '../services/slack-template';
import welcomeMessageTemplate from '../responses/welcome-response.json';
import { SlackApiResponseBody } from '../common/types';

type SlackCommandRequest = {
  token: string;
  teamId: string;
  teamDomain: string;
  channelId: string;
  channelName: string;
  userId: string;
  userName: string;
  command: string;
  text: string;
  responseUrl: string;
  triggerId: string;
}

type SlackCommandResponse = {
  statusCode: number;
}

export async function handler(event: APIGatewayEvent): Promise<SlackCommandResponse> {
  const logger = pino();
  const { isValid, requestBody } = verifyRequest(event);

  if (!isValid) {
    logger.error('Request verification failed');
    return { statusCode: 200 };
  }

  logger.info('Request verified successfully');

  const jsonBody = parseRequestBody(requestBody);

  logger.info(`Parsed request body: ${JSON.stringify(jsonBody)}`);

   const slackRequest: SlackCommandRequest = {
    token: jsonBody.token,
    teamId: jsonBody.team_id,
    teamDomain: jsonBody.team_domain,
    channelId: jsonBody.channel_id,
    channelName: jsonBody.channel_name,
    userId: jsonBody.user_id,
    userName: jsonBody.user_name,
    command: jsonBody.command,
    text: jsonBody.text,
    responseUrl: jsonBody.response_url,
    triggerId: jsonBody.trigger_id,
  };

  await handleSlashCommand(slackRequest, logger);

  return { statusCode: 200 };
}

async function handleSlashCommand(slackRequest: SlackCommandRequest, logger: pino.Logger) {
  // Extract users from text (e.g., "/poker @user1 @user2")
  const userMentions = slackRequest.text.match(/<@([A-Z0-9]+)\|[^>]+>/g) || [];
  const userIds = userMentions.map(mention => mention.replace(/[<@>]/g, ''));

  const sessionId = ulid();

  // Render welcome message using template
  const { text, blocks } = welcomeMessageTemplate as Record<string, any>;
  const template = new SlackTemplate(blocks);
  const renderedBlocks = template.render({
    FACILITATOR: `<@${slackRequest.userId}>`,
    PROGRESS: `0/${userIds.length} voted`,
    PARTICIPANTS: userIds.map(id => `<@${id}>`).join('\n'),
    SESSION_ID: sessionId,
  });

  // Send response back to Slack
  const response = await fetch(`${process.env.SLACK_API_BASE_URL}/chat.postEphemeral`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: slackRequest.channelId,
      user: slackRequest.userId,
      text,
      blocks: renderedBlocks,
    }),
  });

  const jsonResponseData: SlackApiResponseBody = (await response.json()) as SlackApiResponseBody;

  logger.info(`Sent response to Slack. Response from Slack was: ${JSON.stringify(jsonResponseData)}`);

  // Queue messages for each participant to prompt them to vote
  await Promise.all(userIds.map(async (rawUserId) => {
    const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const userId = rawUserId.split('|')[0]; // Extract user ID from mention format

    await sns.send(new PublishCommand({
      TopicArn: process.env.SLACK_PARTICIPANTS_TOPIC_ARN,
      Message: JSON.stringify({
        type: 'PROMPT_VOTE',
        teamId: slackRequest.teamId,
        channelId: slackRequest.channelId,
        userId,
        sessionId,
        responseUrl: slackRequest.responseUrl,
      }),
    }));
  }));

  // Create session data to store in DB
  const sessionData = {
    PK: `TEAM#${slackRequest.teamId}#CHANNEL#${slackRequest.channelId}`,
    SK: `SESSION#${sessionId}`,
    status: 'ACTIVE',
    startedAt: new Date().toISOString(),
    facilitatorId: slackRequest.userId,
    participantIds: userIds,
    slackMessageTs: jsonResponseData.ts,
  };

  await docClient.send(new PutCommand({
    TableName: process.env.SCRUM_POKER_TABLE_NAME,
    Item: sessionData,
  }));
}


