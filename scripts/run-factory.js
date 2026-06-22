import { createClient } from "@supabase/supabase-js";

console.log("Factory Runner Started");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data, error } = await supabase
  .from("factory_hub")
  .select("id, hub_name")
  .limit(5);

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(data);
