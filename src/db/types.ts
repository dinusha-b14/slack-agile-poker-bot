export type SessionStatus = 'ACTIVE' | 'REVEALED' | 'CANCELLED' | 'EXPIRED';
export type Scale = 'FIBONACCI' | 'TSHIRT' | 'CUSTOM';

export type ChannelActiveSessionItem = {
  PK: string;
  SK: string;
  teamId: string;
  channelId: string;
  sessionId: string;
  createdAt: string;
};

export type SessionMetaItem = {
  PK: string;
  SK: string;

  sessionId: string;
  teamId: string;
  channelId: string;
  createdBy: string;

  status: SessionStatus;

  storyTitle: string;
  storyUrl?: string | undefined;
  scale: Scale;

  slackMessageTs?: string | undefined;
  slackMessageChannel?: string | undefined;

  revealedAt?: string | undefined;
  cancelledAt?: string | undefined;

  // TTL (optional)
  ttlEpoch?: number | undefined;

  createdAt: string;
  updatedAt: string;
};

export type ParticipantItem = {
  PK: string;
  SK: string; // PARTICIPANT#<userId>

  sessionId: string;
  userId: string;

  invitedAt: string;
  votedAt?: string | null;
};

export type VoteItem = {
  PK: string;
  SK: string; // VOTE#<userId>

  sessionId: string;
  userId: string;

  voteValue: string;

  createdAt: string;
  updatedAt: string;
};

export type DedupItem = {
  PK: string;
  SK: string;

  teamId: string;
  slackRequestId: string;

  receivedAt: string;
  ttlEpoch: number;
};

export type SessionBundle = {
  session: SessionMetaItem;
  participants: ParticipantItem[];
  votes: VoteItem[];
};
