import { WeatherSnapshot } from "../domain/types";

export interface WeatherApiConfig {
  endpoint: string;
  districtName?: string;
}

export interface WeatherFetcherResponse {
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
}

export type WeatherFetcher = (url: string) => Promise<WeatherFetcherResponse>;

interface WeatherApiPayload {
  temperatureC?: number;
  temp?: number;
  condition?: string;
  weather?: string;
}

export function deriveWeatherRiskFlags(temperatureC: number, conditionText: string): WeatherSnapshot["riskFlags"] {
  const text = conditionText.toLowerCase();
  const flags = new Set<WeatherSnapshot["riskFlags"][number]>();

  if (temperatureC >= 33) flags.add("heatwave");
  if (temperatureC <= -5) flags.add("coldwave");
  if (text.includes("dust") || text.includes("미세먼지")) flags.add("air_quality_bad");

  return [...flags];
}

export function normalizeWeatherCondition(
  temperatureC: number,
  conditionText: string,
): WeatherSnapshot["condition"] {
  const text = conditionText.toLowerCase();
  if (temperatureC >= 33) return "heatwave";
  if (temperatureC <= -5) return "coldwave";
  if (text.includes("snow") || text.includes("눈")) return "snow";
  if (text.includes("rain") || text.includes("비")) return "rain";
  if (text.includes("dust") || text.includes("미세먼지")) return "dusty";
  return "clear";
}

function parseWeatherPayload(payload: unknown): { temperatureC: number; conditionText: string } {
  const obj = (payload ?? {}) as WeatherApiPayload;
  const temperatureC = Number(obj.temperatureC ?? obj.temp);
  if (!Number.isFinite(temperatureC)) {
    throw new Error("날씨 API 응답에 온도 정보가 없습니다.");
  }

  const conditionText = String(obj.condition ?? obj.weather ?? "clear");
  return { temperatureC, conditionText };
}

export async function fetchSuyeongWeather(
  fetcher: WeatherFetcher,
  nowIso = new Date().toISOString(),
  config: WeatherApiConfig = { endpoint: "https://api.example.com/weather/suyeong", districtName: "수영구" },
): Promise<WeatherSnapshot> {
  const res = await fetcher(config.endpoint);
  if (!res.ok) {
    throw new Error(`수영구 날씨 정보를 불러오지 못했습니다. (status: ${res.status ?? "unknown"})`);
  }

  const payload = await res.json();
  const { temperatureC, conditionText } = parseWeatherPayload(payload);

  return {
    district: "수영구",
    observedAt: nowIso,
    temperatureC,
    condition: normalizeWeatherCondition(temperatureC, conditionText),
    riskFlags: deriveWeatherRiskFlags(temperatureC, conditionText),
  };
}
