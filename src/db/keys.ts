export const keys = {
  channelActiveSession: (teamId: string, channelId: string) => ({
    PK: `CHANNEL#${teamId}#${channelId}`,
    SK: "ACTIVE_SESSION",
  }),

  sessionMeta: (sessionId: string) => ({
    PK: `SESSION#${sessionId}`,
    SK: "META",
  }),

  participant: (sessionId: string, userId: string) => ({
    PK: `SESSION#${sessionId}`,
    SK: `PARTICIPANT#${userId}`,
  }),

  vote: (sessionId: string, userId: string) => ({
    PK: `SESSION#${sessionId}`,
    SK: `VOTE#${userId}`,
  }),

  dedup: (teamId: string, slackRequestId: string) => ({
    PK: `DEDUP#${teamId}`,
    SK: `REQ#${slackRequestId}`,
  }),
};
