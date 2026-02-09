import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamo-client';
import { keys } from './keys';
import {
  ChannelActiveSessionItem,
  DedupItem,
  ParticipantItem,
  Scale,
  SessionBundle,
  SessionMetaItem,
  SessionStatus,
  VoteItem,
} from './types';
import { nowIso, tableName } from './util';

const TABLE = tableName();

export class ScrumPokerRepo {
  // ---------------------------
  // Dedup (Slack retries)
  // ---------------------------

  async recordSlackRequestDedup(args: {
    teamId: string;
    slackRequestId: string;
    ttlEpoch: number;
  }): Promise<boolean> {
    const ts = nowIso();

    const item: DedupItem = {
      ...keys.dedup(args.teamId, args.slackRequestId),
      teamId: args.teamId,
      slackRequestId: args.slackRequestId,
      receivedAt: ts,
      ttlEpoch: args.ttlEpoch,
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE,
          Item: item,
          // Only insert if not already present
          ConditionExpression: "attribute_not_exists(PK)",
        })
      );
      return true;
    } catch (err: any) {
      if (err?.name === "ConditionalCheckFailedException") return false;
      throw err;
    }
  }

  // ---------------------------
  // Active session pointer
  // ---------------------------

  async getActiveSessionId(teamId: string, channelId: string): Promise<string | null> {
    const res = await docClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: keys.channelActiveSession(teamId, channelId),
      })
    );

    const item = res.Item as ChannelActiveSessionItem | undefined;
    return item?.sessionId ?? null;
  }

  // ---------------------------
  // Sessions
  // ---------------------------

  async getSessionMeta(sessionId: string): Promise<SessionMetaItem | null> {
    const res = await docClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: keys.sessionMeta(sessionId),
      })
    );

    return (res.Item as SessionMetaItem) ?? null;
  }

  async getSessionBundle(sessionId: string): Promise<SessionBundle | null> {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `SESSION#${sessionId}`,
        },
      })
    );

    const items = (res.Items ?? []) as any[];

    const session = items.find((x) => x.SK === "META") as SessionMetaItem | undefined;
    if (!session) return null;

    const participants = items.filter((x) => String(x.SK).startsWith("PARTICIPANT#")) as ParticipantItem[];
    const votes = items.filter((x) => String(x.SK).startsWith("VOTE#")) as VoteItem[];

    return { session, participants, votes };
  }

  /**
   * Creates a session + channel active pointer + participants in a single transaction.
   * Prevents two sessions from being created concurrently in the same channel.
   */
  async createSession(args: {
    sessionId: string;
    teamId: string;
    channelId: string;
    createdBy: string;
    storyTitle: string;
    storyUrl?: string;
    scale: Scale;
    participantUserIds: string[];
    ttlEpoch?: number;
  }): Promise<void> {
    const ts = nowIso();

    const sessionMeta: SessionMetaItem = {
      ...keys.sessionMeta(args.sessionId),

      sessionId: args.sessionId,
      teamId: args.teamId,
      channelId: args.channelId,
      createdBy: args.createdBy,

      status: "ACTIVE",
      storyTitle: args.storyTitle,
      storyUrl: args.storyUrl,
      scale: args.scale,

      ttlEpoch: args.ttlEpoch,

      createdAt: ts,
      updatedAt: ts,
    };

    const channelPointer: ChannelActiveSessionItem = {
      ...keys.channelActiveSession(args.teamId, args.channelId),
      teamId: args.teamId,
      channelId: args.channelId,
      sessionId: args.sessionId,
      createdAt: ts,
    };

    const participantItems: ParticipantItem[] = args.participantUserIds.map((uid) => ({
      ...keys.participant(args.sessionId, uid),
      sessionId: args.sessionId,
      userId: uid,
      invitedAt: ts,
      votedAt: null,
    }));

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Session meta: must not exist
          {
            Put: {
              TableName: TABLE,
              Item: sessionMeta,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },

          // Channel pointer: must not exist (enforces 1 active session)
          {
            Put: {
              TableName: TABLE,
              Item: channelPointer,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },

          // Participants: up to 25 items total in a Dynamo transaction
          ...participantItems.map((p) => ({
            Put: {
              TableName: TABLE,
              Item: p,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          })),
        ],
      })
    );
  }

  async updateSessionSlackMessage(args: {
    sessionId: string;
    slackMessageTs: string;
    slackMessageChannel: string;
  }): Promise<void> {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: keys.sessionMeta(args.sessionId),
        UpdateExpression:
          "SET slackMessageTs = :ts, slackMessageChannel = :ch, updatedAt = :u",
        ExpressionAttributeValues: {
          ":ts": args.slackMessageTs,
          ":ch": args.slackMessageChannel,
          ":u": nowIso(),
        },
      })
    );
  }

  // ---------------------------
  // Voting
  // ---------------------------

  /**
   * Cast or update a vote.
   * Transactionally:
   * - upserts vote item
   * - marks participant votedAt
   *
   * You should validate session ACTIVE + participant exists before calling.
   */
  async castVote(args: {
    sessionId: string;
    userId: string;
    voteValue: string;
  }): Promise<void> {
    const ts = nowIso();

    const vote: VoteItem = {
      ...keys.vote(args.sessionId, args.userId),
      sessionId: args.sessionId,
      userId: args.userId,
      voteValue: args.voteValue,
      createdAt: ts,
      updatedAt: ts,
    };

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Upsert vote (no condition)
          {
            Put: {
              TableName: TABLE,
              Item: vote,
            },
          },

          // Mark participant voted
          {
            Update: {
              TableName: TABLE,
              Key: keys.participant(args.sessionId, args.userId),
              UpdateExpression: "SET votedAt = :v",
              ExpressionAttributeValues: {
                ":v": ts,
              },
              // Ensure participant exists
              ConditionExpression: "attribute_exists(PK)",
            },
          },
        ],
      })
    );
  }

  // ---------------------------
  // Reveal / Cancel
  // ---------------------------

  async revealSession(args: {
    sessionId: string;
    teamId: string;
    channelId: string;
  }): Promise<void> {
    const ts = nowIso();

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Update session status
          {
            Update: {
              TableName: TABLE,
              Key: keys.sessionMeta(args.sessionId),
              UpdateExpression: "SET #status = :revealed, revealedAt = :r, updatedAt = :u",
              ConditionExpression: "#status = :active",
              ExpressionAttributeNames: {
                "#status": "status",
              },
              ExpressionAttributeValues: {
                ":revealed": "REVEALED",
                ":active": "ACTIVE",
                ":r": ts,
                ":u": ts,
              },
            },
          },

          // Remove active pointer
          {
            Delete: {
              TableName: TABLE,
              Key: keys.channelActiveSession(args.teamId, args.channelId),
            },
          },
        ],
      })
    );
  }

  async cancelSession(args: {
    sessionId: string;
    teamId: string;
    channelId: string;
  }): Promise<void> {
    const ts = nowIso();

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE,
              Key: keys.sessionMeta(args.sessionId),
              UpdateExpression:
                "SET #status = :s, cancelledAt = :c, updatedAt = :u",
              ExpressionAttributeNames: {
                "#status": "status",
              },
              ExpressionAttributeValues: {
                ":s": "CANCELLED",
                ":c": ts,
                ":u": ts,
                ":active": "ACTIVE",
              },
              ConditionExpression: "#status = :active",
            },
          },
          {
            Delete: {
              TableName: TABLE,
              Key: keys.channelActiveSession(args.teamId, args.channelId),
            },
          },
        ],
      })
    );
  }

  // ---------------------------
  // Participants + Votes
  // ---------------------------

  async listParticipants(sessionId: string): Promise<ParticipantItem[]> {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `SESSION#${sessionId}`,
          ":sk": "PARTICIPANT#",
        },
      })
    );

    return (res.Items ?? []) as ParticipantItem[];
  }

  async listVotes(sessionId: string): Promise<VoteItem[]> {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `SESSION#${sessionId}`,
          ":sk": "VOTE#",
        },
      })
    );

    return (res.Items ?? []) as VoteItem[];
  }
}
