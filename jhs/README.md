# yt-algo-share

`report/week09/조현성/plan.md` 의 사양을 구현한 풀스택 데모.

**YouTube Data API key 없이 동작** — RSS·oEmbed·정적 카탈로그만 사용. 자세한 마이그레이션 이력은 아래 [YouTube API 의존 제거](#youtube-api-의존-제거-2026-05) 절 참고.

---

## 로컬 DB 카탈로그 (2026-05)

YouTube Data API 호출 없이 한국 인기 채널 ~2,200개를 직접 수집·분류·클러스터링해 `Channel` 테이블에 적재. 피드·검색·추천 전부 이 카탈로그 위에서 동작하며, 외부 호출은 채널별 RSS feed 만 사용 (key 0, 공식 endpoint).

### 1. 수집 — 어디서 왔는가

| 출처 | 채널 수 | 비고 |
|---|---|---|
| **Playboard 14 카테고리 × top100** | 1,400 → 1,367 해결 | 사용자가 카테고리별 top100 이름 리스트 제공, 우리가 channelId 해결 |
| **외부 SQL 덤프** (`dump.sql`) | 910 | 다른 사람이 그쪽 환경에서 우리 channels-collect 로 만든 결과를 import |
| **중복 제거 후 합산** | **2,194** | 510 채널이 양쪽에 모두 있음 |

#### Playboard top100 처리 흐름

```
top100.txt (사용자 paste, 14 카테고리)
   │
   │  scripts/resolve-all-categories.ts
   │   ├─ Playboard 카테고리 헤더로 분할
   │   ├─ 각 채널 이름 → youtube.com/results?search_query=... HTML 호출
   │   ├─ ytInitialData JSON 안의 channelRenderer 에서 (channelId, title) 추출
   │   └─ 입력 이름과 응답 title 의 looseMatch 검사 (오탐 방지)
   │
   ▼
/tmp/resolved-by-cat/<category>.json 14개
   │
   │  scripts/merge-resolved.ts
   ▼
data/seed-channels.json  (1,460+ 엔트리)
```

**rate-limit 회피 전략** — YouTube 검색 페이지는 짧은 간격으로 연속 호출하면 빈 ytInitialData 를 돌려준다. 안전 페이싱:

- 요청 간 5~9초 + jitter
- `CONSENT=YES+1; SOCS=CAI` 쿠키로 EU consent 다이얼로그 우회
- 매 20건마다 75초 burst pause
- 동시 요청 1 (concurrency 1)
- 빈 응답 시 8초 후 1회 retry

위 설정으로 **1,400건 / 약 4시간 / rate-limit 0건**, 자동 매칭 정확도 **97.6%** (1,367/1,400 ok, miss 5, low-conf 28).

#### 외부 dump.sql import

```
dump.sql (910 INSERT INTO Channel)
   │
   │  scripts/verify-dump-rss.ts (샘플 10건 RSS 호출 → 실재 검증)
   │  → 10/10 OK, title match 100%
   │
   │  scripts/import-external-dump.ts
   │   ├─ subscriberCount / viewCount / videoCount / handle / description 그대로 유지
   │   ├─ categories 는 우리 classify() 로 재계산 (Wikidata namespace 폐기)
   │   └─ Channel.upsert(source='external-dump')
   ▼
+406 신규  /  +504 기존 row 메타 보강 (resolver 적재분과 충돌 없이 머지)
```

### 2. 분류 — categories 어떻게 채워졌나

`lib/classify.ts` 가 채널의 `title + description + keywords` 합본 텍스트를 lexicon 매칭해 categories 벡터 산출.

```
text 입력
   │
   ▼
data/category-lexicon.ko.yaml  (한국어 키워드 → 15 카테고리)
   │
   ├─ 한글 키워드: substring 매칭 (예: "먹방", "축구")
   ├─ 짧은 영문/숫자 키워드(≤4자): word-boundary 매칭
   │   └─ "lol" 이 "lollipop" 에 substring 매치되는 사고 방지
   ├─ alias 처리: "Food" → "Howto & Style" 50% + "People & Blogs" 50%
   └─ normalizeTopN(scores, 10) → 0-100 백분율
   │
   ▼
{ "Gaming": 45, "Entertainment": 30, … }
```

YouTube 표준 15 카테고리 namespace 와 1:1 매핑:

| 카테고리 | lexicon 키워드 예 |
|---|---|
| Music | 음악, 노래, 커버, kpop, official mv, 뮤직비디오 |
| Gaming | 게임, 공략, 롤, lck, 마인크래프트, 스트리머 |
| Comedy | 코미디, 개그, 병맛, 패러디, 피식대학, 빠더너스 |
| Entertainment | 예능, 워크맨, 런닝맨, 무한도전, 유퀴즈, 라디오스타 |
| Food *(alias)* | 먹방, 맛집, 요리, 레시피, 백종원 → Howto/People 분산 |
| Howto & Style | 뷰티, 메이크업, 패션, 하울, diy, 스킨케어 |
| Science & Technology | ai, it, 테크, 갤럭시, 아이폰, 코딩, 신기술 |
| Education | 강의, 수능, lecture, ted, 핑크퐁, 뽀로로 |
| News & Politics | 뉴스, 정치, 시사, 경제, 주식, 부동산 |
| Sports | 축구, 야구, 농구, 골프, ufc, lck, kbo |
| People & Blogs | 브이로그, vlog, 일상, 데일리 |
| Travel & Events | 여행, 관광, 캠핑, 백패킹 |
| Film & Animation | 영화, 예고편, 애니메이션, 단편 |
| Autos & Vehicles | 자동차, 테슬라, 시승, 오토바이 |
| Pets & Animals | 반려견, 강아지, 고양이, 수의사, 댕댕이, 집사 |
| Nonprofits & Activism | 교회, 예배, 성경, 스님, 비영리, ngo, 기독교방송 |

**lexicon 튜닝 이력** — 초기 적중률 측정 후 두 차례 보강:

| 카테고리 | 튜닝 전 | 보강 후 | 비고 |
|---|---|---|---|
| Nonprofits & Activism | 0.0% | **38.4%** | lexicon 누락 → 신규 섹션 추가 (가장 큰 개선) |
| News & Politics | 84.7% | 62.2% | 일부 회귀 (다른 카테고리 강화의 부작용) |
| Pets & Animals | 74.2% | 67.0% | 회귀 |
| Sci&Tech | 75.5% | 64.9% | 회귀 |
| Autos & Vehicles | 76.8% | 56.6% | 회귀 |
| People & Blogs | 65.6% | 26.0% | 가장 큰 회귀 — Entertainment 키워드 over-reach |
| Entertainment | 25.8% | 19.6% | broad 키워드 정리 후 더 떨어짐 |

→ 평균 적중률 43.6%. lexicon 만으로는 본질적 한계 명확 (방송사·블로그처럼 description 시그널 약한 카테고리). Phase 4 미래 작업: **임베딩 기반 분류기** (`transformers.js` 다국어 e5 등). 단, 현재 적중률이 추천 알고리즘 동작을 막지는 않음.

### 3. 메타데이터 — RSS 가 못 채우는 값들

| 필드 | 출처 | 비고 |
|---|---|---|
| `id`, `title` | RSS + 검색 응답 모두 | 양쪽 검증됨 |
| `description`, `keywords` | RSS feed entry / dump | RSS 에서 채널 자체 description 못 받아옴 → dump 가 더 풍부 |
| `subscriberCount` | dump 만 | YouTube 가 RSS·oEmbed 어디서도 노출 안 함. dump 없는 채널은 0 |
| `viewCount` | dump 만 | 위와 동일 |
| `videoCount` | dump / RSS feed 길이 | RSS 는 최근 15개만 — 정확하지 않음 |
| `thumbnail` | dump (`yt3.ggpht.com/...`) / RSS media:thumbnail | 양쪽 동등 |
| `handle` (`@name`) | dump | RSS 응답엔 없음 |
| `metrics.uploadsPerMonth` | RSS publishedAt 분포 추정 | 최근 15개 게시 간격 → 월간 빈도 |

`subscriberCount`/`viewCount` 가 dump 의 가장 큰 가치 — RSS·oEmbed 어디에도 노출 안 되는 값이라 510개 겹치는 채널은 dump 가 보강함.

### 4. 클러스터링 — k-means + 실루엣

```
listAllChannels(isKorean=true)
   │  필터: categories 비어있지 않은 채널만 (2,179)
   │
   ▼
모든 채널 카테고리 벡터의 union → 전역 vocabulary
   │
   ▼
각 채널을 sparse 벡터 → L2 정규화
   │
   ▼
k = 6..20 각각에 대해 k-means++ 초기화 → 수렴까지 반복
   │
   ▼
실루엣 점수 최고인 k 선택
   │
   ▼
ChannelCluster 16개 (centroid: { name: weight })
```

best-k = **16**, silhouette **0.434**.

| Cluster 라벨 (top-2 카테고리) | 크기 |
|---|---|
| Gaming · Music | 258 |
| Science & Technology · Autos & Vehicles | 230 |
| Howto & Style · People & Blogs | 230 |
| News & Politics · Science & Technology | 207 |
| Music · Science & Technology | 167 |
| People & Blogs · Howto & Style | 141 |
| Film & Animation · Science & Technology | 131 |
| Pets & Animals · People & Blogs | 108 |
| Autos & Vehicles · Science & Technology | 108 |
| Comedy · Gaming | 107 |
| Education · News & Politics | 107 |
| Entertainment · Gaming | 99 |
| Sports · Autos & Vehicles | 85 |
| Travel & Events · Autos & Vehicles | 82 |
| Travel & Events · People & Blogs | 66 |
| Nonprofits & Activism · Music | 53 |

centroid 는 `{ name: weight }` 형태로 저장돼 사용자 `AlgoProfile.categories` 와 동일 namespace 코사인 비교 가능 → `/api/channels/recommend` 가 RSS 호출 0 으로 동작.

### 5. 현재 DB 상태 한눈에

| 테이블 | 행 수 | 비고 |
|---|---|---|
| `Channel` | **2,244** | seed 1,284 + external-dump 910 + legacy mock 50 |
| `ChannelCluster` | 16 | silhouette 0.434 |
| `Channel` with `clusterId != NULL` | 2,179 | 65개는 categories 비어 클러스터 미배정 |
| `Channel` 중 `subscriberCount > 0` | 910 | dump 출처 channel 만 |
| `OnboardInput` | 0 | Phase 3 onboard 폼 입력 대기 |
| `AlgoProfile` | 0 | 위와 동일 |

---

## YouTube API 의존 제거 (2026-05)

원래 `youtube.readonly` OAuth 토큰으로 사용자 구독·좋아요·시청기록을 직접 fetch 했지만, quota 제약·운영 부담·사용자 토큰 보안 부담 때문에 다음 구조로 전환.

| 원본 호출 | 대체 |
|---|---|
| `subscriptions.list` / `videos.list(myRating=like)` / `activities.list` / `playlists.list` | 사용자 폼 입력 (`/onboard` Phase 3 예정) — 채널 선택 / 카테고리 체크 / 공개 플레이리스트 URL |
| `channels.list` / `videoCategories.list` | 정적 카탈로그 (`Channel` 테이블) + `lib/classify.ts` |
| `search.list` | `lib/sources/catalog.ts` LIKE 검색 + RSS 폴백 |
| `videos.list(chart=mostPopular)` | `videosByCategory` — 카탈로그 top 채널의 RSS |
| `playlistItems.list` (uploads) | `youtube.com/feeds/videos.xml?channel_id=…` |

영향:
- API key·OAuth scope 모두 제거. 운영 비용·quota 0
- `lib/youtube.ts`, `lib/sync-service.ts` → `lib/_archive/` 이동 (참고용 보존)
- `/api/sync` 는 410 Gone + `/onboard` 안내 placeholder
- 사용자 데이터 부재 (구독·좋아요) → 정확도는 사용자 자기선언 폼에 의존. 대신 카탈로그·분류기·클러스터링으로 추천 신뢰도 보완

---

## 데이터 흐름

### 사용자 알고리즘 만들기 (Phase 3 onboard, 예정)

```
사용자 → /onboard 3단계 폼
   │
   ├─ [1] 자주 보는 채널 5~10개 (catalog LIKE 검색으로 선택)
   ├─ [2] 관심 카테고리 3~5개 체크
   └─ [3] (선택) 공개 플레이리스트 URL 1~3개
   │
   ▼
/api/onboard
   ├─ lib/classify.ts 로 키워드/카테고리 정규화
   ├─ OnboardInput 원본 보존 (재계산 가능)
   └─ AlgoProfile upsert (categories / topChannels / topKeywords / sampleVideoIds)
```

### 피드 생성 (plan §Step 7)

```
타인의 AlgoProfile 로드
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

---

## 채널 추천 (`report/week12/조현성/channel_analyze_plan.md`)

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

| 구성 | 위치 |
|---|---|
| 분류기 | `lib/classify.ts` + `data/category-lexicon.ko.yaml` |
| 피처 벡터화 | `lib/channel-features.ts` |
| DB I/O (JSON↔String, BigInt) | `lib/channel-service.ts` |
| k-means++ / 실루엣 / best-k | `lib/kmeans.ts` |
| 추천 (배정 + 랭킹) | `lib/channel-recommender.ts` |
| API | `/api/channels/recommend`, `/api/clusters`, `/api/clusters/[id]` |
| UI | `app/discover/page.tsx` + `components/channel-recommendations.tsx` |
