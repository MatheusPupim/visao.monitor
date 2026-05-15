// Cloudflare Worker: dispara o workflow `monitor.yml` no GitHub a cada 15min.
//
// Necessario:
//   - vars (em wrangler.toml): GH_OWNER, GH_REPO, GH_WORKFLOW, GH_REF
//   - secret: GH_TOKEN (PAT com escopo workflow ou Actions:write)
//
// Endpoint manual pra debug: GET https://visao-monitor-cron.<sua-subdominio>.workers.dev/

const GH_API = 'https://api.github.com';

async function dispatchWorkflow(env) {
  const url = `${GH_API}/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/${env.GH_WORKFLOW}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'visao-monitor-cron-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: env.GH_REF }),
  });
  const ok = res.status === 204;
  let body = '';
  if (!ok) {
    try { body = await res.text(); } catch (_) {}
  }
  return { ok, status: res.status, body };
}

export default {
  // Disparado pelo cron trigger configurado em wrangler.toml
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const r = await dispatchWorkflow(env);
      console.log('cron dispatch', JSON.stringify({
        scheduledTime: event.scheduledTime,
        cron: event.cron,
        ...r,
      }));
    })());
  },

  // Endpoint HTTP de debug/disparo manual
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/dispatch') {
      const r = await dispatchWorkflow(env);
      return new Response(JSON.stringify(r, null, 2), {
        status: r.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      service: 'visao-monitor-cron',
      cron: '*/15 * * * *',
      target: `${env.GH_OWNER}/${env.GH_REPO}@${env.GH_REF}#${env.GH_WORKFLOW}`,
      hint: 'POST nada — use /dispatch para disparo manual',
    }, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  },
};
