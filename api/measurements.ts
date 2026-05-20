import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase 미설정");
  return createClient(url, key);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sb = getSupabase();

    if (req.method === "GET") {
      const userId = req.query.userId as string;
      if (!userId) { res.status(400).json({ error: "userId 필요" }); return; }
      const { data, error } = await sb
        .from("measurements")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      res.json(data);
    } else if (req.method === "POST") {
      const { userId, glucose, mealTiming, signal, interventionText, temperatureC, weatherCondition } = req.body;
      const { data, error } = await sb
        .from("measurements")
        .insert({
          user_id: userId,
          glucose,
          meal_timing: mealTiming,
          signal,
          intervention_text: interventionText,
          temperature_c: temperatureC ?? null,
          weather_condition: weatherCondition ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } else {
      res.status(405).end();
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
