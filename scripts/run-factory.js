console.log("TRIPLR Factory Runner Started");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FACTORY_HUB_ID = process.env.FACTORY_HUB_ID;
const MAX_BATCHES = Number(process.env.MAX_BATCHES || 20);

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_API_KEY || !FACTORY_HUB_ID) {
  throw new Error("Missing required environment variables");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function supabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }

  return data;
}

async function openaiJson(prompt) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      input: prompt,
    }),
  });

  const raw = await res.text();
  const data = JSON.parse(raw);

  if (!res.ok) {
    throw new Error(`OpenAI error: ${raw.slice(0, 1000)}`);
  }

  const text =
    data.output_text ||
    data.output?.flatMap((o) => o.content || []).map((c) => c.text || "").join("") ||
    "";

  const cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  const jsonText = first >= 0 && last >= 0 ? cleaned.slice(first, last + 1) : cleaned;

  return JSON.parse(jsonText);
}

function norm(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateActivities(activities, existingNames, batchSize) {
  if (!Array.isArray(activities)) throw new Error("activities is not an array");
  if (activities.length !== batchSize) {
    throw new Error(`Expected ${batchSize} activities, got ${activities.length}`);
  }

  const existing = new Set(existingNames.map(norm));
  const incoming = new Set();

  for (const a of activities) {
    const name = String(a.activity_name || "").trim();
    const key = norm(name);

    if (!name) throw new Error("Missing activity_name");
    if (existing.has(key)) throw new Error(`Duplicate existing activity: ${name}`);
    if (incoming.has(key)) throw new Error(`Duplicate inside batch: ${name}`);
    incoming.add(key);

    if (!a.description || a.description.length < 90) throw new Error(`Weak description: ${name}`);
    if (!a.why_this_stop_works || a.why_this_stop_works.length < 60) throw new Error(`Weak why_this_stop_works: ${name}`);
    if (!a.photo_tip || a.photo_tip.length < 50) throw new Error(`Weak photo_tip: ${name}`);
    if (!a.why_it_matters || a.why_it_matters.length < 60) throw new Error(`Weak why_it_matters: ${name}`);
  }
}

async function getHub() {
  const rows = await supabase(`factory_hub?id=eq.${FACTORY_HUB_ID}&limit=1`);
  if (!rows.length) throw new Error("Factory hub not found");
  return rows[0];
}

async function getNextCluster() {
  const rows = await supabase(
    `factory_hub_clusters?factory_hub_id=eq.${FACTORY_HUB_ID}&status=in.(pending,partial)&order=cluster_index.asc&limit=1`
  );
  return rows[0] || null;
}

async function getExistingActivities(clusterId = null) {
  let path = `factory_hub_activity_staging?factory_hub_id=eq.${FACTORY_HUB_ID}&is_current=eq.true&select=activity_name`;
  if (clusterId) path += `&factory_cluster_id=eq.${clusterId}`;
  const rows = await supabase(path);
  return rows.map((r) => r.activity_name).filter(Boolean);
}

async function getSavedCount(clusterId) {
  const rows = await supabase(
    `factory_hub_activity_staging?factory_hub_id=eq.${FACTORY_HUB_ID}&factory_cluster_id=eq.${clusterId}&is_current=eq.true&select=id`
  );
  return rows.length;
}

function buildPrompt(hub, cluster, batchSize, existingHub, existingCluster) {
  return `
You are TRIPLR.AI Premium Hub Activity Generator V3.

Create production-ready itinerary activities for a premium travel app.

Hub:
${hub.hub_name}

Country:
${hub.country_name || hub.country_code}

Tier:
${hub.target_tier}

Cluster:
${cluster.cluster_index}. ${cluster.cluster_name}

Generate exactly ${batchSize} new activities for this cluster.

Existing activities already created for this hub:
${existingHub.length ? existingHub.map((x, i) => `${i + 1}. ${x}`).join("\n") : "None yet"}

Existing activities already created inside this cluster:
${existingCluster.length ? existingCluster.map((x, i) => `${i + 1}. ${x}`).join("\n") : "None yet"}

ABSOLUTE RULES:
- Return ONLY valid JSON.
- Generate exactly ${batchSize} activities.
- Every activity must be a real, specific, destination-relevant stop or experience.
- Every activity must physically belong to the named hub destination.
- Do not include attractions from another city, region, or country.
- Do not invent attractions.
- Do not repeat any existing activity.
- Do not create renamed variants of existing activities.
- Do not repeat the same landmark through renamed tours, interiors, viewpoints, cafés, or routes.
- If an activity is only a small detail inside another stop, replace it with a stronger standalone itinerary activity.
- Avoid chain restaurants unless locally iconic and itinerary-worthy.
- No generic filler.
- No vague names.
- No repeated AI phrases like "hidden gem", "breathtaking", "must-see", "vibrant", "stunning", "immerse yourself".
- Each activity must justify at least 30–90 minutes in an itinerary.
- Balance the cluster with varied activity types.
- Description must be polished, specific, and concise.
- Pro tip must be practical local advice.
- Avoid must highlight a genuine traveller mistake, timing issue, crowd issue, closure issue, or limitation.
- Photo tip must mention angle, timing, framing, light, or vantage point.
- Scores must be integers from 0 to 10.

Return exactly:
{
  "activities": [
    {
      "activity_name": "",
      "description": "",
      "category": "",
      "subcategory": "",
      "display_area": "",
      "must_do": true,
      "travel_anchor": true,
      "is_anchor": true,
      "estimated_duration_hours": 2,
      "time_window": "morning",
      "intensity": "easy",
      "indoor_outdoor": "outdoor",
      "cost_band": "free",
      "family_friendly": true,
      "tags": ["culture", "history"],
      "best_time": "",
      "pro_tip": "",
      "avoid": "",
      "why_special": "",
      "why_this_stop_works": "",
      "photo_tip": "",
      "why_it_matters": "",
      "badge": "",
      "romantic_score": 0,
      "food_score": 0,
      "adventure_score": 0,
      "culture_score": 0,
      "family_score": 0
    }
  ]
}
`;
}

async function saveActivities(hub, cluster, activities, savedBefore) {
  const rows = activities.map((a, index) => ({
    batch_id: hub.batch_id,
    factory_hub_id: hub.id,
    factory_cluster_id: cluster.id,
    generation_version: 1,
    is_current: true,
    status: "staged",
    activity_name: a.activity_name,
    slug: slugify(a.activity_name),
    description: a.description,
    category: a.category,
    subcategory: a.subcategory,
    area_cluster: cluster.cluster_name,
    display_area: a.display_area || cluster.cluster_name,
    priority: (cluster.cluster_index - 1) * 10 + savedBefore + index + 1,
    must_do: !!a.must_do,
    travel_anchor: !!a.travel_anchor,
    is_anchor: !!a.is_anchor,
    estimated_duration_hours: a.estimated_duration_hours || 2,
    time_window: a.time_window,
    intensity: a.intensity,
    indoor_outdoor: a.indoor_outdoor,
    cost_band: a.cost_band,
    family_friendly: !!a.family_friendly,
    tags: a.tags || [],
    best_time: a.best_time,
    pro_tip: a.pro_tip,
    avoid: a.avoid,
    why_special: a.why_special,
    why_this_stop_works: a.why_this_stop_works,
    photo_tip: a.photo_tip,
    why_it_matters: a.why_it_matters,
    badge: a.badge,
    romantic_score: a.romantic_score || 0,
    food_score: a.food_score || 0,
    adventure_score: a.adventure_score || 0,
    culture_score: a.culture_score || 0,
    family_score: a.family_score || 0,
    validation_status: "staged",
    quality_score: null,
  }));

  await supabase("factory_hub_activity_staging", {
    method: "POST",
    body: JSON.stringify(rows),
  });
}

async function updateCluster(cluster, count, rawResponse = null, error = null) {
  const target = cluster.target_activity_count || 10;
  const status = error ? "failed" : count >= target ? "generated" : "partial";

  await supabase(`factory_hub_clusters?id=eq.${cluster.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      generated_activity_count: count,
      last_error: error,
      raw_response_json: rawResponse,
      completed_at: status === "generated" ? new Date().toISOString() : null,
      started_at: cluster.started_at || new Date().toISOString(),
    }),
  });
}

const hub = await getHub();

console.log(`Hub: ${hub.hub_name}`);
console.log(`Factory Hub ID: ${FACTORY_HUB_ID}`);
console.log(`Max batches: ${MAX_BATCHES}`);

for (let batch = 1; batch <= MAX_BATCHES; batch++) {
  const cluster = await getNextCluster();

  if (!cluster) {
    console.log("All pending/partial clusters complete.");
    break;
  }

  const savedBefore = await getSavedCount(cluster.id);
  const target = cluster.target_activity_count || 10;
  const missing = Math.max(0, target - savedBefore);
  const batchSize = Math.min(5, missing);

  if (batchSize === 0) {
    await updateCluster(cluster, savedBefore);
    continue;
  }

  console.log(`Batch ${batch}: ${cluster.cluster_name} | ${savedBefore}/${target} | generating ${batchSize}`);

  try {
    await supabase(`factory_hub_clusters?id=eq.${cluster.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "partial",
        started_at: cluster.started_at || new Date().toISOString(),
        last_error: null,
      }),
    });

    const existingHub = await getExistingActivities();
    const existingCluster = await getExistingActivities(cluster.id);

    const prompt = buildPrompt(hub, cluster, batchSize, existingHub, existingCluster);
    const result = await openaiJson(prompt);
    const activities = result.activities || [];

    validateActivities(activities, existingHub, batchSize);

    await saveActivities(hub, cluster, activities, savedBefore);

    const savedAfter = await getSavedCount(cluster.id);
    await updateCluster(cluster, savedAfter, result, null);

    console.log(`Saved ${activities.length}. Cluster now ${savedAfter}/${target}.`);

    await sleep(5000);
  } catch (err) {
    const savedAfter = await getSavedCount(cluster.id);
    await updateCluster(cluster, savedAfter, null, String(err.message || err));
    throw err;
  }
}

const totalRows = await supabase(
  `factory_hub_activity_staging?factory_hub_id=eq.${FACTORY_HUB_ID}&is_current=eq.true&select=id`
);

console.log(`Total staged activities: ${totalRows.length}`);
console.log("TRIPLR Factory Runner Finished");
