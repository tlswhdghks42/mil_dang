import { WeatherFetcher, WeatherFetcherResponse, WeatherApiConfig } from "./phase2Weather";

export interface KmaApiConfig {
  serviceKey: string;
  endpoint?: string;
  nx?: number;
  ny?: number;
  cacheTtlMs?: number;
  maxRetryAttempts?: number;
  retryBackoffMs?: number;
}

// 수영구 기본 격자 좌표 (기상청 Lambert 격자)
const SUYEONG_NX = 99;
const SUYEONG_NY = 75;
const KMA_BASE_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtObfl";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

interface KmaItem {
  category: string;
  obsrValue: string;
}

interface KmaApiResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: KmaItem[] } };
  };
}

interface CacheEntry {
  value: WeatherFetcherResponse;
  expiresAt: number;
}

export class WeatherCache {
  private store = new Map<string, CacheEntry>();

  get(key: string): WeatherFetcherResponse | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: WeatherFetcherResponse, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }
}

function buildKmaUrl(config: KmaApiConfig, nowIso: string): string {
  const dt = new Date(nowIso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const baseDate = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
  const baseTime = `${pad(dt.getHours())}00`;

  const params = new URLSearchParams({
    serviceKey: config.serviceKey,
    numOfRows: "10",
    pageNo: "1",
    dataType: "JSON",
    base_date: baseDate,
    base_time: baseTime,
    nx: String(config.nx ?? SUYEONG_NX),
    ny: String(config.ny ?? SUYEONG_NY),
  });

  return `${config.endpoint ?? KMA_BASE_URL}?${params.toString()}`;
}

export function parseKmaApiResponse(data: unknown): { temperatureC: number; conditionText: string } {
  const res = (data as KmaApiResponse)?.response;
  const resultCode = res?.header?.resultCode;

  if (resultCode && resultCode !== "00") {
    throw new Error(`기상청 API 오류: ${res?.header?.resultMsg ?? resultCode}`);
  }

  const items: KmaItem[] = res?.body?.items?.item ?? [];
  const find = (cat: string) => items.find((i) => i.category === cat)?.obsrValue;

  const tempStr = find("T1H");
  if (!tempStr) throw new Error("날씨 API 응답에 온도 정보가 없습니다.");
  const temperatureC = Number(tempStr);

  // PTY: 강수형태 (0:없음, 1:비, 2:비/눈, 3:눈, 4:소나기)
  const pty = find("PTY") ?? "0";
  // SKY: 하늘상태 (1:맑음, 3:구름많음, 4:흐림)
  const sky = find("SKY") ?? "1";

  let conditionText = "clear";
  if (pty === "1" || pty === "4") conditionText = "rain";
  else if (pty === "2" || pty === "3") conditionText = "snow";
  else if (sky === "3" || sky === "4") conditionText = "cloudy";

  // 온도 기반 극단 기상 오버라이드
  if (temperatureC >= 33) conditionText = "heatwave";
  if (temperatureC <= -5) conditionText = "coldwave";

  return { temperatureC, conditionText };
}

type RawFetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function makeKmaSuyeongFetcher(
  config: KmaApiConfig,
  rawFetcher: RawFetcher,
  cache = new WeatherCache(),
): WeatherFetcher {
  const ttlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxAttempts = config.maxRetryAttempts ?? 3;
  const backoffMs = config.retryBackoffMs ?? 1000;
  const nx = config.nx ?? SUYEONG_NX;
  const ny = config.ny ?? SUYEONG_NY;

  return async (_url: string): Promise<WeatherFetcherResponse> => {
    const nowIso = new Date().toISOString();
    // hour-level granularity key: prevents stale data across coordinates or hours
    const cacheKey = `kma-${nx}-${ny}-${nowIso.slice(0, 13)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const kmaUrl = buildKmaUrl(config, nowIso);
    // fetchWithRetry throws on all-attempts-exhausted, so raw.ok is always true here
    const raw = await fetchWithRetry(rawFetcher, kmaUrl, maxAttempts, backoffMs);

    // Memoize parsed body to avoid double-consumption of the HTTP body stream
    let parsedBody: { temperatureC: number; condition: string } | undefined;
    const response: WeatherFetcherResponse = {
      ok: true,
      status: raw.status,
      async json() {
        if (!parsedBody) {
          const data = await raw.json();
          const { temperatureC, conditionText } = parseKmaApiResponse(data);
          parsedBody = { temperatureC, condition: conditionText };
        }
        return parsedBody;
      },
    };

    cache.set(cacheKey, response, ttlMs);
    return response;
  };
}

// 환경변수 기반 기본 설정 로더
export function loadKmaConfigFromEnv(): KmaApiConfig {
  const serviceKey = process.env.WEATHER_API_KEY ?? "";
  if (!serviceKey) {
    throw new Error("WEATHER_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  return {
    serviceKey,
    endpoint: process.env.WEATHER_API_ENDPOINT ?? KMA_BASE_URL,
    nx: Number(process.env.WEATHER_NX ?? SUYEONG_NX),
    ny: Number(process.env.WEATHER_NY ?? SUYEONG_NY),
    cacheTtlMs: Number(process.env.WEATHER_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS),
    maxRetryAttempts: process.env.WEATHER_MAX_RETRY_ATTEMPTS ? Number(process.env.WEATHER_MAX_RETRY_ATTEMPTS) : 3,
    retryBackoffMs: process.env.WEATHER_RETRY_BACKOFF_MS ? Number(process.env.WEATHER_RETRY_BACKOFF_MS) : 1000,
  };
}

// 날씨 API 재시도 래퍼
export async function fetchWithRetry(
  fetcher: RawFetcher,
  url: string,
  maxAttempts = 3,
  backoffMs = 1000,
): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetcher(url);
      if (res.ok) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
      }
    }
  }

  throw lastError ?? new Error("날씨 API 연결 실패");
}
