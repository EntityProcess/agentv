import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Mutex } from 'async-mutex';

import type { EvaluationResult } from '@agentv/core';

export class HtmlWriter {
  private readonly filePath: string;
  private readonly results: EvaluationResult[] = [];
  private readonly mutex = new Mutex();
  private closed = false;
  private isLive = true;

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  static async open(filePath: string): Promise<HtmlWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const writer = new HtmlWriter(filePath);
    await writer.writeHtml();
    return writer;
  }

  async append(result: EvaluationResult): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (this.closed) {
        throw new Error('Cannot write to closed HTML writer');
      }
      this.results.push(result);
      await this.writeHtml();
    });
  }

  async close(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (this.closed) {
        return;
      }
      this.closed = true;
      this.isLive = false;
      await this.writeHtml();
    });
  }

  private async writeHtml(): Promise<void> {
    const html = generateHtml(this.results, this.isLive);
    await writeFile(this.filePath, html, 'utf8');
  }
}

function generateHtml(results: readonly EvaluationResult[], isLive: boolean): string {
  // Strip heavy fields to keep file size manageable
  const lightResults = results.map((r) => {
    const { requests, trace, ...rest } = r as EvaluationResult & Record<string, unknown>;
    return rest;
  });
  // Escape </script> in JSON to prevent breaking out of script tag
  const dataJson = JSON.stringify(lightResults).replace(/<\//g, '<\\/');
  const metaRefresh = isLive ? '    <meta http-equiv="refresh" content="2">\n' : '';
  const liveIndicator = isLive
    ? '<span class="live-badge">\u25CF LIVE</span>'
    : `<span class="timestamp">${escapeHtml(new Date().toISOString())}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
${metaRefresh}    <title>AgentV Evaluation Report</title>
    <style>
${STYLES}
    </style>
</head>
<body>
    <header class="header">
        <div class="header-left">
            <h1 class="header-title">AgentV</h1>
            <span class="header-subtitle">Evaluation Report</span>
        </div>
        <div class="header-right">${liveIndicator}</div>
    </header>
    <nav class="tabs" id="tabs">
        <button class="tab active" data-tab="overview">Overview</button>
        <button class="tab" data-tab="tests">Test Cases</button>
    </nav>
    <main id="app"></main>
    <script>
    var DATA = ${dataJson};
    var IS_LIVE = ${String(isLive)};
${SCRIPT}
    </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Embedded CSS
// ---------------------------------------------------------------------------
const STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#f6f8fa;--surface:#fff;--border:#d0d7de;--border-light:#e8ebee;
  --text:#1f2328;--text-muted:#656d76;
  --primary:#0969da;--primary-bg:#ddf4ff;
  --success:#1a7f37;--success-bg:#dafbe1;
  --danger:#cf222e;--danger-bg:#ffebe9;
  --warning:#9a6700;--warning-bg:#fff8c5;
  --radius:6px;
  --shadow:0 1px 3px rgba(31,35,40,.04),0 1px 2px rgba(31,35,40,.06);
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.5;font-size:14px}

/* Header */
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;justify-content:space-between}
.header-left{display:flex;align-items:baseline;gap:12px}
.header-title{font-size:18px;font-weight:600}
.header-subtitle{font-size:14px;color:var(--text-muted)}
.live-badge{color:var(--success);font-size:12px;font-weight:600;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.timestamp{font-size:12px;color:var(--text-muted);font-family:var(--mono)}

/* Tabs */
.tabs{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;display:flex}
.tab{background:none;border:none;padding:10px 16px;font-size:14px;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;font-family:var(--font);transition:color .15s,border-color .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--text);font-weight:600;border-bottom-color:var(--primary)}

#app{max-width:1280px;margin:0 auto;padding:24px}

/* Stat cards */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center;box-shadow:var(--shadow)}
.stat-card.pass .stat-value{color:var(--success)}
.stat-card.fail .stat-value{color:var(--danger)}
.stat-card.error .stat-value{color:var(--danger)}
.stat-card.warn .stat-value{color:var(--warning)}
.stat-card.total .stat-value{color:var(--primary)}
.stat-value{font-size:28px;font-weight:700;line-height:1.2}
.stat-label{font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:4px}

/* Sections */
.section{margin-bottom:24px}
.section-title{font-size:16px;font-weight:600;margin-bottom:12px}

/* Tables */
.table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}
.data-table{width:100%;border-collapse:collapse;font-size:13px}
.data-table th{background:var(--bg);border-bottom:1px solid var(--border);padding:8px 12px;text-align:left;font-weight:600;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;white-space:nowrap}
.data-table th.sortable{cursor:pointer;user-select:none}
.data-table th.sortable:hover{color:var(--text)}
.data-table td{padding:8px 12px;border-bottom:1px solid var(--border-light);vertical-align:middle}
.data-table tbody tr:last-child td{border-bottom:none}

/* Status icons */
.status-icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:12px;font-weight:700}
.status-icon.pass{background:var(--success-bg);color:var(--success)}
.status-icon.fail{background:var(--danger-bg);color:var(--danger)}
.status-icon.error{background:var(--warning-bg);color:var(--warning)}

/* Score colors */
.score-high{color:var(--success);font-weight:600}
.score-mid{color:var(--warning);font-weight:600}
.score-low{color:var(--danger);font-weight:600}

/* Pass-rate bar */
.bar-bg{width:100px;height:8px;background:var(--border-light);border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;transition:width .3s}
.bar-fill.score-high{background:var(--success)}
.bar-fill.score-mid{background:var(--warning)}
.bar-fill.score-low{background:var(--danger)}

/* Histogram */
.histogram{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)}
.hist-row{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.hist-row:last-child{margin-bottom:0}
.hist-label{width:60px;font-size:12px;color:var(--text-muted);text-align:right;flex-shrink:0}
.hist-bar-bg{flex:1;height:20px;background:var(--border-light);border-radius:3px;overflow:hidden}
.hist-bar{height:100%;border-radius:3px;transition:width .3s}
.hist-count{width:30px;font-size:12px;color:var(--text-muted);text-align:right;flex-shrink:0}

/* Filters */
.filter-bar{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
.filter-select,.filter-search{padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;background:var(--surface);color:var(--text);font-family:var(--font)}
.filter-search{flex:1;min-width:200px}
.filter-count{font-size:12px;color:var(--text-muted);margin-left:auto}

/* Test rows */
.test-row{cursor:pointer;transition:background .1s}
.test-row:hover{background:var(--bg)!important}
.test-row.expanded{background:var(--primary-bg)!important}
.expand-col{width:32px;text-align:center}
.expand-icon{color:var(--text-muted);font-size:12px}
.fw-medium{font-weight:500}
.text-pass{color:var(--success)}.text-fail{color:var(--danger)}.text-error{color:var(--warning)}

/* Detail panel */
.detail-row td{padding:0!important;background:var(--bg)!important}
.detail-panel{padding:16px 24px}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.detail-block h4{font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px}
.detail-pre{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-family:var(--mono);font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;line-height:1.6}
.detail-panel h4{font-size:13px;font-weight:600;margin:16px 0 8px}
.eval-table{width:100%;border-collapse:collapse;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:12px}
.eval-table th{background:var(--bg);padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)}
.eval-table td{padding:8px 10px;border-bottom:1px solid var(--border-light)}
.reasoning-cell{max-width:500px;font-size:12px;color:var(--text-muted)}
.expect-list{list-style:none;padding:0;margin-bottom:12px}
.expect-list li{padding:4px 8px 4px 24px;position:relative;font-size:13px}
.expect-list.pass li::before{content:"\\2713";position:absolute;left:4px;color:var(--success);font-weight:700}
.expect-list.fail li::before{content:"\\2717";position:absolute;left:4px;color:var(--danger);font-weight:700}
.error-box{background:var(--danger-bg);border:1px solid var(--danger);border-radius:var(--radius);padding:12px;margin-bottom:12px}
.error-box h4{color:var(--danger);margin:0 0 6px}
.error-box pre{font-family:var(--mono);font-size:12px;white-space:pre-wrap;word-break:break-word}
.detail-meta{font-size:12px;color:var(--text-muted);margin-top:12px;padding-top:12px;border-top:1px solid var(--border-light)}
.empty-state{text-align:center;padding:48px 24px;color:var(--text-muted)}
.empty-state h3{font-size:16px;margin-bottom:8px;color:var(--text)}
`;

// ---------------------------------------------------------------------------
// Embedded JavaScript (no template literals — all string concatenation)
// ---------------------------------------------------------------------------
const SCRIPT = `
(function(){
  /* ---- helpers ---- */
  function esc(s){
    if(s==null)return"";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function getStatus(r){
    if(r.executionStatus==="execution_error")return"error";
    if(r.executionStatus==="quality_failure")return"fail";
    if(r.executionStatus==="ok")return"pass";
    if(r.error)return"error";
    return r.score>=0.5?"pass":"fail";
  }
  function sIcon(s){
    if(s==="pass")return'<span class="status-icon pass">\\u2713</span>';
    if(s==="fail")return'<span class="status-icon fail">\\u2717</span>';
    return'<span class="status-icon error">!</span>';
  }
  function fmtDur(ms){
    if(ms==null)return"\\u2014";
    if(ms<1000)return ms+"ms";
    if(ms<60000)return(ms/1000).toFixed(1)+"s";
    return Math.floor(ms/60000)+"m "+Math.round((ms%60000)/1000)+"s";
  }
  function fmtTok(n){
    if(n==null)return"\\u2014";
    if(n>=1e6)return(n/1e6).toFixed(1)+"M";
    if(n>=1e3)return(n/1e3).toFixed(1)+"K";
    return String(n);
  }
  function fmtCost(u){if(u==null)return"\\u2014";if(u<0.01)return"<$0.01";return"$"+u.toFixed(2);}
  function fmtPct(v){if(v==null)return"\\u2014";return(v*100).toFixed(1)+"%";}
  function sCls(v){if(v==null)return"";if(v>=0.9)return"score-high";if(v>=0.5)return"score-mid";return"score-low";}

  /* ---- compute stats ---- */
  function computeStats(d){
    var t=d.length,p=0,f=0,e=0,dur=0,ti=0,to=0,cost=0,sc=[];
    for(var i=0;i<d.length;i++){
      var r=d[i],s=getStatus(r);
      if(s==="pass")p++;else if(s==="fail")f++;else e++;
      if(r.durationMs)dur+=r.durationMs;
      if(r.tokenUsage){ti+=(r.tokenUsage.input||0);to+=(r.tokenUsage.output||0);}
      if(r.costUsd)cost+=r.costUsd;
      if(s!=="error")sc.push(r.score);
    }
    var g=t-e;
    return{total:t,passed:p,failed:f,errors:e,passRate:g>0?p/g:0,dur:dur,tokens:ti+to,inTok:ti,outTok:to,cost:cost,scores:sc};
  }
  function computeTargets(d){
    var m={};
    for(var i=0;i<d.length;i++){
      var r=d[i],tgt=r.target||"unknown";
      if(!m[tgt])m[tgt]={target:tgt,results:[],p:0,f:0,e:0,ts:0,sc:0,dur:0,tok:0,cost:0};
      var o=m[tgt];o.results.push(r);
      var s=getStatus(r);
      if(s==="pass")o.p++;else if(s==="fail")o.f++;else o.e++;
      if(s!=="error"){o.ts+=r.score;o.sc++;}
      if(r.durationMs)o.dur+=r.durationMs;
      if(r.tokenUsage)o.tok+=(r.tokenUsage.input||0)+(r.tokenUsage.output||0);
      if(r.costUsd)o.cost+=r.costUsd;
    }
    var a=[];for(var k in m)a.push(m[k]);return a;
  }
  function getEvalNames(){
    var n={};
    for(var i=0;i<DATA.length;i++){
      var sc=DATA[i].scores;
      if(sc)for(var j=0;j<sc.length;j++)n[sc[j].name]=true;
    }
    return Object.keys(n);
  }
  function getEvalScore(r,name){
    if(!r.scores)return null;
    for(var i=0;i<r.scores.length;i++)if(r.scores[i].name===name)return r.scores[i].score;
    return null;
  }

  var stats=computeStats(DATA);
  var tgtStats=computeTargets(DATA);
  var tgtNames=tgtStats.map(function(t){return t.target;});

  /* ---- state ---- */
  var state={tab:"overview",filter:{status:"all",target:"all",search:""},sort:{col:"testId",dir:"asc"},expanded:{}};

  /* ---- DOM refs ---- */
  var app=document.getElementById("app");
  var tabBtns=document.querySelectorAll(".tab");

  /* ---- tabs ---- */
  function setTab(t){
    state.tab=t;
    for(var i=0;i<tabBtns.length;i++)tabBtns[i].classList.toggle("active",tabBtns[i].getAttribute("data-tab")===t);
    render();
  }
  for(var i=0;i<tabBtns.length;i++){
    tabBtns[i].addEventListener("click",(function(b){return function(){setTab(b.getAttribute("data-tab"));};})(tabBtns[i]));
  }

  /* ---- render ---- */
  function render(){
    if(DATA.length===0){app.innerHTML='<div class="empty-state"><h3>No results yet</h3><p>'+(IS_LIVE?"Waiting for evaluation results\\u2026 Page will auto-refresh.":"Run an evaluation to generate results.")+"</p></div>";return;}
    if(state.tab==="overview")renderOverview();else renderTests();
  }

  /* ---- stat card helper ---- */
  function card(label,value,type){
    return'<div class="stat-card '+type+'"><div class="stat-value">'+value+'</div><div class="stat-label">'+label+"</div></div>";
  }

  /* ---- overview ---- */
  function renderOverview(){
    var h='<div class="stats-grid">';
    h+=card("Total Tests",stats.total,"total");
    h+=card("Passed",stats.passed,"pass");
    h+=card("Failed",stats.failed,"fail");
    h+=card("Errors",stats.errors,"error");
    var prCls=stats.passRate>=0.9?"pass":stats.passRate>=0.5?"warn":"fail";
    h+=card("Pass Rate",fmtPct(stats.passRate),prCls);
    h+=card("Duration",fmtDur(stats.dur),"neutral");
    h+=card("Tokens",fmtTok(stats.tokens),"neutral");
    h+=card("Est. Cost",fmtCost(stats.cost),"neutral");
    h+="</div>";

    /* targets table */
    if(tgtStats.length>1){
      h+='<div class="section"><h2 class="section-title">Targets</h2><div class="table-wrap"><table class="data-table">';
      h+="<thead><tr><th>Target</th><th>Pass Rate</th><th></th><th>Passed</th><th>Failed</th><th>Errors</th><th>Avg Score</th><th>Duration</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>";
      for(var i=0;i<tgtStats.length;i++){
        var t=tgtStats[i],g=t.p+t.f,pr=g>0?t.p/g:0,avg=t.sc>0?t.ts/t.sc:0;
        h+="<tr><td class=\\"fw-medium\\">"+esc(t.target)+"</td><td>"+fmtPct(pr)+'</td><td><div class="bar-bg"><div class="bar-fill '+sCls(pr)+'" style="width:'+(pr*100)+'%"></div></div></td>';
        h+='<td class="text-pass">'+t.p+'</td><td class="text-fail">'+t.f+'</td><td class="text-error">'+t.e+"</td>";
        h+='<td class="'+sCls(avg)+'">'+fmtPct(avg)+"</td><td>"+fmtDur(t.dur)+"</td><td>"+fmtTok(t.tok)+"</td><td>"+fmtCost(t.cost)+"</td></tr>";
      }
      h+="</tbody></table></div></div>";
    }

    /* histogram */
    if(stats.scores.length>0){
      var bk=[0,0,0,0,0];
      for(var i=0;i<stats.scores.length;i++){var idx=Math.min(Math.floor(stats.scores[i]*5),4);bk[idx]++;}
      var mx=Math.max.apply(null,bk);
      var lb=["0\\u201320%","20\\u201340%","40\\u201360%","60\\u201380%","80\\u2013100%"];
      h+='<div class="section"><h2 class="section-title">Score Distribution</h2><div class="histogram">';
      for(var i=0;i<bk.length;i++){
        var pct=mx>0?(bk[i]/mx*100):0;
        h+='<div class="hist-row"><span class="hist-label">'+lb[i]+'</span><div class="hist-bar-bg"><div class="hist-bar '+(i>=4?"score-high":i>=2?"score-mid":"score-low")+'" style="width:'+pct+'%"></div></div><span class="hist-count">'+bk[i]+"</span></div>";
      }
      h+="</div></div>";
    }
    app.innerHTML=h;
  }

  /* ---- test cases ---- */
  function renderTests(){
    var evalNames=getEvalNames();
    var h='<div class="filter-bar">';
    h+='<select id="flt-status" class="filter-select"><option value="all">All Status</option><option value="pass">Passed</option><option value="fail">Failed</option><option value="error">Errors</option></select>';
    if(tgtNames.length>1){
      h+='<select id="flt-target" class="filter-select"><option value="all">All Targets</option>';
      for(var i=0;i<tgtNames.length;i++)h+='<option value="'+esc(tgtNames[i])+'">'+esc(tgtNames[i])+"</option>";
      h+="</select>";
    }
    h+='<input type="text" id="flt-search" class="filter-search" placeholder="Search tests..." value="'+esc(state.filter.search)+'">';
    h+='<span class="filter-count" id="flt-count"></span></div>';

    h+='<div class="table-wrap"><table class="data-table" id="test-tbl"><thead><tr>';
    h+='<th class="expand-col"></th>';
    h+=sHdr("Status","status");
    h+=sHdr("Test ID","testId");
    if(tgtNames.length>1)h+=sHdr("Target","target");
    h+=sHdr("Score","score");
    for(var i=0;i<evalNames.length;i++)h+="<th>"+esc(evalNames[i])+"</th>";
    h+=sHdr("Duration","durationMs");
    h+=sHdr("Cost","costUsd");
    h+="</tr></thead><tbody id=\\"test-body\\"></tbody></table></div>";
    app.innerHTML=h;

    /* wire events */
    var selS=document.getElementById("flt-status");
    selS.value=state.filter.status;
    selS.addEventListener("change",function(e){state.filter.status=e.target.value;renderRows();});
    var selT=document.getElementById("flt-target");
    if(selT){selT.value=state.filter.target;selT.addEventListener("change",function(e){state.filter.target=e.target.value;renderRows();});}
    document.getElementById("flt-search").addEventListener("input",function(e){state.filter.search=e.target.value;renderRows();});
    var ths=document.querySelectorAll("th[data-sort]");
    for(var i=0;i<ths.length;i++){
      ths[i].addEventListener("click",(function(th){return function(){
        var c=th.getAttribute("data-sort");
        if(state.sort.col===c)state.sort.dir=state.sort.dir==="asc"?"desc":"asc";
        else{state.sort.col=c;state.sort.dir="asc";}
        renderTests();
      };})(ths[i]));
    }
    renderRows();
  }

  function sHdr(label,col){
    var arrow="";
    if(state.sort.col===col)arrow=state.sort.dir==="asc"?" \\u2191":" \\u2193";
    return'<th class="sortable" data-sort="'+col+'">'+label+arrow+"</th>";
  }

  function filtered(){
    var out=[];
    for(var i=0;i<DATA.length;i++){
      var r=DATA[i],s=getStatus(r);
      if(state.filter.status!=="all"&&s!==state.filter.status)continue;
      if(state.filter.target!=="all"&&r.target!==state.filter.target)continue;
      if(state.filter.search&&r.testId.toLowerCase().indexOf(state.filter.search.toLowerCase())===-1)continue;
      out.push(r);
    }
    var col=state.sort.col,dir=state.sort.dir==="asc"?1:-1;
    out.sort(function(a,b){
      var va=col==="status"?getStatus(a):a[col],vb=col==="status"?getStatus(b):b[col];
      if(va==null&&vb==null)return 0;if(va==null)return 1;if(vb==null)return-1;
      if(typeof va==="string")return va.localeCompare(vb)*dir;
      return(va-vb)*dir;
    });
    return out;
  }

  function renderRows(){
    var rows=filtered(),evalNames=getEvalNames();
    var tbody=document.getElementById("test-body");
    var colSpan=5+evalNames.length+(tgtNames.length>1?1:0);
    document.getElementById("flt-count").textContent=rows.length+" of "+DATA.length+" tests";
    var h="";
    for(var i=0;i<rows.length;i++){
      var r=rows[i],s=getStatus(r),key=r.testId+":"+r.target,exp=!!state.expanded[key];
      h+='<tr class="test-row '+s+(exp?" expanded":"")+'" data-key="'+esc(key)+'">';
      h+='<td class="expand-col"><span class="expand-icon">'+(exp?"\\u25BE":"\\u25B8")+"</span></td>";
      h+="<td>"+sIcon(s)+"</td>";
      h+='<td class="fw-medium">'+esc(r.testId)+"</td>";
      if(tgtNames.length>1)h+="<td>"+esc(r.target)+"</td>";
      h+='<td class="'+sCls(r.score)+'">'+fmtPct(r.score)+"</td>";
      for(var j=0;j<evalNames.length;j++){
        var es=getEvalScore(r,evalNames[j]);
        h+='<td class="'+sCls(es)+'">'+(es!=null?fmtPct(es):"\\u2014")+"</td>";
      }
      h+="<td>"+fmtDur(r.durationMs)+"</td><td>"+fmtCost(r.costUsd)+"</td></tr>";
      if(exp)h+='<tr class="detail-row"><td colspan="'+colSpan+'">'+renderDetail(r)+"</td></tr>";
    }
    if(rows.length===0)h+='<tr><td colspan="'+colSpan+'" class="empty-state">No matching tests</td></tr>';
    tbody.innerHTML=h;

    /* row click */
    var trs=tbody.querySelectorAll(".test-row");
    for(var k=0;k<trs.length;k++){
      trs[k].addEventListener("click",(function(tr){return function(){
        var key=tr.getAttribute("data-key");
        state.expanded[key]=!state.expanded[key];
        renderRows();
      };})(trs[k]));
    }
  }

  /* ---- detail panel ---- */
  function renderDetail(r){
    var h='<div class="detail-panel">';

    /* input / output */
    h+='<div class="detail-grid">';
    if(r.input!=null){
      h+='<div class="detail-block"><h4>Input</h4><pre class="detail-pre">'+esc(JSON.stringify(r.input,null,2))+"</pre></div>";
    }
    h+='<div class="detail-block"><h4>Output</h4><pre class="detail-pre">'+esc(r.output?JSON.stringify(r.output,null,2):"")+"</pre></div>";
    h+="</div>";

    /* grader results */
    if(r.scores&&r.scores.length>0){
      h+="<h4>Grader Results</h4>";
      h+='<table class="eval-table"><thead><tr><th>Grader</th><th>Score</th><th>Status</th><th>Assertions</th></tr></thead><tbody>';
      for(var i=0;i<r.scores.length;i++){
        var ev=r.scores[i],evS=ev.score>=0.5?"pass":"fail";
        var evAssertions=ev.assertions||[];
        var evSummary=evAssertions.map(function(a){return (a.passed?"✓ ":"✗ ")+a.text;}).join("; ");
        h+="<tr><td class=\\"fw-medium\\">"+esc(ev.name)+'</td><td class="'+sCls(ev.score)+'">'+fmtPct(ev.score)+"</td><td>"+sIcon(evS)+'</td><td class="reasoning-cell">'+esc(evSummary)+"</td></tr>";
      }
      h+="</tbody></table>";
    }

    /* assertions */
    var passedA=r.assertions?r.assertions.filter(function(a){return a.passed;}):[];
    var failedA=r.assertions?r.assertions.filter(function(a){return !a.passed;}):[];
    if(passedA.length>0){
      h+='<h4>Passed Assertions</h4><ul class="expect-list pass">';
      for(var i=0;i<passedA.length;i++)h+="<li>"+esc(passedA[i].text)+(passedA[i].evidence?" <span class=\\"reasoning-cell\\">("+esc(passedA[i].evidence)+")</span>":"")+"</li>";
      h+="</ul>";
    }
    if(failedA.length>0){
      h+='<h4>Failed Assertions</h4><ul class="expect-list fail">';
      for(var i=0;i<failedA.length;i++)h+="<li>"+esc(failedA[i].text)+(failedA[i].evidence?" <span class=\\"reasoning-cell\\">("+esc(failedA[i].evidence)+")</span>":"")+"</li>";
      h+="</ul>";
    }

    /* error */
    if(r.error)h+='<div class="error-box"><h4>Error</h4><pre>'+esc(r.error)+"</pre></div>";

    /* metadata */
    h+='<div class="detail-meta">';
    var m=[];
    if(r.tokenUsage)m.push(fmtTok(r.tokenUsage.input)+" in / "+fmtTok(r.tokenUsage.output)+" out tokens");
    if(r.durationMs)m.push(fmtDur(r.durationMs));
    if(r.target)m.push(r.target);
    if(r.costUsd)m.push(fmtCost(r.costUsd));
    if(r.timestamp)m.push(r.timestamp);
    h+=esc(m.join(" \\u00B7 "));
    h+="</div></div>";
    return h;
  }

  /* ---- init ---- */
  render();
})();
`;
