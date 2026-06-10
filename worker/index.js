export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" } });
    }
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const date = url.searchParams.get("date");
    const apiKey = env.JQUANTS_API_KEY;
    if (!code) return new Response(JSON.stringify({error:"code required"}), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
    const params = new URLSearchParams({ code });
    if (date) params.set("date", date);
    const jqUrl = `https://api.jquants.com/v2/equities/bars/daily?${params}`;
    const resp = await fetch(jqUrl, { headers: { "x-api-key": apiKey } });
    const data = await resp.text();
    return new Response(data, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
};
