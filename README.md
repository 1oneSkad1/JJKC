# yt-algo-share

`report/week09/조현성/plan.md` 의 사양을 그대로 구현한 풀스택 데모.

## 무엇이 들어 있는가

| 영역 | 구현 |
|---|---|
| Frontend | Next.js 15 App Router + React 19 (RSC) |
| Style | Tailwind CSS + shadcn 스타일 UI primitive 직접 작성 (`components/ui/*`) |
| Auth | NextAuth v5 + Google OAuth + PrismaAdapter, `youtube.readonly` scope |
| DB | Prisma + SQLite (개발 즉시 실행 가능). Postgres/Neon 으로 전환은 `prisma/schema.prisma` 의 provider 변경 + Json/String[] 마이그레이션. |
| Cache | `lib/cache.ts` — 기본 in-memory, `UPSTASH_REDIS_REST_URL/TOKEN` 환경변수 있으면 자동 Upstash. |
| YouTube | googleapis v3 (`subscriptions`, `videos` (myRating=like), `channels`, `videoCategories`, `playlistItems`, `search`) |
| Charts | recharts (radar / bar) + keyword cloud |

## 실행

```bash
cd main
npm install
npx prisma migrate dev   # 이미 했다면 생략
npm run dev
# http://localhost:3000
```

`.env` (이미 프로젝트 루트의 `.env` 가 자동으로 읽힘):

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

Google OAuth Console 의 redirect URI 에 `http://localhost:3000/api/auth/callback/google` 추가, YouTube Data API v3 활성화 필수.

## 데이터 흐름 (plan §Step 4 그대로)

```
사용자 로그인 (OAuth)                 ← NextAuth/Google
   │
   ▼
/api/sync 호출                        ← components/sync-button.tsx
   │
   ├─ getVideoCategories(token)       categoryId → name 매핑
   ├─ getSubscriptions(token)         구독 채널
   ├─ getLikedVideos(token)           좋아요 영상
   ├─ getChannels(token, channelIds)  topicDetails / statistics
   │
   ▼
profiler.generateProfile               ← lib/profiler.ts
   │
   ├─ categories: 좋아요(×5) + 구독 topic(×2) → 정규화 0-100
   ├─ topChannels: snippet/statistics 추림 (최대 10)
   ├─ topKeywords: 좋아요 영상 tags 빈도순 (최대 12)
   └─ sampleVideoIds: 좋아요 영상 ID (최대 20)
   │
   ▼
AlgoProfile DB upsert + cache invalidate (TTL: profile 1h)
```

## 피드 생성 (plan §Step 7)

```
타인의 AlgoProfile 로드
   │
   ├─ topChannels (30%) → playlistItems.list  (uploads playlist)
   ├─ topKeywords (40%) → search.list         (각 키워드별)
   └─ categories  (30%) → videos.list chart=mostPopular videoCategoryId
   │
   ▼
중복 제거 + round-robin 인터리브 → 최종 N개
   │
   ▼
YouTube watch 링크 (썸네일 + 클릭 → youtube.com/watch?v=...)
```

호출자(viewer)의 OAuth 토큰으로 YouTube 를 친다 — 따라서 "타인의 알고리즘으로 보기" 가 viewer 자신의 quota 를 소모한다. plan §주요 제약의 quota 관리는 `lib/cache.ts` 의 `TTL.feed = 30 min` 으로 완화.

## 페이지 (plan §Step 6 그대로)

| URL | 내용 |
|---|---|
| `/` | 랜딩 + Google 로그인 |
| `/dashboard` | 내 알고리즘 카드 + 카테고리 차트 + 채널/키워드 + 본인 피드 + Sync/공개토글 |
| `/explore` | 공개 프로필 카드 목록 |
| `/profile/[userId]` | 타인 프로필 상세 + 그 사람 알고리즘 기반 피드 + Follow |
| `/compare?a=&b=` | 두 알고리즘 카테고리 분포 오버레이 (radar) + 공유 키워드 |

## API (plan §Step 5 + visibility)

| 메서드 + 경로 | 동작 |
|---|---|
| `GET    /api/auth/[...nextauth]` | NextAuth 핸들러 |
| `POST   /api/sync` | YouTube → profiler → DB upsert (캐시 무효화) |
| `GET    /api/profile/[userId]` | 프로필 조회 (cache TTL 1h) |
| `GET    /api/feed/[userId]?limit=` | 알고리즘 기반 피드 (cache TTL 30min) |
| `GET    /api/explore?cursor=&limit=` | 공개 프로필 목록 (cache TTL 5min, cursor pagination) |
| `POST   /api/follow/[userId]` / `DELETE` | 팔로우/언팔로우 (self/private/not_found 가드) |
| `GET    /api/compare?a=&b=` | 두 알고리즘 비교 데이터 |
| `POST   /api/profile/visibility` | 본인 프로필 공개/비공개 토글 |

## 디렉토리

```
main/
├── app/
│   ├── globals.css, layout.tsx, page.tsx
│   ├── dashboard/ explore/ compare/ profile/[userId]/
│   └── api/auth/[...nextauth]/ sync/ profile/[userId]/ profile/visibility/
│        feed/[userId]/ explore/ follow/[userId]/ compare/
├── components/
│   ├── ui/                     button card badge avatar separator
│   ├── category-radar / category-bar / channel-list / keyword-cloud
│   ├── video-grid / follow-button / sync-button / visibility-toggle
│   ├── sign-in-button / sign-out-button / site-nav
├── lib/
│   ├── prisma, auth, types, utils
│   ├── cache (memory + Upstash adapter)
│   ├── profile-service, sync-service, feed-builder
│   ├── youtube, profiler, keys
├── prisma/schema.prisma + migrations/
└── package.json / tsconfig / tailwind / postcss / next.config
```

## plan.md 와의 대응표

| plan 항목 | 구현 위치 |
|---|---|
| §Phase 1 OAuth + 시청 정보 수집 + 공개 프로필 | `lib/auth.ts`, `lib/sync-service.ts`, `lib/profiler.ts`, `app/dashboard/page.tsx` |
| §Phase 1 공개/비공개 토글 | `components/visibility-toggle.tsx` + `/api/profile/visibility` |
| §Phase 2 타인 알고리즘 피드 | `lib/feed-builder.ts` + `app/profile/[userId]/page.tsx` |
| §Phase 2 "XXX의 알고리즘으로 보기" | profile/[userId] 페이지의 하단 VideoGrid |
| §Phase 2 팔로우 | `/api/follow/[userId]` + `components/follow-button.tsx` |
| §Phase 3 알고리즘 비교 시각화 | `app/compare/page.tsx` + `components/category-radar.tsx` |
| §주요 제약 / API 쿼터 | `lib/cache.ts` TTL + per-(viewer,target) feed 캐시 |
| §주요 제약 / 토큰 보안 | 평문 저장 (데모). 운영 시 AES-256 적용 자리표시 |
| §Step 8 시각화 (recharts) | `components/category-radar.tsx`, `category-bar.tsx`, `keyword-cloud.tsx` |

## 다음 단계 (plan §확장 가능성)

- 토큰 AES-256 암호화 wrapper (`lib/crypto.ts` 추가 자리)
- Postgres/Neon 으로 전환 시: `schema.prisma` provider + Json/String[] 사용 + 새 migration
- Upstash 자격증명만 추가하면 cache 가 자동 분산형
- shadcn registry 의 더 많은 컴포넌트 (dropdown, dialog 등) 필요 시 `components/ui/` 에 추가
