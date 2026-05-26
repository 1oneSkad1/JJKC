// Domain types shared between server + client.

export type TopChannel = {
  id: string;
  name: string;
  thumbnail: string;
  videoCount: number;
};

export type CategoryDist = Record<string, number>;

export type ProfileMetrics = {
  diversity: number;
  concentration: number;
  shortsRatio: number;
  longFormRatio: number;
  languageDistribution: Record<string, number>;
  primaryLanguage: string | null;
  mainstreamScore: number;
  nicheChannelScore: number;
};

export type AlgoProfileShape = {
  userId: string;
  categories: CategoryDist;
  topChannels: TopChannel[];
  topKeywords: string[];
  sampleVideoIds: string[];
  metrics: ProfileMetrics;
  lastSyncedAt: string;
};

export type PublicUser = {
  id: string;
  name: string;
  image: string | null;
  email: string | null;
  isPublic: boolean;
};

export type FeedVideo = {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  thumbnail: string;
  publishedAt: string;
  source: "channel" | "keyword" | "category";
};
