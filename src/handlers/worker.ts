import pino from 'pino';
import { SQSEvent } from 'aws-lambda';
import { SlackTemplate } from '../services/slack-template';
import welcomeResponse from '../responses/welcome-response.json';
import { text } from 'stream/consumers';

type SlackCommandMessage = {
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
};

export async function handler(event: SQSEvent) {
  const logger = pino();

  for (const record of event.Records) {
    const messageBody = record.body;
    logger.info(`Received message: ${messageBody}`);

    const parsedMessage = JSON.parse(messageBody) as Record<string, any>;

    const slackCommand: SlackCommandMessage = {
      token: parsedMessage.token,
      teamId: parsedMessage.team_id,
      teamDomain: parsedMessage.team_domain,
      channelId: parsedMessage.channel_id,
      channelName: parsedMessage.channel_name,
      userId: parsedMessage.user_id,
      userName: parsedMessage.user_name,
      command: parsedMessage.command,
      text: parsedMessage.text,
      responseUrl: parsedMessage.response_url,
      triggerId: parsedMessage.trigger_id,
    };

    const blocksTemplate = new SlackTemplate(welcomeResponse.blocks as Record<string, any>[]);

    const renderedResponse = blocksTemplate.render({
      FACILITATOR: `<@${slackCommand.userId}>`,
      PROGRESS: '0/0 voted',
      PARTICIPANTS: slackCommand.text.split(' ').map((userId) => userId).join(' '),
    });

    const finalResponse = {
      text: welcomeResponse.text,
      blocks: renderedResponse,
    };

    logger.info(`Rendered response: ${JSON.stringify(finalResponse, null, 2)}`);

    try {
      await fetch(slackCommand.responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalResponse),
      });
    } catch (error) {
      logger.error(`Failed to send response to Slack: ${error}`);
    }
  }
}

// async function createSession(slackCommand: SlackCommandMessage, logger: pino.Logger) {
//   // Create new session in DynamoDB and post initial message to Slack
//   const scrumPokerRepo = new ScrumPokerRepo();
//   try {
//     await scrumPokerRepo.createSession({
//       teamId: slackCommand.teamId,
//       channelId: slackCommand.channelId,
//       createdBy: slackCommand.userId,
//       storyTitle: slackCommand.text,
//       scale: 'FIBONACCI',
//       ttlEpoch: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours from now,
//       sessionId: `session-${Date.now()}`, // You may want to generate a better session ID in production
//       participantUserIds: [slackCommand.userId],
//     });
//     logger.info('Session created successfully');
//   } catch (error) {
//     logger.error(`Error creating session: ${error}`);
//   }
// }
