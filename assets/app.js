let chart;
let lastRows = [];
let rangeMinutes = parseInt(localStorage.getItem('rangeMin') || '1440', 10); // default 24h
const COLORS = {h:'#5DADE2', r:'#48C9B0', a:'#F39C12', v:'#A78BFA'};
const ENDPOINT_LABEL = {h:'Servidor', r:'Listagem', a:'Acessos', v:'V4 Login'};

function fmtTime(s){if(typeof s!=='number')return '—';if(s>=10)return s.toFixed(1)+'s';if(s>=1)return s.toFixed(2)+'s';return Math.round(s*1000)+'ms'}
function cls(t,c){const vivo=(c>=200&&c<500);if(!vivo||t>30)return 'thanos';if(t>10)return 'alerta';return 'ok'}
function statusLbl(s){return{OK:{v:'Tudo OK',e:'🟢'},ALERTA:{v:'Atenção',e:'🟡'},THANOS:{v:'🚨 Limite do plano',e:'🔴'}}[s]||{v:'—',e:'⏳'}}

function filterByRange(rows, minutes){
  if(!rows.length) return [];
  const lastTs = rows[rows.length-1].tsUtc;
  const lastMs = Date.parse(lastTs);
  const cutoff = lastMs - minutes*60*1000;
  return rows.filter(r=>{
    const t = Date.parse(r.tsUtc);
    return !isNaN(t) && t >= cutoff;
  });
}

/**
 * Constrói log de eventos:
 * - 1 entrada por coleta (mostra todas, mais recente primeiro)
 * - Destaca transições de status e outliers com texto adicional
 */
function extractEvents(rows){
  const events = [];
  let prevStatus = null;
  const prevSlow = {h:false, r:false, a:false, v:false};
  const prevErr = {h:false, r:false, a:false, v:false};

  for(const row of rows){
    const tags = [];

    // Mudança de status
    if(prevStatus !== null && row.status !== prevStatus){
      tags.push(`${prevStatus} → ${row.status}`);
    }

    // Endpoints com HTTP error (5xx ou timeout)
    for(const k of ['h','r','a','v']){
      const codeKey = k+'c';
      const vivo = row[codeKey] >= 200 && row[codeKey] < 500;
      if(!vivo){
        if(!prevErr[k]) tags.push(`${ENDPOINT_LABEL[k]} caiu`);
        prevErr[k] = true;
      } else {
        if(prevErr[k]) tags.push(`${ENDPOINT_LABEL[k]} recuperado`);
        prevErr[k] = false;
      }
    }

    // Endpoints lentos (>10s primeira vez)
    for(const k of ['h','r','a','v']){
      const lento = row[k] > 10;
      if(lento && !prevSlow[k]){
        tags.push(`${ENDPOINT_LABEL[k]} ${fmtTime(row[k])}`);
        prevSlow[k] = true;
      } else if(!lento){
        prevSlow[k] = false;
      }
    }

    events.push({
      ts: row.ts,
      severity: row.status.toLowerCase(),
      h: row.h, r: row.r, a: row.a, v: row.v,
      tags
    });

    prevStatus = row.status;
  }

  // Mais recente primeiro, cap em 50
  return events.reverse().slice(0, 50);
}

function renderEvents(){
  const list = document.getElementById('eventsList');
  const count = document.getElementById('evCount');
  if(!list) return;

  // Filtra eventos pela mesma janela do gráfico
  const recent = filterByRange(lastRows, rangeMinutes);
  const events = extractEvents(recent);

  count.textContent = events.length ? `${events.length} coletas` : '';

  if(!events.length){
    list.innerHTML = '<div class="event-empty">aguardando primeira coleta…</div>';
    return;
  }

  list.innerHTML = events.map(e=>{
    const time = e.ts.split(' ')[1].substring(0,5);
    const hasTags = e.tags && e.tags.length > 0;
    const tagsHtml = hasTags
      ? `<div class="em em-tag">${e.tags.map(escapeHtml).join(' · ')}</div>`
      : '';
    const statusEmoji = {ok:'🟢',alerta:'🟡',thanos:'🔴'}[e.severity] || '⚪';
    const severityLbl = {ok:'OK',alerta:'ALERTA',thanos:'LIMITE'}[e.severity] || e.severity.toUpperCase();
    return `<div class="event ${e.severity}${hasTags?' highlight':''}">
      <div class="et">${statusEmoji} ${time} · ${severityLbl}</div>
      <div class="em">srv ${fmtTime(e.h)} · lista ${fmtTime(e.r)} · acesso ${fmtTime(e.a)} · login ${fmtTime(e.v)}</div>
      ${tagsHtml}
    </div>`;
  }).join('');
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function renderChart(){
  const recent = filterByRange(lastRows, rangeMinutes);
  const labels = recent.map(x=>x.ts.split(' ')[1].substring(0,5));
  const lineDs = (lbl, color, key) => ({
    label: lbl,
    data: recent.map(x=>x[key]),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 1.6,
    tension: 0.25,
    pointRadius: 0,
    pointHoverRadius: 4,
    fill: false,
    spanGaps: true,
  });
  const ds = [
    lineDs('Servidor', COLORS.h, 'h'),
    lineDs('Listagem', COLORS.r, 'r'),
    lineDs('Acessos',  COLORS.a, 'a'),
    lineDs('V4 Login', COLORS.v, 'v'),
  ];

  if(chart){
    chart.data.labels = labels;
    chart.data.datasets = ds;
    chart.update('none');
  } else {
    chart = new Chart(document.getElementById('ch1'), {
      type: 'line',
      data: {labels, datasets: ds},
      options: {
        responsive:true,
        maintainAspectRatio:false,
        interaction: {mode:'index', intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{
            backgroundColor:'#1e293b',
            borderColor:'#334155',
            borderWidth:1,
            titleColor:'#e2e8f0',
            bodyColor:'#cbd5e1',
            padding:10,
            callbacks:{
              label: (ctx)=> ctx.dataset.label+': '+(ctx.parsed.y!=null ? ctx.parsed.y.toFixed(2)+'s' : '—')
            }
          }
        },
        scales:{
          x:{
            ticks:{color:'#94a3b8',maxTicksLimit:8,autoSkip:true,maxRotation:0},
            grid:{display:false},
            border:{color:'#334155'}
          },
          y:{
            ticks:{color:'#94a3b8',callback:v=>v.toFixed(2)+'s'},
            beginAtZero:true,
            grid:{color:'#1e293b',drawTicks:false},
            border:{display:false}
          }
        }
      }
    });
  }
}

function setupRangePills(){
  const pills = document.getElementById('rangePills');
  if(!pills) return;
  pills.querySelectorAll('button').forEach(b=>{
    b.classList.toggle('active', parseInt(b.dataset.min,10) === rangeMinutes);
    b.addEventListener('click', ()=>{
      rangeMinutes = parseInt(b.dataset.min,10);
      localStorage.setItem('rangeMin', String(rangeMinutes));
      pills.querySelectorAll('button').forEach(x=>x.classList.toggle('active', x===b));
      renderChart();
      renderEvents();
    });
  });
}

async function tick(){
  try{
    const r = await fetch('data/status.json?_='+Date.now(), {cache:'no-store'});
    if(!r.ok){document.getElementById('upd').textContent='sem dados ainda';return}
    const j = await r.json();
    const rows = j.rows || [];
    if(!rows.length){document.getElementById('upd').textContent='aguardando primeira leitura';return}
    lastRows = rows;

    const last = rows[rows.length-1];
    const lbl = statusLbl(last.status);
    const st = document.getElementById('status');

    // Detecta atraso do cron (GitHub Actions free-tier pula execucoes).
    // Se ultima leitura > 30min atras, mostra estado "atrasado" no card.
    const lastMs = Date.parse(last.tsUtc);
    const ageMin = Math.round((Date.now() - lastMs) / 60000);
    // Coleta vem a cada 1min agora; consideramos atrasado se passar de 5min sem update.
    const atrasado = ageMin > 5;

    if (atrasado) {
      st.className = 'status sem';
      document.getElementById('sval').textContent = 'Monitor atrasado';
      document.getElementById('sts').textContent = `última coleta há ${ageMin} min (${last.ts}). Status real: ${lbl.v.toLowerCase()}.`;
    } else {
      st.className = 'status '+last.status.toLowerCase();
      document.getElementById('sval').textContent = lbl.v;
      document.getElementById('sts').textContent = `${last.ts} (Brasília) · há ${ageMin} min`;
      // bolinha removida (era #semoji)
    }

    document.getElementById('vh').textContent = fmtTime(last.h);
    document.getElementById('vr').textContent = fmtTime(last.r);
    document.getElementById('va').textContent = fmtTime(last.a);
    document.getElementById('vv').textContent = fmtTime(last.v);
    document.getElementById('ch').className='card '+cls(last.h,last.hc);
    document.getElementById('cr').className='card '+cls(last.r,last.rc);
    document.getElementById('ca').className='card '+cls(last.a,last.ac);
    document.getElementById('cv').className='card '+cls(last.v,last.vc);

    const updEl = document.getElementById('upd');
    updEl.textContent = 'ao vivo · '+new Date().toLocaleTimeString('pt-BR');
    // Flash visual a cada tick — confirma que polling tá rolando.
    updEl.classList.remove('flashing');
    void updEl.offsetWidth; // restart animation
    updEl.classList.add('flashing');

    renderChart();
    renderEvents();
  } catch(e){
    document.getElementById('upd').textContent = 'erro: '+e.message;
  }
}

setupRangePills();
tick();
// Polling a cada 5s. Coleta vem do GH a cada 1min, então a maioria dos ticks
// vai retornar o mesmo JSON — mas garante que assim que uma row nova entra,
// aparece na UI em até 5s sem precisar F5.
setInterval(tick, 5000);

// Acorda imediatamente ao voltar a focar a aba (Chrome pausa setInterval
// em background tabs).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tick();
});
window.addEventListener('focus', tick);
window.addEventListener('pageshow', tick);
