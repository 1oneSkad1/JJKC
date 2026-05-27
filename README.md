# 📺 JJKC YouTube Algorithm Project

내 유튜브 알고리즘을 분석해 공유하고, 다른 사람의 알고리즘으로 탐색하며, **한국 채널을 클러스터링해 내 취향에 맞는 채널을 추천**하는 서비스입니다.

https://ytalgoshare.vercel.app/

---

## ✅ 진행 상황

### Phase 1–3 — 알고리즘 공유 (완료)
- Google OAuth 로그인 (식별용), 사용자 폼 입력 기반 알고리즘 프로필
- 카테고리 분포 / 대표 채널 / 키워드 / 지표(다양성·Shorts비율·니치도 등) 프로필
- 공개/비공개 토글, 타인 알고리즘 피드(`/profile/[id]`), 비교(`/compare`), 닮은 사용자 추천

### Phase 4 — 채널 클러스터링 & 추천 (완료)
한국 채널(구독자 10만+)을 수집·벡터화·클러스터링해 사용자 알고리즘에 맞는 채널을 추천.
**핵심: 채널을 사용자 프로필과 같은 카테고리 벡터 공간에 올려 기존 `profileSimilarity` 를 재사용 → 추천 서빙 외부 호출 0.**

### Phase 5 — YouTube Data API 의존 제거 + 로컬 DB 카탈로그 구축 (2026-05, 이번 작업)
운영 비용·quota·토큰 보안 부담을 해결하기 위해 YouTube Data API 호출을 모두 제거하고, 사전 큐레이션된 한국 채널 카탈로그 위에서 동작하도록 전환.

**카탈로그 빌드 결과**

| 항목 | 값 |
|---|---|
| 총 채널 | **2,244** (seed 1,284 + external-dump 910 + legacy 50) |
| 이름→channelId 자동 해결 | **1,367 / 1,400** (97.6%, Playboard 14 카테고리 × top100) |
| ChannelCluster | **16** (k-means + 실루엣 0.434) |
| 외부 호출 | RSS feed (`feeds/videos.xml`) 만, key 0 |

**핵심 변경**

| 원본 호출 | 대체 |
|---|---|
| `subscriptions.list` / `videos.list(myRating=like)` / `activities.list` | 사용자 폼 입력 (Phase 3 onboard, 예정) |
| `channels.list` / `videoCategories.list` | 정적 카탈로그 (`Channel` 테이블) + `lib/classify.ts` 분류기 |
| `search.list` | `lib/sources/catalog.ts` DB 검색 + RSS 폴백 |
| `videos.list(chart=mostPopular)` | `videosByCategory` — 카탈로그 top 채널의 RSS |
| `playlistItems.list` (uploads) | `youtube.com/feeds/videos.xml?channel_id=…` |

**파이프라인 한 줄 요약**

```
Playboard top100 paste → resolve-channel-ids.ts (YouTube 검색 HTML 스크랩, 5~9s 페이싱)
   → seed-channels.json 1,460+ → catalog-seed.ts (RSS 적재 + lib/classify.ts 분류)
   → import-external-dump.ts (외부 dump.sql 메타데이터 보강)
   → reclassify-catalog.ts (lexicon 튜닝 후 일괄 재분류)
   → channels-cluster.ts (k-means++ + 실루엣, k=16 자동 선정)
```

자세한 내용 — 수집 전략·rate-limit 회피·lexicon 튜닝 전후 적중률·메타데이터 출처 분석·클러스터 결과·DB 상태 — **[`jhs/README.md`](jhs/README.md)** 참고.
