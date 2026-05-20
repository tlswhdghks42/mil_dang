import { SignalLevel, WeatherSnapshot } from "../domain/types";

interface ComposeArgs {
  signal: SignalLevel;
  weather?: WeatherSnapshot;
  dietAssessment?: "good" | "neutral" | "risky";
  symptoms?: string[];
}

export function composeInterventionText({ signal, weather, dietAssessment, symptoms }: ComposeArgs): string {
  const weatherRisk = weather?.riskFlags?.length ? "오늘 날씨가 좋지 않아 실내 활동을 권장드려요." : "";
  const riskyDiet = dietAssessment === "risky" ? "식사는 다음 끼니에 탄수화물을 조금 줄여볼게요." : "";
  const symptomLine = symptoms?.length ? `현재 증상(${symptoms.join(", ")})이 있어 천천히 안정을 취하세요.` : "";

  switch (signal) {
    case "critical_low":
      return [
        "혈당이 매우 낮아요. 바로 당분 15g을 드세요.",
        "15분 뒤 다시 측정하고, 좋아지지 않으면 보호자나 119에 연락하세요.",
        symptomLine,
      ]
        .filter(Boolean)
        .join(" ");
    case "low":
      return ["혈당이 낮아요. 당분을 먼저 보충해요.", "15분 뒤 다시 측정해 주세요.", symptomLine]
        .filter(Boolean)
        .join(" ");
    case "green":
      return ["아주 좋아요. 현재 혈당은 안정적이에요.", weatherRisk].filter(Boolean).join(" ");
    case "yellow":
      return [
        "조심 단계예요. 물을 드시고 가볍게 움직여요.",
        riskyDiet,
        weatherRisk,
      ]
        .filter(Boolean)
        .join(" ");
    case "red":
      return [
        "혈당이 높아요. 물 한 컵을 천천히 드시고 복약을 확인하세요.",
        "30분 뒤 다시 측정해 주세요.",
        riskyDiet,
        weatherRisk,
      ]
        .filter(Boolean)
        .join(" ");
  }
}
