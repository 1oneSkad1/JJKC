// lexicon 기반 카테고리 분류기.
//
// 입력: 채널 description + 최근 영상 title/description 들의 합본 텍스트.
// 출력: { categories: { [name]: 0-100 }, keywords: string[] }.
//
// AlgoProfile.categories / Channel.categories 와 동일한 namespace 를 쓴다 —
// feed-builder 의 NAME_TO_CATEGORY_ID 와 매칭되는 YouTube 카테고리 이름.
//
// lexicon 의 hintCategory 가 주어지면 약한 prior 로 +가중치를 준다 (사용자
// 선언이지만 자동 분류가 다수결로 이기게 두기 위해 작게).

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { normalizeTopN } from "./category-utils";

type LexEntry = { kw: string; w: number };
type LexAlias = { to: string; w: number };
type Lexicon = {
  byCategory: Record<string, LexEntry[]>;
  aliases: Record<string, LexAlias[]>;
};

const KEYWORD_STOP = new Set([
  "the", "and", "for", "with", "you", "your", "this", "that", "official",
  "channel", "youtube", "subscribe", "video", "videos", "구독", "채널", "영상",
]);
const HINT_WEIGHT = 1.5; // 사용자가 준 hint 의 약한 prior

let cached: Lexicon | null = null;

function loadLexicon(): Lexicon {
  if (cached) return cached;
  const filePath = path.resolve(process.cwd(), "data/category-lexicon.ko.yaml");
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = parseYaml(raw) as Record<string, any>;
  const aliases: Record<string, LexAlias[]> = doc.aliases ?? {};
  const byCategory: Record<string, LexEntry[]> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "aliases") continue;
    if (!Array.isArray(v)) continue;
    byCategory[k] = v as LexEntry[];
  }
  cached = { byCategory, aliases };
  return cached;
}

function tokenize(text: string): string[] {
  return text
    .split(/[\s,./|·#"'`()\[\]{}<>:;!?~\-—]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && !KEYWORD_STOP.has(t));
}

export interface ClassifyInput {
  text: string;                  // description + recent titles 합본
  hintCategory?: string | null;  // seed-channels.json 의 약한 prior
}

export interface ClassifyResult {
  categories: Record<string, number>; // 0-100
  keywords: string[];
}

function bump(map: Record<string, number>, key: string, by: number) {
  map[key] = (map[key] ?? 0) + by;
}

export function classify(input: ClassifyInput): ClassifyResult {
  const { byCategory, aliases } = loadLexicon();
  const lower = input.text.toLowerCase();

  const rawScore: Record<string, number> = {};
  const matchedKeywords = new Set<string>();

  // 1) lexicon 매칭. 짧은 영문/숫자 키워드(≤4자, 한글 없음)는 word boundary
  //    매칭 — "lol" 이 "lollipop" 에 substring 으로 잡히는 사고를 막는다.
  //    한글이 섞인 키워드는 그대로 substring (한국어는 토큰화 없이도 잘 맞음).
  for (const [cat, entries] of Object.entries(byCategory)) {
    for (const e of entries) {
      const kw = e.kw.toLowerCase();
      if (!kw) continue;
      const hasHangul = /[가-힣]/.test(kw);
      const useBoundary = !hasHangul && kw.length <= 4;
      const matched = useBoundary
        ? new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "u").test(lower)
        : lower.includes(kw);
      if (matched) {
        bump(rawScore, cat, e.w);
        matchedKeywords.add(kw);
      }
    }
  }

  // 2) hintCategory 약한 prior.
  if (input.hintCategory && byCategory[input.hintCategory]) {
    bump(rawScore, input.hintCategory, HINT_WEIGHT);
  }

  // 3) alias 매핑 (Food → Howto & Style / People & Blogs 분산).
  const aliased: Record<string, number> = {};
  for (const [cat, score] of Object.entries(rawScore)) {
    const al = aliases[cat];
    if (al) {
      for (const a of al) bump(aliased, a.to, score * a.w);
    } else {
      bump(aliased, cat, score);
    }
  }

  // 4) 0-100 정규화 (top 10).
  const categories = normalizeTopN(aliased, 10);

  // 5) keywords: lexicon hit + 일반 토큰 빈도 (lexicon hit 우선).
  const freq: Record<string, number> = {};
  for (const t of tokenize(input.text)) bump(freq, t, 1);
  const keywords = [
    ...matchedKeywords,
    ...Object.entries(freq)
      .filter(([k]) => !matchedKeywords.has(k))
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k),
  ].slice(0, 12);

  return { categories, keywords };
}
