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
  subscribedChannelIds: string[];
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

// ---- Channel catalog (channel_analyze_plan.md) ----

export type ChannelMetrics = {
  mainstreamScore: number; // 0-100, 업로드 viewCount median (log)
  nicheScore: number;      // 0-100, subscriberCount inverse-log
  uploadsPerMonth: number; // 활동성 추정
};

// DB Channel row 를 parse 한 in-memory 형태.
export type ChannelRecord = {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string;
  description: string | null;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  country: string | null;
  isKorean: boolean;
  categories: CategoryDist;     // { name: 0-100 }
  keywords: string[];
  metrics: ChannelMetrics;
  clusterId: number | null;
  source: string;
};

export type ClusterRecord = {
  id: number;
  label: string;
  centroid: CategoryDist;       // { name: weight }
  topCategories: { name: string; weight: number }[];
  topKeywords: string[];
  size: number;
  color: string | null;
};

export type ChannelRecommendation = {
  channel: ChannelRecord;
  score: number;          // 0-100
  clusterId: number | null;
  clusterLabel: string | null;
};

export type ClusterAssignment = {
  cluster: ClusterRecord;
  score: number;          // 0-100, user↔centroid cosine
};
