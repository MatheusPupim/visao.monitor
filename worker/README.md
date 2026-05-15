# visao-monitor-cron (Cloudflare Worker)

Worker que dispara o workflow `monitor.yml` do GitHub a cada **15 minutos reais** via API.

Resolve o problema do GitHub Actions cron pular execuções em repos privados free.

## Deploy (3 comandos, ~1 minuto)

Pré-requisito: já temos `wrangler@4.x` instalado globalmente (`npm i -g wrangler` se não tiver) e um GitHub PAT com escopo `workflow` (ou Actions:write).

```bash
cd worker

# 1) Login no Cloudflare (abre browser, autoriza)
npx wrangler login

# 2) Cadastra o secret do GitHub PAT (cole o token quando pedir)
npx wrangler secret put GH_TOKEN

# 3) Deploy do Worker + ativa o cron trigger
npx wrangler deploy
```

Após o deploy:
- URL pública: `https://visao-monitor-cron.<sua-subdominio>.workers.dev`
- Cron `*/15 * * * *` ativo automaticamente
- Disparo manual de teste: `curl https://visao-monitor-cron.<sua-subdominio>.workers.dev/dispatch`

## O que o Worker faz

A cada 15 minutos:

1. Envia `POST /repos/MatheusPupim/visao.monitor/actions/workflows/monitor.yml/dispatches` com `{"ref":"main"}` e Authorization Bearer do PAT.
2. GitHub responde HTTP 204 e enfileira o workflow.
3. Workflow roda, sonda a VisaoApi, commita o `data/status.json`, Cloudflare Pages republica.

Sem dependência do scheduler interno do GitHub (que tem latência alta em repos privados free).

## Custo

- Cloudflare Workers Free Plan: 100k requests/dia. Worker faz ~96 requests/dia (cron) + manuais. Folga enorme.
- GitHub Actions Free Plan (private): 2.000 min/mês. Worker dispara 96 runs/dia × 30 dias × ~1 min/run = ~2.880 min/mês. **Estoura ~880 min**. Se preocupado, ajustar cron pra `*/20` (72 runs/dia = 2.160 min/mês — ainda estoura levemente) ou `*/30` (1.440 min/mês — folgado).

## Estrutura

```
worker/
├── src/
│   └── index.js     # Handler scheduled + fetch (debug)
├── wrangler.toml    # Cron + vars públicas
├── package.json     # Wrangler como devDependency
└── README.md
```
