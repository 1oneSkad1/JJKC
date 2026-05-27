# yt-algo-share

`report/week09/조현성/plan.md` 의 사양을 구현한 풀스택 데모.

**YouTube Data API key 없이 동작** — RSS·oEmbed·정적 카탈로그만 사용. 자세한 마이그레이션 이력은 아래 [YouTube API 의존 제거](#youtube-api-의존-제거-2026-05) 절 참고.

## 무엇이 들어 있는가

| 영역 | 구현 |
|---|---|
| Frontend | Next.js 15 App Router + React 19 (RSC) |
| Style | Tailwind CSS + shadcn 스타일 UI primitive 직접 작성 (`components/ui/*`) |
| Auth | NextAuth v5 + Google OAuth + PrismaAdapter (식별용 `openid email profile` 만 사용 — YouTube scope 제거) |
| DB | Prisma + SQLite (개발 즉시 실행 가능). Postgres/Neon 으로 전환은 `prisma/schema.prisma` 의 provider 변경 + Json/String[] 마이그레이션. |
| Cache | `lib/cache.ts` — 기본 in-memory, `UPSTASH_REDIS_REST_URL/TOKEN` 환경변수 있으면 자동 Upstash. |
| 데이터 소스 | YouTube RSS (`feeds/videos.xml`), oEmbed, DB 카탈로그 (key 0) |
| Charts | recharts (radar / bar) + keyword cloud |

## 실행

```bash
cd jhs
npm install
npx prisma db push                                # 스키마 적용
npm run catalog:seed                              # data/seed-channels.json → Channel 1,460+ RSS 적재
npx tsx scripts/import-external-dump.ts ../dump.sql  # (선택) 외부 dump 보강 import
npm run channels:cluster                          # k-means 클러스터링
npm run dev
# http://localhost:3000
```

`.env`:

```env
DATABASE_URL="file:./dev.db"
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_SECRET=...                       # NEXTAUTH_SECRET 동의어
NEXTAUTH_URL="http://localhost:3000"
# 선택:
# UPSTASH_REDIS_REST_URL=...
# UPSTASH_REDIS_REST_TOKEN=...
```

Google OAuth Console 의 redirect URI 에 `http://localhost:3000/api/auth/callback/google` 추가. **YouTube Data API v3 활성화 불필요**.

## 로컬 DB 카탈로그 (2026-05)

`Channel` 테이블에 사전 큐레이션된 한국 채널(구독자 10만+) ~2,200개를 적재해 두고, 피드·추천 모두 이 카탈로그를 기준으로 동작. YouTube API 호출은 RSS feed 만 사용 (key 불필요).

### 파이프라인

```
data/seed-channels.json                   ← Playboard 14 카테고리 × top100, 수동 큐레이션
   │ (scripts/resolve-channel-ids.ts 가 이름→channelId 해결)
   │
   ▼
scripts/catalog-seed.ts
   ├─ youtube.com/feeds/videos.xml?channel_id=…   (key 0)
   ├─ lib/classify.ts                              (data/category-lexicon.ko.yaml)
   └─ Channel.upsert(source='seed')                + metrics 추정
   │
   ▼
scripts/import-external-dump.ts (선택)            ← dump.sql 외부 데이터 보강
   ├─ subscriberCount/viewCount/handle/description 그대로 복사
   ├─ categories 만 우리 classify() 로 재계산 (namespace 통일)
   └─ Channel.upsert(source='external-dump')
   │
   ▼
scripts/reclassify-catalog.ts                     ← lexicon 튜닝 후 일괄 재분류
   └─ RSS 호출 0, in-memory text → classify() → categories 갱신
   │
   ▼
scripts/channels-cluster.ts (= npm run channels:cluster)
   └─ 카테고리 벡터 → k-means++ → 실루엣으로 best-k → ChannelCluster
```

### 현재 카탈로그 통계 (참고)

| 항목 | 값 |
|---|---|
| Channel 총량 | 2,244 |
| ├ source='seed' | 1,284 |
| ├ source='external-dump' | 910 |
| └ source='search' (legacy mock) | 50 |
| ChannelCluster | 16 (silhouette 0.434) |
| 카테고리 namespace | YouTube 표준 15 (Music/Gaming/News & Politics/…) |

### 데이터 자원

| 파일 | 용도 |
|---|---|
| `data/seed-channels.json` | 채널 시드. `{id, title, hintCategory}` 형식 1,460+ 엔트리 |
| `data/category-lexicon.ko.yaml` | 한국어 키워드 → 카테고리 사전. 15 카테고리 + Food → Howto/People alias |
| `../dump.sql` | 외부에서 우리 channels-collect 로 만든 SQL 덤프 (선택 import) |

### 스크립트

| 명령 | 동작 |
|---|---|
| `npm run catalog:seed` | seed-channels.json → RSS 적재. `--concurrency N --limit N --dry` 옵션 |
| `npm run channels:cluster` | k-means + 실루엣 best-k 자동, ChannelCluster 갱신 |
| `npx tsx scripts/resolve-channel-ids.ts <hint> < names.txt` | 채널 이름 리스트 → channelId 해결 (YouTube 검색 HTML 스크랩) |
| `npx tsx scripts/resolve-all-categories.ts <top100.txt>` | 14 카테고리 × top100 일괄 처리 (안티 rate-limit 5-9s 페이싱) |
| `npx tsx scripts/merge-resolved.ts a.json b.json …` | resolved-by-cat/*.json 을 seed-channels.json 에 머지 |
| `npx tsx scripts/import-external-dump.ts <dump.sql>` | 외부 SQL 덤프 import. subscriberCount/viewCount 보강 + categories 재계산 |
| `npx tsx scripts/reclassify-catalog.ts [--only-empty] [--dry]` | lexicon 변경 후 카탈로그 전체 in-place 재분류 |
| `npx tsx scripts/verify-dump-rss.ts < sample.tsv` | dump 의 channelId 가 실제 YouTube 에 존재하는지 RSS 로 검증 |

## 피드 생성 — RSS + 카탈로그 (plan §Step 7)

```
타인의 AlgoProfile 로드 (Phase 3 onboard 폼 입력 결과)
   │
   ├─ topChannels (30%) → lib/sources/rss.ts: fetchChannelFeed(channelId)
   ├─ topKeywords (40%) → lib/sources/catalog.ts: listByKeyword → 각 채널 RSS
   └─ categories  (30%) → lib/sources/catalog.ts: listByCategory → 각 채널 RSS
   │
   ▼
중복 제거 + round-robin 인터리브 → 최종 N개
   │
   ▼
YouTube watch 링크 (썸네일 + 클릭 → youtube.com/watch?v=...)
```

캐시 키: `feed:v2:{lastSyncedAt}:{viewerId}:{targetId}:{total}` — onboard 재제출 시 lastSyncedAt 가 바뀌어 자연 만료.

## 페이지 (plan §Step 6 그대로)

| URL | 내용 |
|---|---|
| `/` | 랜딩 + Google 로그인 |
| `/dashboard` | 내 알고리즘 카드 + 카테고리 차트 + 채널/키워드 + 본인 피드 + 공개토글 |
| `/explore` | 공개 프로필 카드 목록 |
| `/profile/[userId]` | 타인 프로필 상세 + 그 사람 알고리즘 기반 피드 + Follow |
| `/compare?a=&b=` | 두 알고리즘 카테고리 분포 오버레이 (radar) + 공유 키워드 |
| `/onboard` *(Phase 3 예정)* | 채널/카테고리/플레이리스트 입력 → AlgoProfile 생성 |

## API

| 메서드 + 경로 | 동작 |
|---|---|
| `GET    /api/auth/[...nextauth]` | NextAuth 핸들러 |
| `POST   /api/sync` | (DEPRECATED, 410 Gone) — `/onboard` 안내 |
| `GET    /api/profile/[userId]` | 프로필 조회 (cache TTL 1h) |
| `GET    /api/feed/[userId]?limit=` | RSS·카탈로그 기반 피드 (cache TTL 30min) |
| `GET    /api/explore?cursor=&limit=` | 공개 프로필 목록 (cache TTL 5min, cursor pagination) |
| `POST   /api/follow/[userId]` / `DELETE` | 팔로우/언팔로우 |
| `GET    /api/compare?a=&b=` | 두 알고리즘 비교 데이터 |
| `POST   /api/profile/visibility` | 본인 프로필 공개/비공개 토글 |

## 디렉토리

```
jhs/
├── app/
│   ├── globals.css, layout.tsx, page.tsx
│   ├── dashboard/ explore/ compare/ profile/[userId]/ discover/
│   └── api/auth/[...nextauth]/ sync(410)/ profile/[userId]/ profile/visibility/
│        feed/[userId]/ explore/ follow/[userId]/ compare/ channels/recommend/
│        clusters/ clusters/[id]/ similar/
├── components/
│   ├── ui/                     button card badge avatar separator
│   ├── category-radar / category-bar / channel-list / keyword-cloud
│   ├── video-grid / follow-button / sync-button(→/onboard) / visibility-toggle
│   ├── sign-in-button / sign-out-button / site-nav / channel-recommendations
├── lib/
│   ├── prisma, auth, types, utils, cache, keys
│   ├── profile-service, feed-builder, profiler
│   ├── classify (lexicon 기반 분류기, word-boundary 지원)
│   ├── category-utils, channel-features, channel-service
│   ├── kmeans, channel-recommender
│   ├── sources/                ← 신규 (key 0 데이터 소스 추상화)
│   │   ├── rss.ts              RSS feed (channel/playlist) + extractChannelId/extractPlaylistId
│   │   ├── oembed.ts           영상 단건 메타 보강
│   │   ├── catalog.ts          DB 검색·필터 (LIKE / 카테고리 / 키워드)
│   │   └── index.ts            channelUploads / videosByKeyword / videosByCategory
│   └── _archive/               ← YouTube Data API 의존 코드 보존 (참고용)
│       └── youtube.ts, sync-service.ts
├── data/
│   ├── seed-channels.json      1,460+ 큐레이션 시드 (Playboard 14 카테고리)
│   └── category-lexicon.ko.yaml 한국어 → 카테고리 사전
├── prisma/schema.prisma        Channel, ChannelCluster, AlgoProfile, OnboardInput, …
└── scripts/                    catalog-seed, channels-cluster, import-external-dump,
                                reclassify-catalog, resolve-channel-ids,
                                resolve-all-categories, merge-resolved,
                                verify-dump-rss, _archive_*
```

## YouTube API 의존 제거 (2026-05)

원래 `youtube.readonly` OAuth 토큰으로 사용자 구독·좋아요·시청기록을 직접 fetch 했지만, quota 제약과 운영 부담 때문에 다음 구조로 전환:

| 원본 호출 | 대체 |
|---|---|
| `subscriptions.list` / `videos.list(myRating=like)` / `activities.list` / `playlists.list` | 사용자 폼 입력 (`/onboard` Phase 3) — 채널 선택 / 카테고리 체크 / 공개 플레이리스트 URL |
| `channels.list` / `videoCategories.list` | 정적 카탈로그 (`Channel` 테이블) + `lib/classify.ts` |
| `search.list` | `lib/sources/catalog.ts` LIKE 검색 + RSS 폴백 |
| `videos.list(chart=mostPopular)` | `videosByCategory` — 카탈로그 top 채널의 RSS |
| `playlistItems.list` (uploads) | `youtube.com/feeds/videos.xml?channel_id=…` |

영향:
- API key·OAuth scope 모두 제거. 운영 비용·quota 0
- `lib/youtube.ts`, `lib/sync-service.ts` → `lib/_archive/` 이동 (참고용 보존)
- `/api/sync` 는 410 Gone + `/onboard` 안내 placeholder
- 사용자 데이터 부재 (구독·좋아요) → 정확도는 사용자 자기선언 폼에 의존. 대신 카탈로그·분류기·클러스터링으로 추천 신뢰도 보완

## 채널 클러스터링 & 추천 (`report/week12/조현성/channel_analyze_plan.md`)

```
사용자 categories (AlgoProfile)
   │ lib/channel-recommender.ts
   │
   ▼
ChannelCluster.centroid 와 코사인 유사도 → 클러스터 배정 (+ 2순위 후보)
   │
   ▼
미구독 채널을 0.8·profileSimilarity + 0.1·metricMatch + 0.1·popularity 로 랭킹
   (이미 구독한 채널 = AlgoProfile.subscribedChannelIds 로 제외)
   │
   ▼
/api/channels/recommend  →  /discover 페이지
```

`channels-cluster.ts` 의 best-k 자동 선정 (실루엣) 결과 현재 k=16.

| 구성 | 위치 |
|---|---|
| 분류기 | `lib/classify.ts` + `data/category-lexicon.ko.yaml` |
| 피처 벡터화 + 한국 채널 판정 | `lib/channel-features.ts` |
| DB I/O (JSON↔String, BigInt) | `lib/channel-service.ts` |
| k-means++ / 실루엣 / best-k | `lib/kmeans.ts` |
| 추천 (배정 + 랭킹) | `lib/channel-recommender.ts` |
| API | `/api/channels/recommend`, `/api/clusters`, `/api/clusters/[id]` |
| UI | `app/discover/page.tsx` + `components/channel-recommendations.tsx` |

## plan.md 와의 대응표

| plan 항목 | 구현 위치 |
|---|---|
| §Phase 1 OAuth + 시청 정보 수집 | `lib/auth.ts` (식별만), `/onboard` 폼 *(Phase 3 예정)* |
| §Phase 1 공개/비공개 토글 | `components/visibility-toggle.tsx` + `/api/profile/visibility` |
| §Phase 2 타인 알고리즘 피드 | `lib/feed-builder.ts` + `lib/sources/*` + `app/profile/[userId]/page.tsx` |
| §Phase 2 "XXX의 알고리즘으로 보기" | profile/[userId] 페이지의 하단 VideoGrid |
| §Phase 2 팔로우 | `/api/follow/[userId]` + `components/follow-button.tsx` |
| §Phase 3 알고리즘 비교 시각화 | `app/compare/page.tsx` + `components/category-radar.tsx` |
| §주요 제약 / API 쿼터 | YouTube Data API 의존 제거로 quota 0 |
| §Step 8 시각화 (recharts) | `components/category-radar.tsx`, `category-bar.tsx`, `keyword-cloud.tsx` |

## 다음 단계

- **Phase 3 `/onboard` 폼** — 3단계 폼 (채널 선택 + 카테고리 체크 + 공개 플레이리스트 URL) → `AlgoProfile` 생성. 폼 검색은 `lib/sources/catalog.ts` 의 카탈로그 LIKE 검색 사용.
- **lexicon 보강 — 임베딩 기반 분류기 추가** (현 lexicon 평균 적중률 43.6%, Entertainment·People & Blogs·Comedy 가 약함). `transformers.js` 다국어 임베딩으로 미래 작업.
- **카탈로그 주간 갱신 자동화** (Vercel Cron) — `npm run catalog:seed` 를 주 1회 RSS 재수확.
- **한국어 형태소 분석** (`mecab-ko` 등) — 공백/기호 토큰화의 한계 극복.
- **클러스터 2D 맵** (PCA/t-SNE 산점도 + 사용자 위치).
