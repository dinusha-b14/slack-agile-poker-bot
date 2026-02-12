import pino from 'pino';
import { SNSEvent } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import participantVoteMessageTemplate from '../responses/participant-vote-message.json';
import { SlackTemplate } from '../services/slack-template';
import { docClient } from '../db/dynamo-client';


type SlackWorkerMessage = {
  type: 'PROMPT_VOTE';
  teamId: string;
  channelId: string;
  userId: string;
  sessionId: string;
  responseUrl: string;
}

export async function handler(event: SNSEvent) {
  const logger = pino();

  for (const record of event.Records) {
    const message = JSON.parse(record.Sns.Message);
    logger.info(`Received message: ${JSON.stringify(message)}`);

    const slackMessage = message as SlackWorkerMessage;

    if (slackMessage.type === 'PROMPT_VOTE') {
      logger.info(`Processing PROMPT_VOTE for user ${slackMessage.userId} in channel ${slackMessage.channelId}`);

      const { blocks } = participantVoteMessageTemplate as Record<string, any>;
      const template = new SlackTemplate(blocks);
      const renderedBlocks = template.render({
        TEAM_ID: slackMessage.teamId,
        CHANNEL_ID: slackMessage.channelId,
        SESSION_ID: slackMessage.sessionId,
      });

      const response = await fetch(`${process.env.SLACK_API_BASE_URL}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
        body: JSON.stringify({
          channel: slackMessage.userId,
          text: `<@${slackMessage.userId}>, it's your turn to vote!`,
          blocks: renderedBlocks,
        }),
      });

      const jsonResponseData = await response.json();
      logger.info(`Sent vote prompt to Slack. Response from Slack was: ${JSON.stringify(jsonResponseData)}`);

      if (!response.ok) {
        logger.error(`Failed to send message to Slack: ${jsonResponseData.error}`);
      }

      // Create a record in the database to track that this user has been prompted to vote (optional, depending on your implementation)
      const participantData = {
        PK: `TEAM#${slackMessage.teamId}#CHANNEL#${slackMessage.channelId}#SESSION#${slackMessage.sessionId}`,
        SK: `PARTICIPANT#${slackMessage.userId}`,
        status: 'PROMPTED',
        messageTs: jsonResponseData.ts,
      };

      await docClient.send(new PutCommand({
        TableName: process.env.SCRUM_POKER_TABLE_NAME,
        Item: participantData,
      }));
    }
  }
}
