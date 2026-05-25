# 한국 유튜브 채널 클러스터링 & 알고리즘 기반 채널 추천 — 구현 계획

> 한국 채널 ~1,000개(구독자 ≥ 10만)를 수집·벡터화·클러스터링하고,
> 사용자의 기존 `AlgoProfile` 벡터로 (a) 가장 가까운 **클러스터에 배정**하고
> (b) 미구독 채널을 **유사도 순으로 랭킹 추천**하는 기능을 `jhs/` 앱에 추가한다.
>
> 결정 사항(2026-05-26):
> - 저장: **Prisma 신규 테이블** (기존 앱 DB에 통합)
> - 클러스터링: **순수 TypeScript** (scripts/ 배치 + npm run)
> - 추천 형태: **클러스터 배정 + 개별 채널 랭킹 둘 다**

---

## 0. 핵심 아이디어 — "채널과 사용자는 같은 벡터 공간에 있다"

기존 `profiler.ts` 가 만드는 사용자 `AlgoProfile` 은
`{ categories: {name→0-100}, topKeywords: string[], metrics }` 구조다.
채널도 `channels.list` 의 `topicDetails.topicCategories`(Wikidata 토픽) +
`brandingSettings.channel.keywords` + 최근 업로드의 `videoCategoryId` 로
**동일한 형태의 벡터**를 만들 수 있다.

→ 두 벡터가 같은 namespace 에 놓이므로, 이미 있는
`cosineSimilarity` / `jaccardSimilarity` / `profileSimilarity`
(`jhs/lib/profiler.ts:385~425`)를 **그대로 재사용**해서

```
추천 = "사용자 벡터에 가장 가까운 채널 / 클러스터 찾기"
```

로 환원된다. 그리고 채널 카탈로그·클러스터는 배치로 미리 만들어 DB에 두므로,
**추천 서빙 시 YouTube API 호출 = 0u** 다 (기존 피드 ~409u/회와 대비되는 가장 큰 이점).

### 0.1 카테고리 namespace 정렬 (중요)

`profiler` 의 `categoryScore` 는 **두 출처**가 섞인다:

| 출처 | 예시 이름 | 채널에서 얻는 법 |
|---|---|---|
| 좋아요 영상의 `videoCategoryId` → 이름 | `Music`, `Gaming`, `Education` | 채널 단독으론 **없음** → 최근 업로드 보강 필요 |
| `topicDetails.topicCategories` (Wikidata) | `Music`, `Hip hop music`, `Video game culture` | `channels.list` topicDetails 에 바로 있음 |

채널을 `topicCategories` 만으로 벡터화하면 사용자 벡터의 `videoCategory` 축과
정렬이 어긋난다. 따라서 **채널 수집 시 최근 업로드 N개의 `videoCategoryId` 를
보강**해 같은 이름 축을 채운다(§2). 비용을 아끼려면 topic-only 모드로 떨어뜨릴 수
있으나, 정렬 품질이 떨어진다는 트레이드오프를 명시한다.

---

## 1. 데이터 모델 — Prisma 신규 테이블

기존 SQLite 관례(JSON 컬럼이 없어 `String` 직렬화, `lib/*-service.ts` 가
parse/stringify 담당)를 그대로 따른다.

```prisma
// jhs/prisma/schema.prisma 에 추가

model Channel {
  id              String   @id            // YouTube channelId (UC...)
  title           String
  handle          String?                 // @handle
  thumbnail       String
  description     String?

  subscriberCount Int
  videoCount      Int
  viewCount       BigInt   @default(0)
  country         String?                 // snippet.country (자주 null)
  isKorean        Boolean  @default(true) // 휴리스틱 판정 결과(§1.2)

  // 벡터 (AlgoProfile 와 동일 직렬화 규약)
  categories      String   // JSON: { name: 0-100 }
  keywords        String   // JSON: string[]
  metrics         String?  // JSON: { mainstreamScore, nicheScore, uploadsPerMonth }

  clusterId       Int?
  cluster         ChannelCluster? @relation(fields: [clusterId], references: [id])

  source          String   @default("seed") // seed|trending|search|snowball (수집 출처)
  fetchedAt       DateTime @default(now())
  refreshedAt     DateTime @updatedAt

  @@index([clusterId])
  @@index([subscriberCount])
  @@index([isKorean])
}

model ChannelCluster {
  id            Int      @id @default(autoincrement())
  label         String              // 자동 라벨(top-2 카테고리) — 수기 수정 가능
  centroid      String              // JSON: { name: weight } 정규화 카테고리 벡터
  topCategories String              // JSON: [{name, weight}]
  topKeywords   String              // JSON: string[]
  size          Int      @default(0)
  color         String?             // 시각화용
  channels      Channel[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// 수집을 며칠에 걸쳐 재개 가능하게 하는 상태(쿼터 분산)
model CollectionRun {
  id          Int      @id @default(autoincrement())
  status      String   @default("running") // running|paused|done
  acceptedN   Int      @default(0)
  frontier    String   @default("[]")      // JSON: 미탐색 channelId 큐(snowball)
  quotaSpent  Int      @default(0)
  startedAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

추천에서 "이미 구독한 채널 제외"를 하려면 사용자가 구독한 channelId 가 필요하다.
sync 단계에서 이미 `subscriptions.list` 를 부르므로(추가 쿼터 0) `AlgoProfile` 에
한 컬럼만 더한다:

```prisma
model AlgoProfile {
  // ...기존 필드...
  subscribedChannelIds String @default("[]") // JSON: string[]  (추천 제외용)
}
```

> `BigInt`(viewCount)는 Prisma+SQLite 에서 지원되나 JSON 직렬화 시 `toString()`
> 처리 필요 — `channel-service` 에서 흡수. 부담되면 `Int` + clamp 도 무방.

`npm run db:push` 로 반영.

---

## 2. Phase 1 — 채널 수집 파이프라인 (`scripts/channels-collect.ts`)

### 2.1 근본 제약: "지역·구독자순 채널 목록" API 가 없다

YouTube Data API 에는 채널을 region/구독자수로 브라우즈하는 엔드포인트가 없다.
따라서 **seed → enrich → filter → snowball BFS** 로 1,000개를 모은다.

```
seed channelId 수집 (싸게 먼저)
  ① videos.list chart=mostPopular regionCode=KR  (videoCategory 15종 × 페이지)
       → 트렌딩 영상의 channelId  (≈ 1u/페이지, 메인스트림 커버)
  ② search.list type=channel regionCode=KR relevanceLanguage=ko q=<토픽 목록>
       → 토픽별 상위 채널  (★ 100u/페이지 — 가장 비쌈, 제한적으로만)
        토픽 예: 예능 게임 먹방 브이로그 뷰티 IT 음악 키즈 스포츠 교육 주식 여행 …
        │
        ▼
enrich:  channels.list?id=<50개 batch>                       (1u / 50개)
           part = snippet, statistics, topicDetails,
                  brandingSettings, contentDetails(uploads playlist)
        + 최근 업로드 보강(§0.1):
           playlistItems.list(uploads, 10개) + videos.list?id=… (각 1u)
        │
        ▼
filter:  subscriberCount ≥ 100_000  AND  isKorean(channel)   (§1.2)
        │
        ▼
upsert Channel  +  snowball:
           channelSections.list?channelId=<수락된 채널>       (1u)
             → featuredChannelsUrls("추천 채널") 를 frontier 에 push
        │
        ▼
BFS 반복: |accepted| ≥ 1000 또는 frontier 소진 또는 일일 쿼터 한도까지
           → CollectionRun 에 frontier/quotaSpent 저장(다음 날 재개)
```

`lib/youtube.ts` 의 `getChannels`, `getChannelUploads`, `searchVideos`,
`getPopularByCategoryId` 를 재사용하고, **`searchChannels`(type=channel)**,
**`getChannelSections`** 두 verb 만 thin wrapper 로 추가한다.

### 2.2 한국 채널 판정 휴리스틱 `isKorean(channel)`

`snippet.country` 는 자주 null 이라 단독으론 부족. 우선순위 결합:

1. `snippet.country === "KR"` → true (가장 강함)
2. `brandingSettings.channel.country === "KR"` → true
3. 제목+설명의 **한글 음절 비율 ≥ 0.3** → true
4. `defaultLanguage`/업로드 영상 `defaultAudioLanguage` 다수가 `ko` → true
5. 그 외 → false (제외)

> 한계: 영어로 운영하는 한국 채널, 한국어 콘텐츠의 해외 채널은 오분류 가능.
> 임계값은 수집 후 샘플 검수로 조정. 판정 결과를 `Channel.isKorean` 에 박아 두면
> 사후 재필터가 쉬움.

### 2.3 재개 가능성 & 쿼터 분산

`CollectionRun` 에 `frontier`(미탐색 큐)와 `quotaSpent` 를 저장한다. 일일 한도
(10,000u)에 근접하면 `status=paused` 로 멈추고, 다음 날 같은 스크립트가
이어받는다. dedup 은 `Channel.id` upsert 로 자연 보장.

### 2.4 수집 쿼터 예산 (일회성 / 주간 갱신)

| 호출 | 횟수(대략) | 비용 |
|---|---|---|
| mostPopular (15 cat × ~2p) | 30 | ~30u |
| channels.list enrich (후보 ~2,000 / 50) | 40 | ~40u |
| 업로드 보강 playlistItems+videos (채널당 2u) | 1,000ch | ~2,000u |
| channelSections snowball | ~수백 | ~300u |
| search type=channel (보조 seed, 페이지 제한) | 10~30p | 1,000~3,000u ★ |
| **합계** | | **≈ 3,000~5,000u** |

→ `search` 의존을 줄이고 snowball 을 키우면 **하루 안에** 완료 가능.
크게 잡아도 2일 배치면 충분. **이 전부가 오프라인 배치이며 서빙 쿼터는 0**.
업로드 보강을 끄면(topic-only) 2,000u 절감되지만 §0.1 정렬 품질이 떨어진다.

---

## 3. Phase 2 — 피처 엔지니어링 (`lib/channel-features.ts`)

채널 1개의 원시 응답 → `AlgoProfile` 호환 벡터로 변환. `profiler.ts` 의 로직을
재사용하되 채널용으로 가볍게 분리한다.

```
categories(JSON):
   topicDetails.topicCategories       → topicNameFromUrl (+2)
   최근 업로드 videoCategoryId          → 카테고리 이름   (+5, 강신호)
   최근 업로드 topicCategories          → topicName       (+3)
   → 상위 10개 정규화 0-100 (profiler 와 동일 규약)

keywords(JSON):
   brandingSettings.channel.keywords  + 업로드 tags + 제목/설명 토큰
   → TF-IDF 상위 12개 (코퍼스 = 전체 채널)
   → 한국어는 우선 공백/기호 토큰화 (형태소 분석은 §9 향후)

metrics(JSON):
   mainstreamScore  = log10(median 업로드 viewCount) 기반 (profiler 동일식)
   nicheScore       = subscriberCount inverse-log
   uploadsPerMonth  = 최근 업로드 간격 → 활동성
```

> `profiler.ts` 의 `topicNameFromUrl`, `parseIsoDuration`, `entropyScore`,
> 정규화 블록을 공용 util 로 export 해서 채널/사용자가 공유하도록 소폭 리팩터.
> (현재 `topicNameFromUrl` 등은 모듈 private → `lib/category-utils.ts` 로 추출)

**전역 카테고리 vocabulary**: 전체 채널을 훑어 등장한 카테고리 이름 합집합을
정렬된 배열로 만들어 `ChannelCluster` 옆 메타(또는 별도 JSON)로 저장. k-means 는
이 vocab 순서로 dense 벡터를 만든다.

---

## 4. Phase 3 — 클러스터링 (`scripts/channels-cluster.ts`, 순수 TS)

### 4.1 입력 행렬

```
X[i] = 채널 i 의 카테고리 분포를 전역 vocab 차원으로 펼친 dense 벡터
       (+ 옵션: TF-IDF 상위 키워드 몇 축을 가중 결합)
각 행 L2 정규화  → L2 거리 ≈ 코사인 거리 (추천과 같은 척도 유지)
```

### 4.2 알고리즘 (의존성 없이 TS 직접 구현)

```ts
// k-means++ 초기화 → Lloyd 반복
function kmeans(X: number[][], k: number, seed = 42): {
  labels: number[]; centroids: number[][]; inertia: number;
}
// 1,000행 × (수십~수백 차원) → 수 ms~수십 ms. 비용 무시 가능.
```

- **k 선택**: k = 8…24 스윕 → 실루엣 점수(또는 elbow=inertia 변화율) 비교 후
  최고점 채택, 수기 override 허용. 실루엣도 TS 로 직접 계산(코사인 기반).
- **재현성**: 고정 시드(`mulberry32`) 로 결정적 결과.

### 4.3 클러스터 메타 산출 & 영속화

각 클러스터마다:
- `centroid` (정규화 카테고리 벡터, JSON)
- `topCategories` = centroid 상위 가중 카테고리
- `topKeywords` = 멤버 키워드 최빈
- 대표 채널 = centroid 에 가장 가까운 상위 N
- `size`, 자동 `label` = top-2 카테고리(예: "게임 · 예능")

영속화: `ChannelCluster` upsert + 각 `Channel.clusterId` 갱신.
재클러스터링은 멱등(전체 재계산 후 reassign).

실행: `npm run channels:cluster` (수집 후 / 주간 갱신 후 1회).

---

## 5. Phase 4 — 추천 로직 (`lib/channel-recommender.ts`, 서빙 0u)

입력: 사용자 `AlgoProfile`(categories, topKeywords, metrics, subscribedChannelIds).
모두 DB 에 있으므로 **YouTube 호출 없음**.

### 5.1 클러스터 배정 ("당신은 OO 부족")

```
clusterScore(c) = cosineSimilarity(user.categories, c.centroid)
→ 상위 1~2 클러스터 = 사용자가 속한 알고리즘 부족
→ 라벨 + 대표 채널 + 사용자 vs centroid 카테고리 radar 오버레이
```

### 5.2 개별 채널 랭킹

```
후보 = (가까운 클러스터 채널 우선) ∪ 전역 채널
       − user.subscribedChannelIds        // 이미 구독 제외
       − user.topChannels.id

score(ch) = 0.8 · profileSimilarity(user, ch)     // 기존 0.7cos+0.3jac
          + 0.1 · metricMatch(user, ch)           // niche/mainstream 취향 일치
          + 0.1 · qualityPrior(ch)                // log 구독자/활동성 등 약한 prior

→ 상위 N. MMR 류 재랭킹으로 한 클러스터 쏠림 방지(다양성 옵션).
```

`profileSimilarity` 는 `lib/profiler.ts` 의 것을 그대로 호출 → 사용자↔사용자
추천과 동일 척도라 일관성 유지.

### 5.3 콜드 스타트

프로필이 빈약한 신규 사용자(`{ Discovery: 100 }`) → 배정 클러스터의 대표 채널 +
전역 인기(구독자수) 상위로 폴백.

---

## 6. Phase 5 — API & UI

### 6.1 API (기존처럼 thin shell: 권한 → 서비스 함수 → JSON)

| 라우트 | 책임 | 캐시 | 가드 |
|---|---|---|---|
| `GET /api/channels/recommend?userId=` | 클러스터 배정 + 채널 랭킹 | TTL ~1h, key=`rec:userId:lastSyncedAt` | 본인 프로필 필요 |
| `GET /api/clusters` | 클러스터 맵(라벨/크기/topCat) | TTL 길게 | — |
| `GET /api/clusters/[id]` | 클러스터 상세 + 멤버 채널 | TTL 길게 | — |

수집/클러스터링은 사용자 API 로 노출하지 않고 **스크립트(`npm run`)/cron 전용**.

캐시는 기존 `lib/cache.ts`(Memory↔Upstash 자동) 재사용. 추천 캐시 key 에
`lastSyncedAt` 을 박으면 sync 시 자연 무효화(feed-builder 와 동일 패턴).

### 6.2 UI — 신규 페이지 `/discover` (또는 `/channels`)

- **알고리즘 부족 카드**: 배정 클러스터 라벨 + `CategoryRadar` 로 사용자 vs
  centroid 오버레이(기존 `components/category-radar.tsx` 재사용).
- **추천 채널 그리드**: 썸네일·채널명·구독자수·유사도% 배지·"YouTube에서 구독"
  링크. 출처 클러스터 칩 표시.
- **클러스터 맵**: PCA(2D, TS 로 공분산 고유벡터 2개) 또는 간단 산점도로 1,000
  채널 분포 + 사용자 위치 점. (t-SNE/UMAP 는 §9 향후)
- 신규 서버 컴포넌트 `components/channel-recommendations.tsx` —
  `similar-users.tsx` 구조를 그대로 본뜸(서버에서 점수 계산 → 카드 렌더).

---

## 7. Phase 6 — 갱신 & 운영

```
npm run channels:collect   # 수집(재개 가능, 며칠 분산 가능)
npm run channels:cluster   # 클러스터링 + 메타 영속화
```

- 채널 메타데이터(구독자수 등)는 천천히 변함 → **주간 또는 월간** 재수집·재클러스터.
- 자동화: Vercel Cron 또는 레포의 `/schedule` 루틴으로 주 1회. 갱신 후
  추천 캐시는 `lastSyncedAt` 키 무효화로 자연 갱신.
- 운영 비용: 쿼터는 배치(수집)만 소모, 서빙 0u.

---

## 8. 비용 요약 — 왜 이 설계가 싼가

| 동작 | 빈도 | 쿼터 |
|---|---|---|
| 채널 수집(1,000개, 업로드 보강 포함) | 주/월 1회 배치 | ≈ 3,000~5,000u (분산 가능) |
| 클러스터링 | 배치 | **0u** (로컬 계산) |
| **채널 추천 서빙** | 매 요청 | **0u** (DB 벡터 연산만) |
| (대비) 기존 비디오 피드 `buildFeed` | 매 요청(cold) | ~409u |

→ 추천 트래픽이 늘어도 쿼터가 증가하지 않는다. 사용자당 비용이 상수.

---

## 9. 한계 & 다음 한 걸음

| 한계 | 해소 방향 |
|---|---|
| 브라우즈 API 부재 → seed 가 트렌딩/검색에 편향, search 쿼터 큼 | snowball 비중↑, 수기 seed CSV 부트스트랩, 다일 배치 |
| `snippet.country` 자주 null → 한국 판정 불완전 | 한글 비율 + 언어 다수결 휴리스틱, 샘플 검수로 임계값 보정 |
| 채널 단위 `topicCategories` 희소 → 사용자 축과 정렬 약함 | 최근 업로드 `videoCategoryId` 보강(§0.1, +2u/채널) |
| 한국어 토큰화 단순(공백/기호) | 형태소 분석(mecab-ko 등) — 다만 Python 도입 필요, 현 단계는 TS 유지 |
| k 선택 주관성 | 실루엣/elbow 자동 + 수기 라벨 override |
| 구독 전체 제외하려면 channelId 저장 필요 | `AlgoProfile.subscribedChannelIds` 추가(추가 쿼터 0) |
| 추천 다양성 쏠림 | MMR 재랭킹 옵션 |

---

## 10. 기존 코드 재사용 맵

| 신규에서 쓰는 것 | 출처 |
|---|---|
| `cosineSimilarity` / `jaccardSimilarity` / `profileSimilarity` | `jhs/lib/profiler.ts:385~425` |
| `topicNameFromUrl` / `parseIsoDuration` / `entropyScore` / 정규화 | `jhs/lib/profiler.ts` → `lib/category-utils.ts` 로 추출 |
| `getChannels` / `getChannelUploads` / `searchVideos` / `getPopularByCategoryId` | `jhs/lib/youtube.ts` |
| 캐시(Memory↔Upstash) + TTL | `jhs/lib/cache.ts` |
| `CategoryRadar` 시각화 | `jhs/components/category-radar.tsx` |
| 서버 컴포넌트 추천 카드 패턴 | `jhs/components/similar-users.tsx` |
| JSON↔String pack/unpack 규약 | `jhs/lib/profile-service.ts` |

---

## 11. 신규/변경 파일 목록

```
jhs/
├─ prisma/schema.prisma            (변경) Channel, ChannelCluster, CollectionRun
│                                          + AlgoProfile.subscribedChannelIds
├─ lib/
│  ├─ category-utils.ts            (신규) profiler 공용 함수 추출
│  ├─ channel-features.ts          (신규) 채널 원시응답 → 벡터
│  ├─ channel-service.ts           (신규) Channel/Cluster DB pack·unpack I/O
│  ├─ channel-recommender.ts       (신규) 클러스터 배정 + 채널 랭킹
│  └─ youtube.ts                   (변경) searchChannels, getChannelSections 추가
├─ scripts/
│  ├─ channels-collect.ts          (신규) seed→enrich→filter→snowball BFS
│  └─ channels-cluster.ts          (신규) 순수 TS k-means + 메타 영속화
├─ app/
│  ├─ api/channels/recommend/route.ts   (신규)
│  ├─ api/clusters/route.ts             (신규)
│  ├─ api/clusters/[id]/route.ts        (신규)
│  └─ discover/page.tsx                 (신규) 추천 + 클러스터 맵 페이지
├─ components/
│  └─ channel-recommendations.tsx       (신규)
└─ package.json                    (변경) "channels:collect", "channels:cluster"
```

---

## 12. 로드맵

```
Week 1  Prisma 모델 + youtube verb 추가 + 수집 스크립트(재개 가능) → 1,000개 적재
Week 2  channel-features 벡터화 + category-utils 추출 + 순수 TS k-means/실루엣
Week 3  channel-recommender(클러스터 배정 + 랭킹) + recommend API + 캐시
Week 4  /discover UI(추천 그리드 + radar 오버레이 + 클러스터 맵 PCA)
Week 5  갱신 cron + 한국 판정·k 튜닝 + 메커니즘 리포트(report/weekNN)
```

---

## 13. 한 줄 요약

> **채널을 사용자 프로필과 같은 카테고리 벡터 공간에 올려(업로드 보강으로 축 정렬),
> seed+snowball 로 1,000개를 배치 수집하고, 순수 TS k-means 로 클러스터링한 뒤,
> 기존 `profileSimilarity` 로 "가장 가까운 클러스터 배정 + 미구독 채널 랭킹"을
> 서빙 쿼터 0u 로 제공한다.**
