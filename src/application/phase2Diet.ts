import { DietAnalysis } from "../domain/types";

export interface SttTranscript {
  text: string;
  confidence?: number;
}

export interface SttProvider {
  transcribeKorean(audioBase64: string): Promise<SttTranscript>;
}

const riskyKeywords = ["라면", "빵", "케이크", "콜라", "과자", "떡", "면", "주스", "설탕", "국수", "흰쌀", "아이스크림"];
const goodKeywords = ["보리밥", "현미", "채소", "두부", "생선", "나물", "샐러드", "콩", "잡곡", "통곡물"];
const proteinKeywords = ["계란", "닭", "생선", "두부", "콩", "고기"];
const portionHighKeywords = ["많이", "잔뜩", "한가득", "두 그릇", "세 그릇", "추가로", "곱빼기", "대자"];
const denyKeywords = ["안", "못", "없이", "빼고", "아니고"];
const carbKeywords = ["밥", "국수", "면", "빵", "떡", "감자", "고구마", "시리얼"];
const sugaryDrinkKeywords = ["주스", "탄산", "콜라", "라떼", "달달한", "당음료"];

export function normalizeDietSpeech(text: string): string {
  return text
    .trim()
    .replace(/[.,!?]/g, " ")
    .replace(/\s+/g, " ");
}

function countHits(text: string, keywords: string[]): number {
  return keywords.reduce((acc, cur) => (text.includes(cur) ? acc + 1 : acc), 0);
}

function containsNegationNearKeyword(text: string, keyword: string): boolean {
  return denyKeywords.some((deny) => text.includes(`${keyword}${deny}`) || text.includes(`${deny} ${keyword}`));
}

export function analyzeDietText(rawSpeechText: string): DietAnalysis {
  const normalizedText = normalizeDietSpeech(rawSpeechText);
  if (!normalizedText) {
    return {
      rawSpeechText,
      normalizedText,
      glycemicAssessment: "neutral",
      reasons: ["음성 내용이 비어 있어 분석이 어려워요."],
      recommendedActions: ["식사 내용을 다시 천천히 말씀해주세요."],
      confidence: 0.2,
    };
  }

  const riskyHits = riskyKeywords.filter((k) => normalizedText.includes(k) && !containsNegationNearKeyword(normalizedText, k));
  const goodHits = goodKeywords.filter((k) => normalizedText.includes(k) && !containsNegationNearKeyword(normalizedText, k));
  const proteinHits = countHits(normalizedText, proteinKeywords);
  const highPortion = countHits(normalizedText, portionHighKeywords) > 0;

  const riskScore = riskyHits.length * 2 + (highPortion ? 1 : 0) - Math.min(goodHits.length + proteinHits, 2);

  if (riskScore >= 2) {
    return {
      rawSpeechText,
      normalizedText,
      glycemicAssessment: "risky",
      reasons: [
        riskyHits.length ? `당 흡수가 빠른 음식이 포함됐어요 (${riskyHits.join(", ")})` : "섭취량이 많아 혈당 상승 가능성이 있어요.",
      ],
      recommendedActions: ["다음 끼니는 채소와 단백질을 먼저 드시고, 탄수화물 양을 줄여보세요."],
      confidence: 0.82,
    };
  }

  if (goodHits.length > 0 || proteinHits > 0) {
    return {
      rawSpeechText,
      normalizedText,
      glycemicAssessment: "good",
      reasons: ["채소/단백질 중심 식사가 확인돼요."],
      recommendedActions: ["식후 10~20분 가볍게 움직이고 물을 충분히 드세요."],
      confidence: 0.77,
    };
  }

  const carbHits = countHits(normalizedText, carbKeywords);
  const sugaryDrinkHits = countHits(normalizedText, sugaryDrinkKeywords);

  if (carbHits > 0 || sugaryDrinkHits > 0) {
    const inferredRiskScore = carbHits + sugaryDrinkHits + (highPortion ? 1 : 0);
    if (inferredRiskScore >= 2) {
      return {
        rawSpeechText,
        normalizedText,
        glycemicAssessment: "risky",
        reasons: ["일반 식단 표현에서 탄수화물/당음료 섭취가 감지되었어요."],
        recommendedActions: ["식사량을 줄이고 채소·단백질을 먼저 드신 뒤 15분 이상 가볍게 걸어보세요."],
        confidence: 0.68,
      };
    }
    return {
      rawSpeechText,
      normalizedText,
      glycemicAssessment: "neutral",
      reasons: ["탄수화물 섭취는 있었지만 위험도는 높지 않아 보여요."],
      recommendedActions: ["식후 혈당을 꼭 다시 확인하고 물을 충분히 드세요."],
      confidence: 0.6,
    };
  }

  return {
    rawSpeechText,
    normalizedText,
    glycemicAssessment: "neutral",
    reasons: ["혈당 영향도를 판단할 핵심 식품 정보가 부족해요."],
    recommendedActions: ["다음에는 탄수화물/간식/음료 섭취 여부를 함께 말씀해주세요."],
    confidence: 0.55,
  };
}

export async function analyzeDietFromSttAudio(audioBase64: string, sttProvider: SttProvider): Promise<DietAnalysis> {
  if (!audioBase64.trim()) {
    throw new Error("오디오 입력이 비어 있어요.");
  }

  const transcript = await sttProvider.transcribeKorean(audioBase64);
  const analysis = analyzeDietText(transcript.text);

  if (typeof transcript.confidence === "number") {
    const bounded = Math.max(0, Math.min(1, transcript.confidence));
    return {
      ...analysis,
      confidence: Number(((analysis.confidence + bounded) / 2).toFixed(2)),
    };
  }

  return analysis;
}
