// In-memory throttling for the managed Functions API.
// Honest limits: the counters live in one function instance's memory. They reset when
// the instance restarts, and if Azure scales out to several instances each one counts
// on its own. That's fine for a talk demo; the hard cost ceiling is the rate limit on
// the model deployment in Foundry plus a budget alert (see web/README.md).

export function createLimiter({ perIpPerMinute = 10, dailyCallCap = 500, now = () => Date.now() } = {}) {
  const hits = new Map(); // ip -> [timestamps]
  let day = "", calls = 0;
  const today = () => new Date(now()).toISOString().slice(0, 10);

  return {
    // Check before running a scenario that needs `cost` model calls.
    take(ip, cost) {
      const t = now();
      const recent = (hits.get(ip) || []).filter((x) => t - x < 60_000);
      if (recent.length >= perIpPerMinute) {
        hits.set(ip, recent);
        return { ok: false, reason: "per-ip", retryAfter: Math.ceil((60_000 - (t - recent[0])) / 1000) };
      }
      if (today() !== day) { day = today(); calls = 0; }
      if (calls + cost > dailyCallCap) return { ok: false, reason: "daily", retryAfter: 3600 };
      recent.push(t);
      hits.set(ip, recent);
      calls += cost;
      if (hits.size > 5000) for (const [k, v] of hits) if (t - v[v.length - 1] > 60_000) hits.delete(k);
      return { ok: true, remainingIp: perIpPerMinute - recent.length, remainingToday: dailyCallCap - calls };
    },
    stats: () => ({ day, calls, dailyCallCap, perIpPerMinute }),
  };
}

export function clientIp(headers) {
  const get = (n) => (typeof headers?.get === "function" ? headers.get(n) : headers?.[n]);
  const raw = get("x-azure-clientip") || get("x-client-ip") || get("x-forwarded-for") || "unknown";
  let ip = String(raw).split(",")[0].trim();
  // "1.2.3.4:5678" -> "1.2.3.4"; leave IPv6 ("[::1]:80" or "2001:db8::1") alone except brackets
  const m = ip.match(/^\[([^\]]+)\](?::\d+)?$/) || ip.match(/^(\d+\.\d+\.\d+\.\d+)(?::\d+)?$/);
  if (m) ip = m[1];
  return ip;
}
