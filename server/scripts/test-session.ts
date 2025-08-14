import fetch from "node-fetch";

async function main() {
  const base = process.env.BASE_URL || "http://localhost:8080";
  const r = await fetch(`${base}/session`);
  const data = await r.json();
  console.log("status:", r.status);
  console.log("keys:", Object.keys(data || {}));
  if (!r.ok) {
    console.error("error:", data);
    process.exit(1);
  }
  console.log("ok: received ephemeral session");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
