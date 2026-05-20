import type { VercelRequest, VercelResponse } from "@vercel/node";

const pad = (n: number) => String(n).padStart(2, "0");

function buildKmaUrl(apiKey: string): string {
  const now = new Date();
  const safe = new Date(now.getTime() - 40 * 60 * 1000);
  const baseMin = Math.floor(safe.getMinutes() / 10) * 10;
  const baseDate = `${safe.getFullYear()}${pad(safe.getMonth() + 1)}${pad(safe.getDate())}`;
  const baseTime = `${pad(safe.getHours())}${pad(baseMin)}`;

  const url = new URL("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst");
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("numOfRows", "10");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", baseDate);
  url.searchParams.set("base_time", baseTime);
  url.searchParams.set("nx", "99"); // 수영구
  url.searchParams.set("ny", "75");
  return url.toString();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "날씨 서비스 미설정" });
    return;
  }

  try {
    const kmaRes = await fetch(buildKmaUrl(apiKey));
    const data = await kmaRes.json() as { response?: { body?: { items?: { item?: Array<{ category: string; obsrValue: string }> } } } };
    const items = data?.response?.body?.items?.item ?? [];

    const get = (cat: string) => items.find((i) => i.category === cat)?.obsrValue ?? "";
    const T1H = parseFloat(get("T1H") || "15");
    const PTY = get("PTY");

    let condition: string = "clear";
    if (PTY === "1" || PTY === "5") condition = "rain";
    else if (PTY === "3" || PTY === "6" || PTY === "7") condition = "snow";
    else if (T1H >= 33) condition = "heatwave";
    else if (T1H <= 0) condition = "coldwave";

    const riskFlags: string[] = [];
    if (T1H >= 33) riskFlags.push("heatwave");
    if (T1H <= 0) riskFlags.push("coldwave");

    res.json({
      district: "수영구",
      observedAt: new Date().toISOString(),
      temperatureC: T1H,
      condition,
      riskFlags,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
