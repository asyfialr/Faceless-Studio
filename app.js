const stages=["Researching topic","Writing script","Generating voice","Preparing visuals","Rendering long video","Extracting Shorts","Adding captions","Ready for review"];
const productionStages=[["Voice","Generate US English narration"],["Visuals","Prepare scenes and B-roll"],["Captions","Create timed subtitles"],["Long Render","Assemble 16:9 master video"],["Shorts","Create 3 vertical clips"],["Review","Prepare outputs for approval"]];
let ideas=[["Why AI Agents Are Becoming the Next Big Tech Shift","AI","High potential"],["7 Technologies That Could Change Everyday Life by 2030","Future Tech","Evergreen"],["The Hidden AI Tools People Are Using to Save Hours Every Week","Productivity","Strong hook"],["What Happens When AI Can Work Without Constant Human Prompts?","AI","Explainer"]];
const ideaTemplates=[
["The {niche} Shift Most People Haven't Noticed Yet","Trend","Strong hook"],
["7 {niche} Changes That Could Matter in the Next Few Years","Explainer","Evergreen"],
["What Nobody Tells You About the Future of {niche}","Story","Curiosity"],
["How {niche} Is Quietly Changing Everyday Life","Documentary","Broad appeal"],
["The Biggest {niche} Mistakes People May Be Making Right Now","List","High CTR"],
["What Happens Next With {niche}?","Future","Discussion"]
];
let selectedTitle=sessionStorage.getItem("selectedTitle")||"Untitled AI Video", projectMade=false;
const $=id=>document.getElementById(id), pipeline=$("pipeline"), progressBar=$("progressBar"), progressLabel=$("progressLabel"), statusText=$("statusText"), createBtn=$("createBtn");
function drawStages(active=-1){pipeline.innerHTML=stages.map((s,i)=>`<div class="step ${i<=active?"done":""}"><span class="dot"></span><span>${s}</span></div>`).join("")}
function syncDashboardFromProject(d){
  d=d||{};
  var states=[
    !!(d.scriptReady||d.narration),
    !!d.voiceStored,
    !!(Array.isArray(d.visualPlan)&&d.visualPlan.length),
    !!d.productionReady,
    !!d.renderReady,
    !!d.shortsReady,
    !!d.captionTimingReady,
    !!d.captionsReady,
    !!d.metadata
  ],done=states.filter(Boolean).length,pct=Math.round(done/states.length*100);
  if(pipeline)pipeline.innerHTML=["Script","Voice","Visual plan","Visuals","Long video","3 Shorts","Caption timing","Captions","Metadata"].map(function(n,i){return '<div class="step '+(states[i]?"done":"")+'"><span class="dot"></span><span>'+n+(states[i]?" ✓":"")+'</span></div>'}).join("");
  if(progressBar)progressBar.style.width=pct+"%";if(progressLabel)progressLabel.textContent=pct+"%";
  var lc=$("longCount"),sc=$("shortCount"),qc=$("queueCount");if(lc)lc.textContent=d.renderReady?"1/1":"0/1";if(sc)sc.textContent=d.shortsReady?"3/3":"0/3";if(qc)qc.textContent="0";
  if(statusText)statusText.textContent=d.youtube?.scheduled?.length>=4?"YouTube scheduled ✓":(d.captionsReady&&d.metadata?"Production ready for publishing.":done?done+"/9 production stages ready.":"Ready to create your next faceless video.");
}
function renderIdeas(){
  $("ideaList").innerHTML=ideas.map(function(x,i){
    return '<article class="idea"><div class="idea-top"><h3>'+x[0]+'</h3><span class="tag">'+x[2]+'</span></div><p>'+x[1]+' • English US • Long + Shorts</p><a class="secondary link-btn use-idea" href="#scriptStudio" data-i="'+i+'">Use Idea</a></article>';
  }).join("");
  document.querySelectorAll(".use-idea").forEach(function(link){
    link.addEventListener("click",function(){
      selectedTitle=ideas[Number(link.getAttribute("data-i"))][0];
      sessionStorage.setItem("selectedTitle",selectedTitle);
      $("scriptTitle").textContent=selectedTitle;
      $("scriptOutput").textContent="Idea selected. Generate a draft to continue.";
      $("scriptOutput").classList.add("empty");
    });
  });
}
function showPage(id){
  document.querySelectorAll(".page").forEach(function(p){p.classList.toggle("active",p.id===id)});
  if(id==="reviewStudio"&&longRenderUrl)setTimeout(function(){selectPreview(0)},0);
  if(id==="projectsPage")loadProjectHistory();
  try{window.scrollTo(0,0)}catch(e){}
}
function syncHash(){
  var id=location.hash.slice(1)||"dashboard";
  if(document.getElementById(id))showPage(id);
}
async function refreshAutopilotMonitor(){
  var badge=$("monitorBadge");if(!badge)return;
  try{
    var settled=await Promise.allSettled([fetch(API_BASE+"/api/autopilot/health",{cache:"no-store"}),fetch(API_BASE+"/api/autopilot/validation",{cache:"no-store"}),fetch(API_BASE+"/api/autopilot/monitor",{cache:"no-store"})]);
    var health=null,v=null;
    if(settled[0].status==="fulfilled"&&settled[0].value.ok)health=await settled[0].value.json();
    if(settled[1].status==="fulfilled"&&settled[1].value.ok)v=await settled[1].value.json();
    var monitor=null;if(settled[2].status==="fulfilled"&&settled[2].value.ok)monitor=await settled[2].value.json();
    if(!health&&!v&&!monitor)throw new Error("Backend temporarily unavailable");
    var counts=v?.counts||{};
    $("monitorCompleted").textContent=counts.completed??"—";$("monitorActive").textContent=counts.active??health?.activeJobs??"—";$("monitorFailed").textContent=counts.failed??"—";$("monitorQueued").textContent=counts.queued??"—";
    badge.textContent=v?.passed?"V6.0 READY ✓":(health?.healthy?"ONLINE":"ATTENTION");
    var latest=v?.latestCompleted||health?.latestJob;
    $("monitorLatest").textContent=latest?("Latest: "+(latest.title||latest.id)+(latest.completedAt?" • completed "+new Date(latest.completedAt).toLocaleString():" • "+(latest.status||""))):"Backend online • waiting for production summary.";
    var checks=v?.checks||{},bad=Object.keys(checks).filter(function(k){return !checks[k]});$("monitorChecks").textContent=v?(bad.length?("Needs attention: "+bad.join(", ")):"All production checks passing ✓"):"Health online • validation will retry automatically.";
    if(monitor){var s=monitor.storage||{},gb=function(n){return Number.isFinite(Number(n))?(Number(n)/1073741824).toFixed(2)+" GB":"—"};$("monitorStorage").textContent=s.usedPercent!=null?s.usedPercent+"%":"—";$("monitorStorage").title=s.totalBytes?gb(s.usedBytes)+" / "+gb(s.totalBytes):"";$("monitorTts").textContent=monitor.tts?.provider||"unknown";$("monitorCost").textContent=monitor.tts?.usageEquivalentUsd!=null?"$"+Number(monitor.tts.usageEquivalentUsd).toFixed(6):"—";var r=monitor.recovery;$("monitorRecovery").textContent=r?("Last storage recovery: "+(r.title||r.jobId)+" • "+new Date(r.at).toLocaleString()+(r.version?" • "+r.version:"")):"Storage recovery: none recorded";}
    try{var er=await fetch(API_BASE+"/api/autopilot/engine/status",{cache:"no-store"});if(er.ok){var ed=await er.json(),eo=$("monitorEngine");if(eo)eo.textContent="Autopilot engine: "+(ed.enabled?"RUNNING ✓":"PAUSED")+" • "+(ed.config?.time||"19:00")+" "+(ed.config?.timeZone||"America/New_York");var ep=$("monitorPause"),ers=$("monitorResume");if(ep)ep.disabled=!ed.enabled;if(ers)ers.disabled=!!ed.enabled}}catch(_){}
  }catch(e){badge.textContent="RETRYING";$("monitorLatest").textContent="Backend is waking up or connection changed. Retrying automatically…";$("monitorChecks").textContent="Last dashboard values are kept until the backend responds."}
}
async function refreshAutopilotEngine(){
  var out=$("monitorEngine");if(!out)return;
  try{var r=await fetch(API_BASE+"/api/autopilot/engine/status",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.message||d.error);out.textContent="Autopilot engine: "+(d.enabled?"RUNNING ✓":"PAUSED")+" • "+(d.config?.time||"19:00")+" "+(d.config?.timeZone||"America/New_York");$("monitorPause").disabled=!d.enabled;$("monitorResume").disabled=!!d.enabled}catch(e){out.textContent="Autopilot engine: status unavailable"}
}
async function setAutopilotEngine(action){
  var p=$("monitorPause"),r=$("monitorResume");p.disabled=true;r.disabled=true;
  try{var x=await fetch(API_BASE+"/api/autopilot/engine/"+action,{method:"POST"}),d=await x.json();if(!x.ok)throw new Error(d.message||d.error);await refreshAutopilotEngine();await refreshAutopilotMonitor()}catch(e){$("monitorEngine").textContent="Autopilot control failed: "+(e.message||e)}
}
function bindAutopilotEngineControls(){
  var p=$("monitorPause"),r=$("monitorResume");if(p)p.onclick=function(){setAutopilotEngine("pause")};if(r)r.onclick=function(){setAutopilotEngine("resume")};
  refreshAutopilotEngine();
}
bindAutopilotEngineControls();
setTimeout(refreshAutopilotEngine,1500);
setInterval(refreshAutopilotEngine,30000);
refreshAutopilotMonitor();setInterval(refreshAutopilotMonitor,10000);
window.addEventListener("hashchange",syncHash);
async function loadProjectHistory(){
  var box=$("projects");if(!box)return;box.classList.remove("empty");box.innerHTML='<div class="card"><p class="muted">Loading saved projects…</p></div>';
  try{var r=await fetch(API_BASE+"/api/projects",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.message||d.error||"Projects unavailable");var list=d.projects||[],showArchived=localStorage.getItem("showArchivedProjects")==="1",visible=list.filter(function(p){return showArchived||!p.archived});if(!visible.length){box.classList.add("empty");box.innerHTML='<button id="toggleArchivedProjects" class="secondary">'+(showArchived?"Hide Archived":"Show Archived")+'</button><p>No '+(showArchived?"saved":"active")+' projects.</p>';var t=document.getElementById("toggleArchivedProjects");if(t)t.onclick=toggleArchivedProjects;return}
    box.innerHTML='<div class="project-toolbar"><button id="toggleArchivedProjects" class="secondary">'+(showArchived?"Hide Archived":"Show Archived")+'</button><span class="muted">'+visible.length+' project'+(visible.length===1?"":"s")+'</span></div>'+visible.map(function(p){
      var state=p.archived?"Archived":(p.youtubeVerified?"YouTube Verified ✓":(p.productionReady?"Production Ready":"In Progress")),active=!p.archived&&localStorage.getItem("activeProjectId")===p.id,schedule=(p.schedule||[]).map(function(x){return '<span>'+escapeHtml(x.type)+': '+escapeHtml(new Date(x.publishAt).toLocaleString())+'</span>'}).join("");
      return '<article class="card project-history '+(active?"active-project":"")+(p.archived?" archived-project":"")+'" data-project-id="'+escapeHtml(p.id)+'"><div><p class="eyebrow">'+state+(active?" • ACTIVE ✓":"")+'</p><h3>'+escapeHtml(p.title||"Untitled project")+'</h3><p class="muted">'+p.progress+'% production • Long '+(p.longVideoId?"1/1":"0/1")+' • Shorts '+p.shortCount+'/3'+(p.thumbnailVerified?' • Custom thumbnail ✓':'')+'</p>'+(p.attention&&!p.archived?'<p class="project-attention">Needs attention: '+escapeHtml(p.attention)+'</p>':'')+'<div class="project-schedule">'+(schedule||'<span>Not scheduled</span>')+'</div></div><div class="project-actions">'+(!p.archived?'<button class="secondary set-active-project" data-id="'+escapeHtml(p.id)+'">'+(active?"Active ✓":"Set Active")+'</button>'+(active?'<a class="primary link-btn continue-project" href="#dashboard">Continue Project</a>':''):'')+'<button class="secondary archive-project" data-id="'+escapeHtml(p.id)+'" data-archived="'+(p.archived?"1":"0")+'">'+(p.archived?"Restore":"Archive")+'</button>'+(p.archived?'<button class="secondary delete-project" data-id="'+escapeHtml(p.id)+'" data-title="'+escapeHtml(p.title||"Untitled project")+'">Delete Permanently</button>':'')+'</div></article>'
    }).join("");
    var toggle=document.getElementById("toggleArchivedProjects");if(toggle)toggle.onclick=toggleArchivedProjects;
    document.querySelectorAll(".set-active-project").forEach(function(b){b.onclick=async function(){var id=b.getAttribute("data-id");b.disabled=true;b.textContent="Loading…";localStorage.setItem("activeProjectId",id);try{var pr=await fetch(API_BASE+"/api/projects/"+encodeURIComponent(id),{cache:"no-store"}),pd=await pr.json();if(!pr.ok)throw new Error(pd.error||"Project unavailable");if(pd.title){selectedTitle=pd.title;sessionStorage.setItem("selectedTitle",pd.title)}syncDashboardFromProject(pd);await restoreProjectCheckpoint();await restorePersistentProject();await loadProjectHistory()}catch(e){b.disabled=false;b.textContent="Retry Set Active"}}});
    document.querySelectorAll(".archive-project").forEach(function(b){b.onclick=async function(){var id=b.getAttribute("data-id"),restore=b.getAttribute("data-archived")==="1";if(!restore&&!confirm("Archive this project? Files will be kept and can be restored later."))return;b.disabled=true;var ar=await fetch(API_BASE+"/api/projects/"+encodeURIComponent(id)+"/archive",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:!restore})}),ad=await ar.json();if(!ar.ok){b.disabled=false;b.textContent="Retry";return}if(!restore&&localStorage.getItem("activeProjectId")===id)localStorage.removeItem("activeProjectId");await loadProjectHistory()}});
    document.querySelectorAll(".delete-project").forEach(function(b){b.onclick=async function(){var id=b.getAttribute("data-id"),title=b.getAttribute("data-title")||"Untitled project",typed=prompt('Permanent delete cannot be undone.\n\nType the project title exactly to delete:\n'+title);if(typed===null)return;if(typed!==title){alert("Title did not match. Project was not deleted.");return}if(!confirm("Delete this archived project and all generated files permanently?"))return;b.disabled=true;b.textContent="Deleting…";var dr=await fetch(API_BASE+"/api/projects/"+encodeURIComponent(id),{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmation:typed})}),dd=await dr.json();if(!dr.ok){alert(dd.message||dd.error||"Delete failed");b.disabled=false;b.textContent="Delete Permanently";return}if(localStorage.getItem("activeProjectId")===id)localStorage.removeItem("activeProjectId");await loadProjectHistory()}});
  }catch(e){box.innerHTML='<div class="card"><p class="muted">Projects could not load: '+escapeHtml(e.message)+'</p></div>'}
}
function toggleArchivedProjects(){localStorage.setItem("showArchivedProjects",localStorage.getItem("showArchivedProjects")==="1"?"0":"1");loadProjectHistory()}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function addProjects(){projectMade=true;$("projects").classList.remove("empty");$("projects").innerHTML=`<div class="project"><div><strong>${selectedTitle}</strong><small>Long • 8–10 min • Ready for review</small></div><span>16:9</span></div>`+[1,2,3].map((n)=>`<div class="project"><div><strong>Short #00${n}</strong><small>Derived from long video • Ready</small></div><span>9:16</span></div>`).join("")}
createBtn.onclick=async()=>{createBtn.disabled=true;$("queueCount").textContent="1";$("longCount").textContent="0/1";$("shortCount").textContent="0/3";for(let i=0;i<stages.length;i++){drawStages(i);let pct=Math.round((i+1)/stages.length*100);progressBar.style.width=pct+"%";progressLabel.textContent=pct+"%";statusText.textContent=stages[i]+"…";if(i===4)$("longCount").textContent="1/1";if(i>=5)$("shortCount").textContent=Math.min(3,i-4)+"/3";await new Promise(r=>setTimeout(r,420))}$("shortCount").textContent="3/3";$("queueCount").textContent="0";statusText.textContent="Production complete. Ready for review and scheduling.";addProjects();createBtn.disabled=false;createBtn.textContent="Create Another"};
$("autopilot").onchange=e=>{localStorage.autopilot=e.target.checked?"1":"0";statusText.textContent=e.target.checked?"Autopilot enabled. Future runs can be scheduled automatically.":"Autopilot off. Manual approval mode active."};
$("autopilot").checked=localStorage.autopilot==="1";$("saveSettings").onclick=()=>{["niche","audience","duration","shortsSetting","voice"].forEach(k=>localStorage[k]=$(k).value);$("savedText").textContent="Saved on this device ✓";setTimeout(()=>$("savedText").textContent="",1800)};["niche","audience","duration","shortsSetting","voice"].forEach(k=>{if(localStorage[k])$(k).value=localStorage[k]});
drawStages();renderIdeas();if(selectedTitle!=="Untitled AI Video")$("scriptTitle").textContent=selectedTitle;
function generatePrototypeIdeas(){
  var niche=$("ideaNiche").value.trim()||"AI & Technology";
  var audience=$("ideaAudience").value;
  $("ideaStatus").textContent="Generating concepts…";
  $("generateIdeas").disabled=true;
  setTimeout(function(){
    ideas=ideaTemplates.slice().sort(function(){return Math.random()-.5}).slice(0,4).map(function(x){
      return [x[0].split("{niche}").join(niche),x[1]+" • "+audience,x[2]];
    });
    renderIdeas();
    $("ideaStatus").textContent="4 ideas generated • prototype engine";
    $("generateIdeas").disabled=false;
  },650);
}
$("generateIdeas").onclick=generatePrototypeIdeas;
if(localStorage.niche)$("ideaNiche").value=localStorage.niche;
if(localStorage.audience)$("ideaAudience").value=localStorage.audience;

async function buildScriptDraft(){
  if(!selectedTitle||selectedTitle==="Untitled AI Video"){ $("scriptOutput").textContent="Choose an idea from the Ideas tab first."; return; }
  $("generateScript").disabled=true;$("generateScript").textContent="Generating with AI…";
  try{
    var r=await fetch(API_BASE+"/api/ai/script",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title:selectedTitle,audience:localStorage.audience||"US / International",duration:localStorage.duration||"8-10 minutes"})
    });
    var data=await r.json();
    if(!r.ok)throw new Error(data.message||data.details||data.error||"AI request failed");
    var x=data.script; sessionStorage.setItem("aiNarration",x.narration||"");
    $("scriptOutput").classList.remove("empty");
    $("scriptOutput").innerHTML=
      '<div class="script-block"><h3>Hook</h3><p>'+escapeHtml(x.hook||"")+'</p></div>'+
      '<div class="script-block"><h3>Outline</h3><ol>'+(x.outline||[]).map(function(v){return "<li>"+escapeHtml(v)+"</li>"}).join("")+'</ol></div>'+
      '<div class="script-block"><h3>Narration Draft</h3><p>'+escapeHtml(x.narration||"")+'</p></div>'+
      '<div class="script-block"><h3>Shorts Angles</h3><ol>'+(x.shortsAngles||[]).map(function(v){return "<li>"+escapeHtml(v)+"</li>"}).join("")+'</ol></div>'+
      '<button id="sendProduction" class="primary">Send to Production</button>';
    $("sendProduction").onclick=function(){
      sessionStorage.setItem("selectedTitle",selectedTitle);sessionStorage.setItem("scriptReady","1");
      $("productionTitle").textContent=selectedTitle;$("productionStatus").textContent="AI script approved. Production is ready to start.";
      location.hash="productionStudio";
    };
    $("generateScript").textContent="Regenerate with AI";
  }catch(e){
    $("scriptOutput").classList.remove("empty");
    $("scriptOutput").textContent=e.message==="OPENAI_API_KEY is not configured on the server."?"AI belum diaktifkan. Tambahkan OPENAI_API_KEY di Railway → Variables.":"AI generation failed: "+e.message;
    $("generateScript").textContent="Try Again";
  }finally{$("generateScript").disabled=false}
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]})}
$("generateScript").onclick=buildScriptDraft;

function drawProduction(active=-1,done=-1){
  $("productionSteps").innerHTML=productionStages.map(function(s,i){
    var cls=i<=done?"done":(i===active?"running":"");
    var state=i<=done?"Done":(i===active?"Working…":"Waiting");
    return '<div class="production-step '+cls+'"><span class="num">'+(i+1)+'</span><div><strong>'+s[0]+'</strong><small>'+s[1]+'</small></div><span class="state">'+state+'</span></div>';
  }).join("");
}
async function runProduction(){
  if(sessionStorage.getItem("scriptReady")!=="1"){
    $("productionStatus").textContent="Generate a script and send it to production first.";
    return;
  }
  $("startProduction").disabled=true;$("productionResult").innerHTML="";
  for(var i=0;i<productionStages.length;i++){
    $("productionStatus").textContent=productionStages[i][1]+"…";
    drawProduction(i,i-1);
    await new Promise(function(r){setTimeout(r,520)});
  }
  drawProduction(-1,productionStages.length-1);
  $("productionStatus").textContent="Production complete. Outputs are ready for review.";
  $("productionResult").innerHTML='<div class="result-card"><h3>Long Video</h3><p>16:9 • 8–10 min • Ready for review</p></div><div class="result-card"><h3>3 Shorts</h3><p>9:16 • Derived highlights • Ready for review</p><div class="result-actions"><button id="saveProject" class="primary">Save to Projects</button></div></div>';
  $("saveProject").textContent="Review Outputs";
  $("saveProject").onclick=function(){
    sessionStorage.setItem("productionReady","1");
    setupReview();
    location.hash="reviewStudio";
  };
  $("startProduction").disabled=false;$("startProduction").textContent="Run Again";
}
$("startProduction").onclick=runProduction;
drawProduction();
if(sessionStorage.getItem("scriptReady")==="1"){
  $("productionTitle").textContent=selectedTitle;
  $("productionStatus").textContent="Script approved. Production is ready to start.";
}

var reviewStates=["pending","pending","pending","pending"];
function setupReview(){
  var ready=sessionStorage.getItem("productionReady")==="1";
  $("reviewTitle").textContent=ready?selectedTitle:"No production ready";
  if(ready){
    $("youtubeTitle").value=selectedTitle;
    $("youtubeDescription").value="A clear, faceless explainer about "+selectedTitle+".";
    $("reviewStatus").textContent="Review the long video and all Shorts.";
  }
  renderReview();
}
function renderReview(){
  var labels=[["Long Video","16:9 • 8–10 min"],["Short #001","9:16 • Highlight 1"],["Short #002","9:16 • Highlight 2"],["Short #003","9:16 • Highlight 3"]];
  $("reviewOutputs").innerHTML=labels.map(function(x,i){
    var state=reviewStates[i];
    return '<div class="review-item '+state+'"><div><strong>'+x[0]+'</strong><small>'+x[1]+' • '+state+'</small></div><div class="review-buttons"><button class="mini '+(state==="approved"?"active":"")+'" data-review="'+i+'" data-state="approved">Approve</button><button class="mini '+(state==="rejected"?"active":"")+'" data-review="'+i+'" data-state="rejected">Reject</button></div></div>';
  }).join("");
  document.querySelectorAll("[data-review]").forEach(function(b){b.onclick=function(){reviewStates[Number(b.dataset.review)]=b.dataset.state;renderReview()}});
  var approved=reviewStates.filter(function(x){return x==="approved"}).length;
  $("approvalCount").textContent=approved+"/4 approved";
  $("readySchedule").disabled=approved!==4;
  if(approved===4)$("reviewStatus").textContent="Everything approved. Ready for scheduling.";
}
$("readySchedule").onclick=function(){
  sessionStorage.setItem("reviewApproved","1");
  addProjects();
  $("reviewStatus").textContent="Approved ✓ Project is ready for the scheduling stage.";
  $("readySchedule").textContent="Open Scheduler";$("readySchedule").disabled=false;$("readySchedule").onclick=function(){location.hash="scheduler"};
};
setupReview();

function isoDate(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
(function initScheduler(){
  var d=new Date();d.setDate(d.getDate()+1);
  if(!$("scheduleDate").value)$("scheduleDate").value=isoDate(d);
  if(sessionStorage.getItem("reviewApproved")==="1")$("scheduleStatus").textContent="Review approved. Choose a publishing plan.";
})();
$("buildSchedule").onclick=function(){
  if(sessionStorage.getItem("reviewApproved")!=="1"){
    $("scheduleStatus").textContent="Approve all 4 outputs in Review Studio first.";
    return;
  }
  var date=$("scheduleDate").value,time=$("scheduleTime").value,tz=$("scheduleTimezone");
  var interval=Number($("shortInterval").value);
  if(!date||!time){$("scheduleStatus").textContent="Choose a date and time first.";return}
  var base=new Date(date+"T12:00:00");
  var rows=[{name:"Long Video",date:isoDate(base),time:time,type:"16:9"}];
  for(var i=1;i<=3;i++){var d=new Date(base);d.setDate(d.getDate()+i*interval);rows.push({name:"Short #00"+i,date:isoDate(d),time:time,type:"9:16"})}
  $("scheduleQueue").innerHTML=rows.map(function(x,i){return '<div class="schedule-item"><span class="order">'+(i+1)+'</span><div><strong>'+x.name+'</strong><small>'+x.date+' • '+x.time+' • '+tz.options[tz.selectedIndex].text+'</small></div><span class="tag">'+x.type+'</span></div>'}).join("")+'<div class="card schedule-ready"><strong>Schedule prepared ✓</strong><p class="muted">No video will be uploaded yet. YouTube connection comes in the next integration stage.</p></div>';
  $("scheduleStatus").textContent="4 publishing slots prepared.";
  sessionStorage.setItem("scheduleReady","1");
};

const ytChecks=[["GitHub Pages dashboard","Ready"],["Secure backend","Required"],["Google OAuth client","Required"],["YouTube channel authorization","Pending"],["Upload & scheduling API","Pending"]];
function renderYouTubeSetup(){
  $("ytChecklist").innerHTML=ytChecks.map(function(x){return '<div class="check-row"><strong>'+x[0]+'</strong><span>'+x[1]+'</span></div>'}).join("");
}
$("connectYouTube").onclick=function(){
  $("ytMessage").textContent="Dashboard is ready. A secure backend must be connected before Google sign-in can start.";
  $("ytState").textContent="Backend required";
  $("connectYouTube").textContent="Waiting for Backend";
  $("connectYouTube").disabled=true;
  setTimeout(function(){$("connectYouTube").disabled=false;$("connectYouTube").textContent="Check Connection"},1200);
};
renderYouTubeSetup();

var activePreview=0;
var shortRenderUrls=["","",""];
var longRenderUrl="";
const previewItems=[["Long Video","16:9","landscape"],["Short #001","9:16","portrait"],["Short #002","9:16","portrait"],["Short #003","9:16","portrait"]];
function selectPreview(i){
  activePreview=i;
  var x=previewItems[i];
  $("previewName").textContent=x[0];$("previewBadge").textContent=x[1];
  $("videoStage").className="video-stage "+x[2];
  document.querySelectorAll(".preview-choice").forEach(function(b){b.classList.toggle("active",Number(b.dataset.preview)===i)});
  var pv=$("previewVideo"),ph=$("previewPlaceholder");
  if(i>0&&shortRenderUrls[i-1]){
    pv.src=shortRenderUrls[i-1];pv.load();pv.style.display="block";if(ph)ph.style.display="none";
    $("previewMessage").textContent=reviewStates[i]==="approved"?"Approved ✓":"Rendered Short #00"+i+" ready for review.";
  }else if(i===0&&longRenderUrl){
    if(pv.src!==longRenderUrl){pv.src=longRenderUrl;pv.load()}
    pv.style.display="block";if(ph)ph.style.display="none";
    $("previewMessage").textContent=reviewStates[i]==="approved"?"Approved ✓":"Rendered Long MP4 ready for review.";
  }else{
    if(i!==0){pv.removeAttribute("src");pv.load()}
    if(ph)ph.style.display=i===0&&longRenderUrl?"none":"";
    $("previewMessage").textContent=reviewStates[i]==="approved"?"Approved ✓":"No rendered video yet — player wiring is ready.";
  }
}
document.querySelectorAll(".preview-choice").forEach(function(b){b.onclick=function(){selectPreview(Number(b.dataset.preview))}});
$("previewApprove").onclick=function(){
  if(sessionStorage.getItem("productionReady")!=="1"){$("previewMessage").textContent="Complete Production first.";return}
  reviewStates[activePreview]="approved";renderReview();selectPreview(activePreview);
};
$("previewRegenerate").onclick=function(){
  if(sessionStorage.getItem("productionReady")!=="1"){$("previewMessage").textContent="Complete Production first.";return}
  reviewStates[activePreview]="pending";renderReview();
  $("previewMessage").textContent="Marked for regeneration. Real regeneration will be connected to the renderer backend.";
};
selectPreview(0);

const API_BASE="https://faceless-studio-production-c487.up.railway.app";
async function loadAutopilotPlan(){
  var status=document.getElementById("autopilotPlanStatus");if(!status)return;
  try{var r=await fetch(API_BASE+"/api/autopilot/config",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load plan");
    document.getElementById("autopilotPlanEnabled").checked=d.enabled===true;document.getElementById("autopilotPlanTime").value=d.time||"19:00";document.getElementById("autopilotPlanTimezone").value=d.timeZone||"America/New_York";document.getElementById("autopilotPlanInterval").value=String(d.shortIntervalDays||1);
    document.querySelectorAll(".autopilot-days input").forEach(function(x){x.checked=(d.days||[]).includes(x.value)});
    status.textContent=(d.enabled?"Plan enabled ✓":"Plan saved • disabled")+" • config-only safety mode";
  }catch(e){status.textContent="Autopilot plan unavailable: "+e.message}
}
async function saveAutopilotPlan(){
  var btn=document.getElementById("saveAutopilotPlan"),status=document.getElementById("autopilotPlanStatus"),days=Array.from(document.querySelectorAll(".autopilot-days input:checked")).map(function(x){return x.value});
  if(!days.length){status.textContent="Select at least one production day.";return}
  btn.disabled=true;btn.textContent="Saving…";
  try{var payload={enabled:document.getElementById("autopilotPlanEnabled").checked,days:days,time:document.getElementById("autopilotPlanTime").value,timeZone:document.getElementById("autopilotPlanTimezone").value,shortIntervalDays:Number(document.getElementById("autopilotPlanInterval").value)},r=await fetch(API_BASE+"/api/autopilot/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok)throw new Error(d.error||"Save failed");status.textContent=(d.config.enabled?"Plan enabled ✓":"Plan saved • disabled")+" • "+d.config.days.join(", ")+" "+d.config.time+" "+d.config.timeZone+" • config-only safety mode";btn.textContent="Save Autopilot Plan"}catch(e){status.textContent="Save failed: "+e.message;btn.textContent="Retry Save"}finally{btn.disabled=false}
}
var saveAutopilotPlanButton=document.getElementById("saveAutopilotPlan");if(saveAutopilotPlanButton)saveAutopilotPlanButton.onclick=function(e){e.preventDefault();saveAutopilotPlan()};
loadAutopilotPlan();async function refreshAutopilotHealth(){var el=document.getElementById("autopilotHealthStatus");if(!el)return;try{var r=await fetch(API_BASE+"/api/autopilot/health",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.message||d.error||"health unavailable");el.textContent=(d.healthy?" • 🟢 Autopilot Healthy":" • 🔴 Autopilot Needs Attention")+" • "+d.activeJobs+" active"+(d.busy?" • working":"")}catch(e){el.textContent=" • ⚪ Health unavailable"}}
function bindAutopilotStatsToggle(){var btn=document.getElementById("toggleAutopilotStatsDetails"),details=document.getElementById("autopilotStatsDetails");if(!btn||btn.dataset.bound)return;btn.dataset.bound="1";btn.onclick=function(){var open=details&&!details.hidden;if(details)details.hidden=open;btn.textContent=open?"Show Stats Details":"Hide Stats Details"}}bindAutopilotStatsToggle();
async function refreshAutopilotStats(){var el=document.getElementById("autopilotProductionStats"),details=document.getElementById("autopilotStatsDetails");if(!el)return;try{var r=await fetch(API_BASE+"/api/autopilot/stats",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.message||d.error||"stats unavailable");el.textContent=d.completedJobs+" productions • "+d.totalVideos+" videos • "+Math.round(d.totalDurationSeconds)+"s • "+d.totalVisuals+" visuals • TTS usage $"+Number(d.ttsUsageEquivalentUsd||0).toFixed(6)+(d.freeTierMayCover?" • Free tier may cover ✓":"");if(details)details.textContent="Average: "+d.averageDurationSeconds+"s / production • "+d.averageVisuals+" visuals • "+d.averageVideos+" videos • Last completed: "+(d.lastCompletedAt||"—")}catch(e){el.textContent="Production stats unavailable"}}
async function refreshAutopilotEngine(){
  var state=document.getElementById("autopilotEngineState"),status=document.getElementById("autopilotEngineStatus"),history=document.getElementById("autopilotRunHistory");if(!state)return;
  try{var er=await fetch(API_BASE+"/api/autopilot/engine/status",{cache:"no-store"}),e=await er.json();if(!er.ok)throw new Error(e.error||"Engine unavailable");state.textContent=!e.enabled?"Engine armed • plan disabled":e.due?"Due now ✓":"Engine armed • waiting";status.textContent="Recurring schedule: "+e.local.day+" "+e.local.date+" "+e.local.time+" • target "+e.config.time+" "+e.config.timeZone+" • Queue worker: autonomous";
    var hr=await fetch(API_BASE+"/api/autopilot/history",{cache:"no-store"}),h=await hr.json(),runs=h.runs||[];history.innerHTML=runs.length?runs.slice(0,5).map(function(x){return '<div class="autopilot-history-row"><strong>'+escapeHtml(x.status)+'</strong><span>'+escapeHtml(x.slot)+'</span></div>'}).join(""):'<span class="muted">No dry runs recorded yet.</span>';
    var jobsBox=document.getElementById("autopilotJobs"),jr=await fetch(API_BASE+"/api/autopilot/jobs",{cache:"no-store"}),j=await jr.json(),jobs=j.jobs||[],jobDone=function(x){return x.stage==="complete"||x.status==="youtube-complete"},activeJobs=jobs.filter(function(x){return !jobDone(x)}),completedJobs=jobs.filter(jobDone),showJobHistory=localStorage.getItem("showAutopilotJobHistory")==="1",renderJob=function(x){return '<div class="autopilot-job-row"><div class="autopilot-history-row"><strong>'+escapeHtml(x.status)+'</strong><span>'+escapeHtml(x.stage)+(x.title?' • '+escapeHtml(x.title):'')+(x.projectId?' • '+escapeHtml(x.projectId):'')+(x.sceneCount?' • '+x.sceneCount+' scenes':'')+(x.visualCount!=null?' • '+x.visualCount+' visuals':'')+(x.longDuration?' • '+x.longDuration+'s Long':'')+(x.shortCount!=null?' • '+x.shortCount+'/3 Shorts':'')+(x.captionEngine?' • Captions '+escapeHtml(x.captionTiming||'ready'):'')+(x.metadataReady?' • Metadata ✓':'')+(x.thumbnailReady?' • Thumbnail ✓':'')+(x.youtubeVideoCount?' • YouTube '+x.youtubeVideoCount+'/4 ✓':'')+(x.youtubeVerified?' • Reality Check ✓':'')+(x.recovered?' • Recovered ✓':'')+(x.voiceProvider?' • TTS '+escapeHtml(x.voiceProvider):'')+(x.costEstimate&&x.costEstimate.ttsUsageEquivalentUsd!=null?' • TTS usage '+Number(x.costEstimate.ttsUsageEquivalentUsd).toFixed(6)+' USD'+(x.costEstimate.freeTierMayCover?' • Free tier may cover ✓':''):'')+(x.publishSlot?' • Publish '+escapeHtml(x.publishSlot):'')+' • '+escapeHtml(x.slot)+'</span></div>'+((x.error&&x.status!=='youtube-complete'&&x.stage!=='complete')?'<div class="autopilot-job-error">'+escapeHtml(x.error)+'</div>':'')+(x.status==='visual-plan-failed'?'<button class="secondary retry-visual-plan" data-id="'+escapeHtml(x.id)+'">Retry Visual Plan</button>':'')+'</div>'};if(jobsBox){var visibleJobs=activeJobs.concat(showJobHistory?completedJobs.slice(0,20):[]);jobsBox.innerHTML='<div class="project-toolbar"><span class="muted">'+activeJobs.length+' active • '+completedJobs.length+' completed</span>'+(completedJobs.length?'<button id="toggleAutopilotJobHistory" class="secondary">'+(showJobHistory?'Hide History':'Show History')+'</button>':'')+'</div>'+(visibleJobs.length?visibleJobs.map(renderJob).join(""):'<span class="muted">No active production jobs.</span>');var hj=document.getElementById("toggleAutopilotJobHistory");if(hj)hj.onclick=function(){localStorage.setItem("showAutopilotJobHistory",showJobHistory?"0":"1");refreshAutopilotEngine()}};document.querySelectorAll('.retry-visual-plan').forEach(function(b){b.onclick=async function(){b.disabled=true;b.textContent='Retrying…';try{var rr=await fetch(API_BASE+'/api/autopilot/jobs/'+encodeURIComponent(b.dataset.id)+'/retry-visual-plan',{method:'POST'}),rd=await rr.json();if(!rr.ok)throw new Error(rd.message||rd.error||'Retry failed');await refreshAutopilotEngine()}catch(e){alert('Retry failed: '+e.message);b.disabled=false;b.textContent='Retry Visual Plan'}}});
    var topicsBox=document.getElementById("autopilotTopics"),tr=await fetch(API_BASE+"/api/autopilot/topics",{cache:"no-store"}),td=await tr.json(),topics=td.topics||[],pendingTopics=topics.filter(function(x){return x.status!=="consumed"}),consumedTopics=topics.filter(function(x){return x.status==="consumed"}),showTopicHistory=localStorage.getItem("showAutopilotTopicHistory")==="1";if(topicsBox){var visibleTopics=pendingTopics.concat(showTopicHistory?consumedTopics.slice().reverse().slice(0,20):[]);topicsBox.innerHTML='<div class="project-toolbar"><span class="muted">'+pendingTopics.length+' pending • '+consumedTopics.length+' consumed</span>'+(consumedTopics.length?'<button id="toggleAutopilotTopicHistory" class="secondary">'+(showTopicHistory?'Hide History':'Show History')+'</button>':'')+'</div>'+(visibleTopics.length?visibleTopics.map(function(x){return '<div class="autopilot-history-row"><strong>'+escapeHtml(x.status)+'</strong><span>'+escapeHtml(x.title)+'</span></div>'}).join(""):'<span class="muted">Queue empty • completed topics are in History.</span>');var ht=document.getElementById("toggleAutopilotTopicHistory");if(ht)ht.onclick=function(){localStorage.setItem("showAutopilotTopicHistory",showTopicHistory?"0":"1");refreshAutopilotEngine()}};
  }catch(err){state.textContent="Engine unavailable";status.textContent=err.message}
}
async function runAutopilotDryRun(){
  var btn=document.getElementById("runAutopilotDryRun"),status=document.getElementById("autopilotEngineStatus");btn.disabled=true;btn.textContent="Checking…";
  try{var r=await fetch(API_BASE+"/api/autopilot/engine/dry-run",{method:"POST"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Dry run failed");status.textContent=d.due?(d.recorded?"Due ✓ Dry-run slot recorded. No production started.":"Due slot already locked. No duplicate run."):"Not due • "+d.local.day+" "+d.local.date+" "+d.local.time+" vs "+d.config.time;await refreshAutopilotEngine()}catch(e){status.textContent="Dry run failed: "+e.message}finally{btn.disabled=false;btn.textContent="Run Dry Check"}
}
async function addAutopilotTopics(){
  var input=document.getElementById("autopilotTopicInput"),btn=document.getElementById("addAutopilotTopics"),topics=(input?.value||"").split(/[,\n]+/).map(function(x){return x.trim()}).filter(Boolean);if(!topics.length)return;btn.disabled=true;btn.textContent="Adding…";
  try{var r=await fetch(API_BASE+"/api/autopilot/topics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({topics:topics})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not add topics");input.value="";await refreshAutopilotEngine()}catch(e){alert("Topic queue failed: "+e.message)}finally{btn.disabled=false;btn.textContent="Add Topics to Queue"}
}
async function runNextAutopilotTopic(){
  var btn=document.getElementById("runNextAutopilotTopic"),status=document.getElementById("runNextAutopilotStatus");if(!btn)return;btn.disabled=true;btn.textContent="Starting…";if(status)status.textContent="Assigning the next queued topic…";
  try{var r=await fetch(API_BASE+"/api/autopilot/run-next",{method:"POST"}),d=await r.json();if(!r.ok)throw new Error(d.message||d.error||"Could not start queued topic");if(status)status.textContent="Started ✓ "+(d.topic?.title||"queued topic")+" • normal autonomous pipeline";await refreshAutopilotEngine()}
  catch(e){if(status)status.textContent="Could not start: "+e.message}
  finally{btn.disabled=false;btn.textContent="Run Next Queued Topic"}
}
var addAutopilotTopicsButton=document.getElementById("addAutopilotTopics");if(addAutopilotTopicsButton)addAutopilotTopicsButton.onclick=function(e){e.preventDefault();addAutopilotTopics()};
var runNextAutopilotButton=document.getElementById("runNextAutopilotTopic");if(runNextAutopilotButton)runNextAutopilotButton.onclick=function(e){e.preventDefault();runNextAutopilotTopic()};
var dryRunButton=document.getElementById("runAutopilotDryRun");if(dryRunButton)dryRunButton.onclick=function(e){e.preventDefault();runAutopilotDryRun()};
refreshAutopilotEngine();refreshAutopilotHealth();refreshAutopilotStats();
setInterval(function(){if(location.hash==="#scheduler"){refreshAutopilotEngine();refreshAutopilotHealth();refreshAutopilotStats()}},30000);

syncHash();
async function restorePersistentProject(){
  var id=localStorage.getItem("activeProjectId");if(!id)return;
  try{var r=await fetch(API_BASE+"/api/projects/"+encodeURIComponent(id),{cache:"no-store"});if(!r.ok)return;
    var p=await r.json();if(!p.longVideoUrl)return;longRenderUrl=API_BASE+p.longVideoUrl;if(Array.isArray(p.shorts))shortRenderUrls=p.shorts.map(function(x){return API_BASE+x+"?v="+new Date(p.updatedAt||Date.now()).getTime()});sessionStorage.setItem("renderReady","1");sessionStorage.setItem("productionReady","1");
    var rv=document.getElementById("renderedVideo");if(rv){rv.src=longRenderUrl;rv.style.display="block"}
    var pv=document.getElementById("previewVideo"),ph=document.getElementById("previewPlaceholder");
    if(pv){pv.src=longRenderUrl;pv.load()}if(ph)ph.style.display="none";
    var rs=document.getElementById("renderStatus");if(rs)rs.textContent="Persistent MP4 restored ✓";
    var pm=document.getElementById("previewMessage");if(pm)pm.textContent="Saved Long MP4 restored from storage ✓";
    if(location.hash==="#reviewStudio")setTimeout(function(){selectPreview(0)},50);
  }catch(e){var pm=document.getElementById("previewMessage");if(pm)pm.textContent="Storage restore failed: "+e.message}
}
window.addEventListener("load",function(){setTimeout(restorePersistentProject,250)});
async function fetchWithTimeout(url,ms){
  const controller=new AbortController();
  const timer=setTimeout(function(){controller.abort()},ms);
  try{return await fetch(url,{cache:"no-store",signal:controller.signal})}
  finally{clearTimeout(timer)}
}
async function checkBackend(){
  $("backendState").textContent="Checking backend…";
  $("backendDot").className="status-dot";
  try{
    const healthRes=await fetchWithTimeout(API_BASE+"/api/health",8000);
    if(!healthRes.ok)throw new Error("Health check failed");
    const health=await healthRes.json();
    $("backendState").textContent="Backend Online ✓";
    $("backendUrl").textContent=health.service+" • v"+health.version;
    $("backendDot").className="status-dot online";
    $("ytState").textContent="Backend connected";
    $("ytMessage").textContent="Railway API is online. Google OAuth is the next connection step.";
    $("ytDot").className="status-dot ready";
    ytChecks[1][1]="Ready";
    renderYouTubeSetup();
    try{
      const capRes=await fetchWithTimeout(API_BASE+"/api/capabilities",4000);
      if(capRes.ok){
        const caps=await capRes.json();
        ytChecks[2][1]=caps.youtube?"Ready":"Required";
        renderYouTubeSetup();
      }
    }catch(ignore){}
    return true;
  }catch(e){
    $("backendState").textContent="Backend Offline";
    $("backendUrl").textContent="Railway API did not respond";
    $("backendDot").className="status-dot offline";
    $("ytState").textContent="Backend unavailable";
    $("ytMessage").textContent="Railway health check failed. Try again.";
    return false;
  }
}
$("connectYouTube").onclick=async function(){
  $("connectYouTube").disabled=true;
  $("connectYouTube").textContent="Checking…";
  await checkBackend();
  $("connectYouTube").disabled=false;
  $("connectYouTube").textContent="Check Connection";
};

document.addEventListener("click",function(e){
  if(e.target&&e.target.id==="previewVoice")previewNarrationVoice();
  if(e.target&&e.target.id==="stopVoice")stopNarrationVoice();
});

async function generateServerVoice(){
  var narration=sessionStorage.getItem("aiNarration")||"";
  if(!narration){$("productionStatus").textContent="No narration stored. Generate the AI script again first.";return}
  var btn=$("generateVoice"),player=$("voicePlayer");
  btn.disabled=true;btn.textContent="Generating voice…";$("productionStatus").textContent="Gemini is generating WAV narration…";
  try{
    var r=await fetch(API_BASE+"/api/ai/voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:narration})});
    var data=await r.json();
    if(!r.ok)throw new Error(data.details||data.message||data.error||"TTS request failed");
    player.src="data:"+(data.mimeType||"audio/wav")+";base64,"+data.audio;
    player.style.display="block";player.load();
    $("productionStatus").textContent="Voice generated ✓ Press Play on the audio player.";
    btn.textContent="↻ Regenerate Voice";
  }catch(e){$("productionStatus").textContent="Voice generation failed: "+e.message;btn.textContent="Try Voice Again"}
  finally{btn.disabled=false}
}
document.addEventListener("click",function(e){if(e.target&&e.target.id==="generateVoice")generateServerVoice()});

async function generateVisualPlan(){
  var narration=sessionStorage.getItem("aiNarration")||"";
  var out=$("visualPlanOutput"),btn=$("generateVisualPlan");
  if(!narration){out.textContent="Generate the AI script first.";return}
  btn.disabled=true;btn.textContent="Planning visuals…";out.classList.remove("empty");out.textContent="Gemini is breaking the narration into scenes…";
  try{
    var r=await fetch(API_BASE+"/api/ai/visual-plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:selectedTitle,narration:narration})});
    var data=await r.json();if(!r.ok)throw new Error(data.details||data.message||data.error);sessionStorage.removeItem("visualPlanError");
    var scenes=Array.isArray(data.plan)?data.plan:((data.plan&&Array.isArray(data.plan.scenes))?data.plan.scenes:(Array.isArray(data.scenes)?data.scenes:[]));if(!scenes.length)throw new Error("Gemini returned no usable scenes.");
    sessionStorage.setItem("visualPlan",JSON.stringify(scenes));
    out.innerHTML=scenes.map(function(x,i){return '<div class="plan-scene" data-scene="'+i+'"><strong>Scene '+x.scene+' • '+x.duration+'</strong><p>'+x.visualPrompt+'</p>'+(x.onScreenText?'<small>Text: '+x.onScreenText+'</small>':'')+'<div class="script-actions"><button class="secondary generate-scene-media" data-scene="'+i+'">Generate Visual</button></div><div class="scene-media-status muted">Waiting</div><div class="scene-media-preview" hidden></div></div>'}).join("");
    $("mediaSummary").textContent="Media queue: 0/"+scenes.length+" scenes prepared.";
    btn.textContent="↻ Regenerate Visual Plan";$("productionStatus").textContent="Visual plan ready ✓ "+scenes.length+" scenes prepared.";
  }catch(e){var msg="Visual planning failed: "+e.message;sessionStorage.setItem("visualPlanError",msg);out.textContent=msg;btn.textContent="Try Visual Plan Again"}
  finally{btn.disabled=false}
}
document.addEventListener("click",function(e){if(e.target&&e.target.id==="generateVisualPlan")generateVisualPlan()});

async function prepareSceneMedia(index,button){
  var scenes=[];try{scenes=JSON.parse(sessionStorage.getItem("visualPlan")||"[]")}catch(e){}
  var scene=scenes[index],card=button.closest(".plan-scene"),status=card&&card.querySelector(".scene-media-status"),preview=card&&card.querySelector(".scene-media-preview");
  if(!scene||!status||!preview)return;
  button.disabled=true;button.textContent="Generating…";status.textContent="Cloudflare AI is creating this scene…";
  try{
    var r=await fetch(API_BASE+"/api/ai/image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:scene.visualPrompt})});
    var data=await r.json();if(!r.ok)throw new Error(data.details||data.message||data.error||"Image generation failed");
    preview.hidden=false;preview.innerHTML='<img src="data:'+(data.mimeType||"image/jpeg")+';base64,'+data.image+'" alt="Generated visual for scene '+scene.scene+'" style="width:100%;border-radius:14px;margin-top:10px">';
    status.textContent="AI visual ready ✓"+(data.provider?" • "+data.provider:"");button.textContent="↻ Regenerate Visual";
    var queue=[];try{queue=JSON.parse(sessionStorage.getItem("mediaQueue")||"[]")}catch(e){}
    queue=queue.filter(function(x){return x.scene!==scene.scene});queue.push({scene:scene.scene,prompt:scene.visualPrompt,status:"generated"});
    sessionStorage.setItem("mediaQueue",JSON.stringify(queue));
    $("mediaSummary").textContent="Media queue: "+queue.length+"/"+scenes.length+" visuals generated.";
    $("productionStatus").textContent="Scene "+scene.scene+" visual generated ✓";
  }catch(e){status.textContent="Visual failed: "+e.message;button.textContent="Try Generate Visual Again"}
  finally{button.disabled=false}
}
async function generateAllVisuals(){
  var master=document.getElementById("generateAllVisuals"),progress=document.getElementById("generateAllProgress");
  var buttons=Array.from(document.querySelectorAll(".generate-scene-media"));
  if(!buttons.length){progress.textContent="Generate a Visual Plan first.";return}
  master.disabled=true;master.textContent="Generating All…";
  var ok=0,failed=0,skipped=0;
  for(var i=0;i<buttons.length;i++){
    var card=buttons[i].closest(".plan-scene"),sceneStatus=card.querySelector(".scene-media-status"),preview=card.querySelector(".scene-media-preview img");
    if(preview&&(sceneStatus.textContent||"").includes("ready ✓")){ok++;skipped++;progress.textContent="Keeping existing visual "+(i+1)+"/"+buttons.length+" • "+ok+" ready";continue}
    progress.textContent="Generating missing visual "+(i+1)+"/"+buttons.length+" • "+ok+" ready"+(failed?" • "+failed+" failed":"");
    await prepareSceneMedia(Number(buttons[i].getAttribute("data-scene")),buttons[i]);
    if((sceneStatus.textContent||"").includes("ready ✓"))ok++;else failed++;
  }
  progress.textContent="Batch complete • "+ok+"/"+buttons.length+" visuals ready"+(skipped?" • "+skipped+" reused":"")+(failed?" • "+failed+" failed":"")+" ✓";
  master.textContent=failed?"Retry / Generate All Visuals":"↻ Regenerate All Visuals";master.disabled=false;
}
function buildSceneMotion(){
  var status=document.getElementById("motionPlanStatus"),btn=document.getElementById("buildMotionPlan"),scenes=[],queue=[];
  try{scenes=JSON.parse(sessionStorage.getItem("visualPlan")||"[]");queue=JSON.parse(sessionStorage.getItem("mediaQueue")||"[]")}catch(e){}
  if(!scenes.length){status.textContent="Generate a Visual Plan first.";return}
  var generated=new Set(queue.filter(function(x){return x.status==="generated"}).map(function(x){return x.scene}));
  var motions=["slow-zoom-in","pan-left","slow-zoom-out","pan-right"];
  var plan=scenes.map(function(s,i){return {scene:s.scene,duration:s.duration,motion:motions[i%motions.length],visualReady:generated.has(s.scene)}});
  sessionStorage.setItem("motionPlan",JSON.stringify(plan));
  document.querySelectorAll(".plan-scene").forEach(function(card,i){
    var old=card.querySelector(".scene-motion");if(old)old.remove();
    var note=document.createElement("div");note.className="scene-motion muted";
    note.textContent="Motion: "+plan[i].motion.replaceAll("-"," ")+" • "+plan[i].duration;
    card.appendChild(note);
  });
  var ready=plan.filter(function(x){return x.visualReady}).length;
  status.textContent="Motion plan ready ✓ "+plan.length+" scenes • "+ready+" visuals available";
  btn.textContent="↻ Rebuild Scene Motion";$("productionStatus").textContent="Scene motion plan ready ✓";
}
async function analyzeCaptionTiming(){
  var btn=document.getElementById("analyzeCaptionTiming"),status=document.getElementById("captionTimingStatus"),id=localStorage.getItem("activeProjectId");
  if(!id){status.textContent="Render the Long MP4 first.";return}
  btn.disabled=true;btn.textContent="Analyzing…";status.textContent="Analyzing voice.wav for word timestamps…";
  try{var r=await fetch(API_BASE+"/api/captions/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id})});var d=await r.json();if(!r.ok)throw new Error(d.error||"Timing analysis failed");status.textContent="Precision timing validated ✓ "+d.wordCount+" words • "+Math.round((d.coverage||0)*100)+"% audio coverage • "+Number(d.start).toFixed(1)+"s–"+Number(d.end).toFixed(1)+"s";btn.textContent="↻ Re-analyze Timing";sessionStorage.setItem("captionTimingReady","1")}
  catch(e){status.textContent="Precision timing failed: "+e.message+" Stable captions are unchanged.";btn.textContent="Try Timing Again"}
  finally{btn.disabled=false}
}
var timingButton=document.getElementById("analyzeCaptionTiming");if(timingButton)timingButton.onclick=function(e){e.preventDefault();analyzeCaptionTiming()};

async function burnShortCaptions(){
  var btn=document.getElementById("burnCaptions"),status=document.getElementById("captionStatus"),id=localStorage.getItem("activeProjectId"),narration=sessionStorage.getItem("aiNarration")||"";
  if(!id||!narration){status.textContent="Generate narration and Shorts first.";return}
  btn.disabled=true;btn.textContent="Adding Captions…";status.textContent="Rendering captions: Long + 3 Shorts… This can take a few minutes.";
  try{var r=await fetch(API_BASE+"/api/render/captions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,narration:narration})});var d=await r.json();if(!r.ok)throw new Error(d.message||d.error||"Caption render failed");
    var stampNow=Date.now();if(d.longVideoUrl){longRenderUrl=API_BASE+d.longVideoUrl+"?v="+stampNow}shortRenderUrls=d.shorts.map(function(x){return API_BASE+x+"?v="+stampNow});status.textContent="Long + Shorts captions ready ✓";btn.textContent="↻ Rebuild Captions";sessionStorage.setItem("captionsReady","1");selectPreview(activePreview);var rv=document.getElementById("renderedVideo");if(rv&&longRenderUrl){rv.src=longRenderUrl;rv.load()}
  }catch(e){status.textContent="Captions failed: "+e.message;btn.textContent="Try Captions Again"}finally{btn.disabled=false}
}
var captionButton=document.getElementById("burnCaptions");if(captionButton)captionButton.onclick=function(e){e.preventDefault();burnShortCaptions()};
async function refreshYouTubeStatus(){
  var state=document.getElementById("ytState"),msg=document.getElementById("ytMessage"),dot=document.getElementById("ytDot"),btn=document.getElementById("connectYouTube");if(!state)return;
  try{var r=await fetch(API_BASE+"/api/youtube/status",{cache:"no-store"}),d=await r.json();if(d.connected){state.textContent=d.editScope?"Connected ✓ Full publishing access":"Connected • Reconnect required";msg.textContent=d.editScope?"Upload + scheduling permission active.":("Scheduling scope missing. Granted: "+(Array.isArray(d.scopes)&&d.scopes.length?d.scopes.join(" | "):"none")+(d.scopeVerified?" • Google verified":" • scope not verified")+(d.apiError?" • API: "+d.apiError:""));dot.classList.toggle("online",Boolean(d.editScope));btn.textContent="Reconnect YouTube";btn.onclick=function(){location.href=API_BASE+"/api/youtube/connect"}}
    else if(d.configured){state.textContent="Ready to connect";msg.textContent="OAuth credentials detected. Connect your YouTube channel.";dot.classList.remove("online");btn.textContent="Connect YouTube";btn.onclick=function(){location.href=API_BASE+"/api/youtube/connect"}}
    else{state.textContent="OAuth setup required";msg.textContent="Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Railway first.";dot.classList.remove("online");btn.textContent="Check Connection";btn.onclick=refreshYouTubeStatus}}
  catch(e){state.textContent="Backend unavailable";msg.textContent=e.message;dot.classList.remove("online")}
}
refreshYouTubeStatus();
window.addEventListener("hashchange",function(){if(location.hash==="#youtubeConnect")refreshYouTubeStatus()});

async function uploadYouTubeLong(){
  var btn=document.getElementById("uploadYouTubeLong"),status=document.getElementById("youtubeUploadStatus"),link=document.getElementById("youtubeUploadedLink"),id=localStorage.getItem("activeProjectId");
  if(!id){status.textContent="Render/select a project first.";return}
  var title=document.getElementById("youtubeTitle")?.value||sessionStorage.getItem("selectedTitle")||"Faceless Studio Video",description=document.getElementById("youtubeDescription")?.value||"";
  btn.disabled=true;btn.textContent="Uploading…";status.textContent="Uploading Long video to YouTube as Private… Keep this page open.";
  try{var r=await fetch(API_BASE+"/api/youtube/upload-long",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,title:title,description:description})}),d=await r.json();if(!r.ok)throw new Error(d.error||"YouTube upload failed");
    status.textContent="YouTube upload complete ✓ Video ID: "+d.videoId+" • Private";link.href=d.url;link.style.display="inline-block";link.textContent="Open uploaded video ↗";btn.textContent="Uploaded ✓";
  }catch(e){status.textContent="Upload failed: "+e.message;btn.textContent="Try Upload Again"}finally{btn.disabled=false}
}
var youtubeUploadButton=document.getElementById("uploadYouTubeLong");if(youtubeUploadButton)youtubeUploadButton.onclick=function(e){e.preventDefault();uploadYouTubeLong()};

async function uploadYouTubeShorts(){
  var btn=document.getElementById("uploadYouTubeShorts"),status=document.getElementById("youtubeUploadStatus"),id=localStorage.getItem("activeProjectId");
  if(!id){status.textContent="Render/select a project first.";return}
  var title=document.getElementById("youtubeTitle")?.value||sessionStorage.getItem("selectedTitle")||"Faceless Studio",description=document.getElementById("youtubeDescription")?.value||"";
  btn.disabled=true;var done=[];
  try{for(var i=1;i<=3;i++){btn.textContent="Uploading Short "+i+"/3…";status.textContent="Uploading Short "+i+" of 3 to YouTube as Private…";var r=await fetch(API_BASE+"/api/youtube/upload-short",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,index:i,title:(function(){try{return JSON.parse(sessionStorage.getItem("youtubeShortTitles")||"[]")[i-1]||title+" — Short "+i}catch(e){return title+" — Short "+i}})(),description:description})}),d=await r.json();if(!r.ok)throw new Error("Short "+i+": "+(d.error||"upload failed"));done.push(d)}
    status.textContent="3 Shorts uploaded to YouTube ✓ All Private";btn.textContent="3 Shorts Uploaded ✓";
  }catch(e){status.textContent="Shorts upload stopped: "+e.message+" • "+done.length+"/3 completed";btn.textContent="Try Upload Shorts Again"}finally{btn.disabled=false}
}
var youtubeShortsButton=document.getElementById("uploadYouTubeShorts");if(youtubeShortsButton)youtubeShortsButton.onclick=function(e){e.preventDefault();uploadYouTubeShorts()};

async function applyYouTubePrivacy(){
  var btn=document.getElementById("applyYouTubePrivacy"),status=document.getElementById("youtubePublishStatus"),id=localStorage.getItem("activeProjectId"),privacy=document.getElementById("youtubePrivacy")?.value||"private";
  if(!id){status.textContent="Select an uploaded project first.";return}
  var label=privacy.charAt(0).toUpperCase()+privacy.slice(1);
  if(privacy==="public"&&!confirm("Publish the uploaded Long + Shorts publicly on YouTube now?"))return;
  btn.disabled=true;btn.textContent="Applying…";status.textContent="Updating YouTube visibility to "+label+"…";
  try{var r=await fetch(API_BASE+"/api/youtube/publish-project",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,privacyStatus:privacy})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Publishing failed");status.textContent=d.updated.length+" YouTube videos updated ✓ "+label;btn.textContent="Applied ✓"}
  catch(e){status.textContent="Publishing failed: "+e.message;btn.textContent="Try Again"}finally{btn.disabled=false}
}
var youtubePrivacyButton=document.getElementById("applyYouTubePrivacy");if(youtubePrivacyButton)youtubePrivacyButton.onclick=function(e){e.preventDefault();applyYouTubePrivacy()};

async function scheduleYouTubeProject(){
  var btn=document.getElementById("scheduleYouTubeProject"),status=document.getElementById("youtubeRealScheduleStatus"),id=localStorage.getItem("activeProjectId");
  var date=document.getElementById("youtubeScheduleDate")?.value||document.getElementById("scheduleDate")?.value,time=document.getElementById("youtubeScheduleTime")?.value||document.getElementById("scheduleTime")?.value,timeZone=document.getElementById("youtubeScheduleTimezone")?.value||document.getElementById("scheduleTimezone")?.value||"America/New_York",interval=Number(document.getElementById("youtubeShortInterval")?.value||document.getElementById("shortInterval")?.value||1);
  if(!id){status.textContent="Select an uploaded project first.";return}if(!date||!time){status.textContent="Set date/time in Scheduler first.";return}
  if(!date||!time){status.textContent="Set a schedule date and time first.";return}
  if(!confirm("Schedule the Long video and 3 Shorts on YouTube using this plan?"))return;
  btn.disabled=true;btn.textContent="Scheduling…";status.textContent="Sending publishing schedule to YouTube…";
  try{var r=await fetch(API_BASE+"/api/youtube/schedule-project",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,scheduleDate:date,scheduleTime:time,timeZone:timeZone,shortIntervalDays:interval})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Scheduling failed");status.textContent=d.scheduled.length+" videos scheduled on YouTube ✓";btn.textContent="Scheduled ✓"}
  catch(e){status.textContent="Scheduling failed: "+e.message;btn.textContent="Try Schedule Again"}finally{btn.disabled=false}
}
var youtubeScheduleButton=document.getElementById("scheduleYouTubeProject");if(youtubeScheduleButton)youtubeScheduleButton.onclick=function(e){e.preventDefault();scheduleYouTubeProject()};

function syncYouTubeScheduleControls(){
  var map=[["scheduleDate","youtubeScheduleDate"],["scheduleTime","youtubeScheduleTime"],["scheduleTimezone","youtubeScheduleTimezone"],["shortInterval","youtubeShortInterval"]];
  map.forEach(function(pair){var a=document.getElementById(pair[0]),b=document.getElementById(pair[1]);if(!a||!b)return;if(!b.value)b.value=a.value;else if(!a.value)a.value=b.value;b.onchange=function(){a.value=b.value};a.onchange=function(){b.value=a.value}});
  var d=document.getElementById("youtubeScheduleDate");if(d&&!d.value){var n=new Date();n.setDate(n.getDate()+1);d.value=isoDate(n);var a=document.getElementById("scheduleDate");if(a)a.value=d.value}
}
syncYouTubeScheduleControls();
async function autoPublishYouTube(){
  var btn=document.getElementById("autoPublishYouTube"),status=document.getElementById("youtubeRealScheduleStatus"),id=localStorage.getItem("activeProjectId");
  var date=document.getElementById("youtubeScheduleDate")?.value||document.getElementById("scheduleDate")?.value,time=document.getElementById("youtubeScheduleTime")?.value||document.getElementById("scheduleTime")?.value,timeZone=document.getElementById("youtubeScheduleTimezone")?.value||document.getElementById("scheduleTimezone")?.value||"America/New_York",interval=Number(document.getElementById("youtubeShortInterval")?.value||document.getElementById("shortInterval")?.value||1);
  var title=document.getElementById("youtubeTitle")?.value||sessionStorage.getItem("selectedTitle")||"Faceless Studio Video",description=document.getElementById("youtubeDescription")?.value||"";
  if(!id){status.textContent="Select a rendered project first.";return}if(!date||!time){status.textContent="Set a future date/time in Scheduler first.";return}
  if(!date||!time){status.textContent="Set a schedule date and time first.";return}
  if(!confirm("Auto Publish will upload any missing Long/Shorts as Private, then schedule all 4 on YouTube. Continue?"))return;
  btn.disabled=true;btn.textContent="Auto Publishing…";
  try{
    status.textContent="Checking existing YouTube uploads…";var pr=await fetch(API_BASE+"/api/projects/"+encodeURIComponent(id)),project=pr.ok?await pr.json():{},yt=project.youtube||{};try{var vr=await fetch(API_BASE+"/api/youtube/verify-project",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id})}),vd=await vr.json();if(vr.ok&&vd.youtube)yt=vd.youtube}catch(e){}
    if(!yt.longVideoId){status.textContent="Uploading missing Long video…";var lr=await fetch(API_BASE+"/api/youtube/upload-long",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,title:title,description:description})}),ld=await lr.json();if(!lr.ok)throw new Error(ld.error||"Long upload failed")}
    for(var i=1;i<=3;i++){var current=(yt.shorts||[])[i-1];if(!current?.videoId){status.textContent="Uploading missing Short "+i+"/3…";var sr=await fetch(API_BASE+"/api/youtube/upload-short",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,index:i,title:(function(){try{return JSON.parse(sessionStorage.getItem("youtubeShortTitles")||"[]")[i-1]||title+" — Short "+i}catch(e){return title+" — Short "+i}})(),description:description})}),sd=await sr.json();if(!sr.ok)throw new Error("Short "+i+": "+(sd.error||"upload failed"))}}
    status.textContent="Applying Long thumbnail…";var ta=await fetch(API_BASE+"/api/youtube/apply-thumbnail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id})}),tad=await ta.json();if(!ta.ok||!tad.thumbnailApplied)throw new Error(tad.error||"Long thumbnail could not be applied");
    status.textContent="Long thumbnail applied ✓ Verifying Long + 3 Shorts on YouTube…";var verify=await fetch(API_BASE+"/api/youtube/verify-project",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id})}),verified=await verify.json();if(!verify.ok)throw new Error(verified.error||"YouTube verification failed");var vyt=verified.youtube||{},missing=[];if(!vyt.longVideoId)missing.push("Long");for(var vi=0;vi<3;vi++)if(!vyt.shorts?.[vi]?.videoId)missing.push("Short "+(vi+1));if(missing.length)throw new Error("YouTube verification missing: "+missing.join(", "));
    status.textContent="4 uploads verified ✓ Applying YouTube schedule…";var rr=await fetch(API_BASE+"/api/youtube/schedule-project",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,scheduleDate:date,scheduleTime:time,timeZone:timeZone,shortIntervalDays:interval})}),rd=await rr.json();if(!rr.ok)throw new Error(rd.error||"Scheduling failed");if(rd.scheduled.length!==4)throw new Error("Expected 4 scheduled videos, got "+rd.scheduled.length);
    status.textContent="Schedule applied. Running YouTube Reality Check…";var rc=await fetch(API_BASE+"/api/youtube/reality-check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id})}),reality=await rc.json();if(!rc.ok)throw new Error(reality.error||"Reality Check failed");if(!reality.ready){var problems=[];if(reality.missing?.length)problems.push("missing "+reality.missing.join(", "));if(reality.unscheduled?.length)problems.push("unscheduled "+reality.unscheduled.join(", "));if(!reality.thumbnailOk)problems.push("Long custom thumbnail not confirmed by YouTube");throw new Error("Reality Check: "+problems.join(" • "))}status.textContent="YouTube Reality Check ✓ 1 Long + 3 Shorts + custom thumbnail + schedules confirmed";btn.textContent="Auto Publish Verified ✓";
  }catch(e){status.textContent="Auto Publish stopped: "+e.message;btn.textContent="Retry Auto Publish"}finally{btn.disabled=false}
}
var autoPublishButton=document.getElementById("autoPublishYouTube");if(autoPublishButton)autoPublishButton.onclick=function(e){e.preventDefault();autoPublishYouTube()};

function autopilotWait(test,timeout,label){return new Promise(function(resolve,reject){var started=Date.now(),timer=setInterval(function(){try{if(test()){clearInterval(timer);resolve()}else if(Date.now()-started>timeout){clearInterval(timer);reject(new Error(label+" timed out"))}}catch(e){clearInterval(timer);reject(e)}},500)})}
async function saveProjectCheckpoint(extra){
  var id=localStorage.getItem("activeProjectId");if(!id)return false;
  var payload=Object.assign({title:sessionStorage.getItem("selectedTitle")||selectedTitle||"",narration:sessionStorage.getItem("aiNarration")||"",visualPlan:(function(){try{return JSON.parse(sessionStorage.getItem("visualPlan")||"[]")}catch(e){return[]}})(),metadata:(function(){try{return JSON.parse(sessionStorage.getItem("youtubeMetadataDraft")||"null")}catch(e){return null}})(),scriptReady:sessionStorage.getItem("scriptReady")==="1",renderReady:sessionStorage.getItem("renderReady")==="1",shortsReady:sessionStorage.getItem("shortsReady")==="1",captionTimingReady:sessionStorage.getItem("captionTimingReady")==="1",captionsReady:sessionStorage.getItem("captionsReady")==="1"},extra||{});
  try{var r=await fetch(API_BASE+"/api/projects/"+encodeURIComponent(id)+"/checkpoint",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});return r.ok}catch(e){return false}
}
async function restoreProjectCheckpoint(){
  var id=localStorage.getItem("activeProjectId");if(!id)return false;
  try{var r=await fetch(API_BASE+"/api/projects/"+encodeURIComponent(id),{cache:"no-store"});if(!r.ok)return false;var d=await r.json();
    if(d.title){selectedTitle=d.title;sessionStorage.setItem("selectedTitle",d.title)}
    if(d.narration)sessionStorage.setItem("aiNarration",d.narration);
    if(Array.isArray(d.visualPlan)&&d.visualPlan.length)sessionStorage.setItem("visualPlan",JSON.stringify(d.visualPlan));
    if(d.metadata){sessionStorage.setItem("youtubeMetadataDraft",JSON.stringify(d.metadata));sessionStorage.setItem("youtubeMetadataReady","1");var m=d.metadata;
      var el=document.getElementById("metadataLongTitle");if(el)el.value=m.longTitle||"";el=document.getElementById("metadataDescription");if(el)el.value=m.description||"";el=document.getElementById("metadataHashtags");if(el)el.value=m.hashtags||"";for(var i=1;i<=3;i++){el=document.getElementById("metadataShort"+i);if(el)el.value=m.shortsTitles?.[i-1]||""}
      var st=document.getElementById("metadataStatus");if(st)st.textContent="Metadata restored from project ✓";
    }
    ["scriptReady","renderReady","shortsReady","captionTimingReady","captionsReady"].forEach(function(k){if(d[k])sessionStorage.setItem(k,"1")});
    var thumb=document.getElementById("thumbnailPreview"),thumbStatus=document.getElementById("thumbnailStatus"),thumbBtn=document.getElementById("generateThumbnail");if(d.thumbnailUrl&&thumb){thumb.src=API_BASE+d.thumbnailUrl+"?v="+encodeURIComponent(d.updatedAt||"1");thumb.style.display="block";if(thumbStatus)thumbStatus.textContent="Thumbnail restored ✓ 1280×720"+(d.thumbnailProvider?" • "+d.thumbnailProvider:"");if(thumbBtn)thumbBtn.textContent="↻ Regenerate Thumbnail"}
    syncDashboardFromProject(d);return true;
  }catch(e){return false}
}
restoreProjectCheckpoint();
async function restorePersistedVoice(){
  var id=localStorage.getItem("activeProjectId"),player=document.getElementById("voicePlayer");if(!id||!player)return false;
  try{var r=await fetch(API_BASE+"/api/projects/"+encodeURIComponent(id),{cache:"no-store"});if(!r.ok)return false;var d=await r.json(),url=d.voiceUrl||(d.voiceStored?"/media/"+encodeURIComponent(id)+"/voice.wav":"");if(!url)return false;
    var a=await fetch(API_BASE+url,{cache:"no-store"});if(!a.ok)return false;var blob=await a.blob(),reader=new FileReader();var dataUrl=await new Promise(function(resolve,reject){reader.onload=function(){resolve(reader.result)};reader.onerror=reject;reader.readAsDataURL(blob)});
    player.src=dataUrl;player.style.display="block";player.load();return true;
  }catch(e){return false}
}
async function runFullAutopilot(){
  var btn=document.getElementById("runFullAutopilot"),status=document.getElementById("autopilotStatus");
  if(!selectedTitle||selectedTitle==="Untitled AI Video"){status.textContent="Choose an idea in Ideas first.";location.hash="ideas";return}
  if(!confirm("Run the full production pipeline for: "+selectedTitle+"? Heavy render stages will run one at a time."))return;
  btn.disabled=true;btn.textContent="Autopilot Running…";
  try{
    if(!sessionStorage.getItem("aiNarration")){status.textContent="1/10 • Writing AI script…";await buildScriptDraft()}else status.textContent="1/10 • Script checkpoint reused ✓";if(!sessionStorage.getItem("aiNarration"))throw new Error("Script was not generated.");
    sessionStorage.setItem("selectedTitle",selectedTitle);sessionStorage.setItem("scriptReady","1");document.getElementById("productionTitle").textContent=selectedTitle;
    var voice=document.getElementById("voicePlayer");if(!voice?.src?.startsWith("data:audio")){status.textContent="2/10 • Restoring voice checkpoint…";var restored=await restorePersistedVoice();if(!restored){status.textContent="2/10 • Generating voice…";await generateServerVoice()}else status.textContent="2/10 • Persisted voice restored ✓"}else status.textContent="2/10 • Voice checkpoint reused ✓";if(!voice?.src?.startsWith("data:audio")){var vs=(document.getElementById("productionStatus")?.textContent||"").trim();throw new Error(vs||"Voice generation failed.")}
    if(!document.querySelectorAll(".generate-scene-media").length){status.textContent="3/10 • Planning visuals…";await generateVisualPlan()}else status.textContent="3/10 • Visual plan checkpoint reused ✓";if(!document.querySelectorAll(".generate-scene-media").length){var vp=sessionStorage.getItem("visualPlanError")||(document.getElementById("visualPlanOutput")?.textContent||"").trim();throw new Error(vp&&vp!=="No visual plan yet."?vp:"Visual plan failed. Check Gemini response.")}
    status.textContent="4/10 • Generating scene visuals…";await generateAllVisuals();var mediaStatus=Array.from(document.querySelectorAll(".scene-media-status")),failedVisual=mediaStatus.find(function(x){return !(x.textContent||"").includes("ready ✓")});if(!mediaStatus.length||failedVisual){var visualError=failedVisual?(failedVisual.textContent||"Visual generation failed."):"No visual scenes were found.";throw new Error(visualError)}
    buildSceneMotion();
    if(!sessionStorage.getItem("renderReady")){status.textContent="5/10 • Rendering Long video…";await renderMp4()}else status.textContent="5/10 • Long render checkpoint reused ✓";if(!sessionStorage.getItem("renderReady"))throw new Error("Long render failed.");
    if(!sessionStorage.getItem("shortsReady")){status.textContent="6/10 • Rendering 3 Shorts…";await generateShorts()}else status.textContent="6/10 • Shorts checkpoint reused ✓";if(!sessionStorage.getItem("shortsReady"))throw new Error("Shorts render failed.");
    if(!sessionStorage.getItem("captionTimingReady")){status.textContent="7/10 • Analyzing precision captions…";await analyzeCaptionTiming()}else status.textContent="7/10 • Caption timing checkpoint reused ✓";if(!sessionStorage.getItem("captionTimingReady"))throw new Error("Caption timing failed.");
    if(!sessionStorage.getItem("captionsReady")){status.textContent="8/10 • Burning captions…";await burnShortCaptions()}else status.textContent="8/10 • Captions checkpoint reused ✓";if(!sessionStorage.getItem("captionsReady"))throw new Error("Caption render failed.");
    status.textContent="9/10 • Generating YouTube metadata…";await generateMetadata();var mt=document.getElementById("metadataLongTitle")?.value;if(!mt)throw new Error("Metadata generation failed.");useMetadataDraft();
    status.textContent="10/10 • Generating Smart Thumbnail…";var thumbWarning="";try{await generateThumbnail();var ts=(document.getElementById("thumbnailStatus")?.textContent||"");if(!ts.includes("Thumbnail ready ✓"))thumbWarning=ts||"Thumbnail needs retry."}catch(te){thumbWarning="Thumbnail needs retry: "+te.message}
    await saveProjectCheckpoint({productionReady:true,thumbnailWarning:thumbWarning||""});status.textContent=thumbWarning?"Full production ready ✓ Thumbnail needs retry in Review. Opening YouTube Auto Publish…":"Full production + Smart Thumbnail ready ✓ Opening YouTube Auto Publish…";btn.textContent="✓ Production Ready";location.hash="youtubeConnect";setTimeout(async function(){try{var ys=await fetch(API_BASE+"/api/youtube/status",{cache:"no-store"}),yd=await ys.json();if(yd.connected&&yd.editScope&&document.getElementById("scheduleDate")?.value&&document.getElementById("scheduleTime")?.value){var ps=document.getElementById("youtubeRealScheduleStatus");if(ps)ps.textContent="Autopilot production complete ✓ Ready for final Auto Publish confirmation.";var ap=document.getElementById("autoPublishYouTube");if(ap)ap.scrollIntoView({behavior:"smooth",block:"center"})}}catch(e){}},500);
  }catch(e){status.textContent="Autopilot stopped: "+e.message;btn.textContent="↻ Resume Autopilot"}finally{btn.disabled=false}
}
var fullAutopilotButton=document.getElementById("runFullAutopilot");if(fullAutopilotButton)fullAutopilotButton.onclick=function(e){e.preventDefault();runFullAutopilot()};

async function generateMetadata(){
  var btn=document.getElementById("generateMetadata"),status=document.getElementById("metadataStatus"),title=sessionStorage.getItem("selectedTitle")||document.getElementById("youtubeTitle")?.value||"",narration=sessionStorage.getItem("aiNarration")||"";
  if(!title){status.textContent="Choose/generate a topic first.";return}btn.disabled=true;btn.textContent="Generating…";status.textContent="Gemini is drafting YouTube metadata…";
  try{var r=await fetch(API_BASE+"/api/ai/metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:title,narration:narration})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Metadata failed");
    document.getElementById("metadataLongTitle").value=d.longTitle||"";document.getElementById("metadataDescription").value=d.description||"";document.getElementById("metadataHashtags").value=(d.hashtags||[]).map(x=>"#"+x).join(" ");
    for(var i=1;i<=3;i++)document.getElementById("metadataShort"+i).value=d.shortsTitles?.[i-1]||"";status.textContent="AI metadata draft ready ✓ Review/edit before using.";btn.textContent="↻ Regenerate Metadata";
  }catch(e){status.textContent="Metadata failed: "+e.message;btn.textContent="Try Again"}finally{btn.disabled=false}
}
function useMetadataDraft(){
  var btn=document.getElementById("useMetadata"),status=document.getElementById("metadataStatus");
  var title=(document.getElementById("metadataLongTitle")?.value||"").trim(),desc=(document.getElementById("metadataDescription")?.value||"").trim(),tags=(document.getElementById("metadataHashtags")?.value||"").trim();
  if(!title){if(status)status.textContent="Generate or enter a Long title first.";return false}
  var fullDesc=(desc+(tags?"\n\n"+tags:"")).trim(),shorts=[1,2,3].map(function(i){return (document.getElementById("metadataShort"+i)?.value||"").trim()});
  var ytTitle=document.getElementById("youtubeTitle"),ytDesc=document.getElementById("youtubeDescription");if(ytTitle)ytTitle.value=title;if(ytDesc)ytDesc.value=fullDesc;
  var metadataDraft={longTitle:title,description:fullDesc,hashtags:tags,shortsTitles:shorts};sessionStorage.setItem("youtubeShortTitles",JSON.stringify(shorts));sessionStorage.setItem("youtubeMetadataReady","1");sessionStorage.setItem("youtubeMetadataDraft",JSON.stringify(metadataDraft));saveProjectCheckpoint({metadata:metadataDraft});
  if(status)status.textContent="Metadata applied ✓ Long + 3 Shorts are ready for the next upload.";
  if(btn){btn.textContent="✓ Metadata Applied";btn.classList.add("active")}
  return false;
}
var metadataButton=document.getElementById("generateMetadata");if(metadataButton)metadataButton.onclick=function(e){e.preventDefault();generateMetadata()};
var useMetadataButton=document.getElementById("useMetadata");if(useMetadataButton)useMetadataButton.onclick=function(e){e.preventDefault();useMetadataDraft()};

async function generateThumbnail(){
  var btn=document.getElementById("generateThumbnail"),status=document.getElementById("thumbnailStatus"),img=document.getElementById("thumbnailPreview"),id=localStorage.getItem("activeProjectId"),title=sessionStorage.getItem("selectedTitle")||document.getElementById("youtubeTitle")?.value||"";
  if(!id||!title){status.textContent="Choose a project/topic first.";return}
  btn.disabled=true;btn.textContent="Generating…";status.textContent="Generating AI thumbnail…";
  try{var r=await fetch(API_BASE+"/api/ai/thumbnail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,title:title})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Thumbnail failed");img.src=API_BASE+d.thumbnailUrl+"?v="+Date.now();img.style.display="block";status.textContent="Thumbnail ready ✓ 1280×720 • "+(d.provider||"saved")+(d.safety?" • "+d.safety:"")+(Number.isFinite(d.frameSecond)?" • frame "+d.frameSecond+"s":"");btn.textContent="↻ Regenerate Thumbnail"}
  catch(e){status.textContent="Thumbnail failed: "+e.message;btn.textContent="Try Thumbnail Again"}finally{btn.disabled=false}
}
var thumbnailButton=document.getElementById("generateThumbnail");if(thumbnailButton)thumbnailButton.onclick=function(e){e.preventDefault();generateThumbnail()};

async function generateShorts(){
  var btn=document.getElementById("generateShorts"),status=document.getElementById("shortsStatus"),id=localStorage.getItem("activeProjectId");
  if(!id){status.textContent="Render the Long MP4 first.";return}
  btn.disabled=true;btn.textContent="Generating Shorts…";status.textContent="Rendering Short 1/3, 2/3, 3/3 on Railway…";
  try{var r=await fetch(API_BASE+"/api/render/shorts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id})});
    var d=await r.json();if(!r.ok)throw new Error(d.message||d.error||"Shorts failed");
    shortRenderUrls=d.shorts.map(function(x){return API_BASE+x});status.textContent="3 Shorts ready ✓";btn.textContent="↻ Regenerate 3 Shorts";
    sessionStorage.setItem("shortsReady","1");$("productionStatus").textContent="Long + 3 Shorts ready for Review ✓";
  }catch(e){status.textContent="Shorts failed: "+e.message;btn.textContent="Try Generate Shorts Again"}finally{btn.disabled=false}
}
var shortsButton=document.getElementById("generateShorts");if(shortsButton)shortsButton.onclick=function(e){e.preventDefault();generateShorts()};
async function renderMp4(){
  var btn=document.getElementById("renderMp4"),status=document.getElementById("renderStatus"),player=document.getElementById("renderedVideo"),voice=document.getElementById("voicePlayer");
  var cards=Array.from(document.querySelectorAll(".plan-scene")),motion=[];try{motion=JSON.parse(sessionStorage.getItem("motionPlan")||"[]")}catch(e){}
  var scenes=cards.map(function(card,i){var img=card.querySelector(".scene-media-preview img");return {image:img?img.src:"",duration:motion[i]?.duration||"5s",motion:motion[i]?.motion||"slow-zoom-in"}});
  if(!scenes.length||scenes.some(function(x){return !x.image})){status.textContent="Generate all scene visuals first.";return}
  if(!voice||!voice.src||!voice.src.startsWith("data:audio")){status.textContent="Generate Voice first.";return}
  btn.disabled=true;btn.textContent="Rendering…";status.textContent="Uploading assets and rendering MP4 on Railway…";
  try{
    var r=await fetch(API_BASE+"/api/render/mp4",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scenes:scenes,audio:voice.src,projectId:localStorage.getItem("activeProjectId")||"",title:sessionStorage.getItem("selectedTitle")||"Faceless Studio Project"})});
    if(!r.ok){var d=await r.json().catch(function(){return {}});throw new Error(d.message||d.error||"Render failed")}
    var projectId=r.headers.get("X-Project-Id"),persistentPath=r.headers.get("X-Video-Url");if(projectId)localStorage.setItem("activeProjectId",projectId);
    var blob=await r.blob();if(longRenderUrl&&longRenderUrl.startsWith("blob:"))URL.revokeObjectURL(longRenderUrl);
    var url=persistentPath?API_BASE+persistentPath:URL.createObjectURL(blob);longRenderUrl=url;player.dataset.url=url;player.src=url;player.load();player.style.display="block";
    status.textContent="MP4 render ready ✓ "+(blob.size/1024/1024).toFixed(1)+" MB";btn.textContent="↻ Render Again";
    var reviewPlayer=document.getElementById("previewVideo"),placeholder=document.getElementById("previewPlaceholder");
    if(reviewPlayer){reviewPlayer.dataset.url=url;reviewPlayer.src=url;reviewPlayer.load()}
    if(placeholder)placeholder.style.display="none";
    sessionStorage.setItem("renderReady","1");sessionStorage.setItem("productionReady","1");
    drawProduction(-1,productionStages.length-1);
    $("productionStatus").textContent="Long MP4 ready ✓ Open Review to inspect and approve.";
    player.play().catch(function(){});
  }catch(e){status.textContent="Render failed: "+e.message;btn.textContent="Try Render Again"}
  finally{btn.disabled=false}
}
var renderButton=document.getElementById("renderMp4");if(renderButton)renderButton.onclick=function(e){e.preventDefault();renderMp4()};
var motionButton=document.getElementById("buildMotionPlan");if(motionButton)motionButton.onclick=function(e){e.preventDefault();buildSceneMotion()};
var generateAllButton=document.getElementById("generateAllVisuals");if(generateAllButton)generateAllButton.onclick=function(ev){ev.preventDefault();generateAllVisuals()};
document.addEventListener("click",function(e){if(e.target&&e.target.classList.contains("generate-scene-media"))prepareSceneMedia(Number(e.target.getAttribute("data-scene")),e.target)});
