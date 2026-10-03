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
  try{window.scrollTo(0,0)}catch(e){}
}
function syncHash(){
  var id=location.hash.slice(1)||"dashboard";
  if(document.getElementById(id))showPage(id);
}
window.addEventListener("hashchange",syncHash);
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
syncHash();

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
    var data=await r.json();if(!r.ok)throw new Error(data.details||data.message||data.error);
    var scenes=(data.plan&&data.plan.scenes)||[];
    sessionStorage.setItem("visualPlan",JSON.stringify(scenes));
    out.innerHTML=scenes.map(function(x,i){return '<div class="plan-scene" data-scene="'+i+'"><strong>Scene '+x.scene+' • '+x.duration+'</strong><p>'+x.visualPrompt+'</p>'+(x.onScreenText?'<small>Text: '+x.onScreenText+'</small>':'')+'<div class="script-actions"><button class="secondary generate-scene-media" data-scene="'+i+'">Generate Visual</button></div><div class="scene-media-status muted">Waiting</div><div class="scene-media-preview" hidden></div></div>'}).join("");
    $("mediaSummary").textContent="Media queue: 0/"+scenes.length+" scenes prepared.";
    btn.textContent="↻ Regenerate Visual Plan";$("productionStatus").textContent="Visual plan ready ✓ "+scenes.length+" scenes prepared.";
  }catch(e){out.textContent="Visual planning failed: "+e.message;btn.textContent="Try Visual Plan Again"}
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
    status.textContent="AI visual ready ✓";button.textContent="↻ Regenerate Visual";
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
  var ok=0,failed=0;
  for(var i=0;i<buttons.length;i++){
    progress.textContent="Generating "+(i+1)+"/"+buttons.length+" • "+ok+" ready"+(failed?" • "+failed+" failed":"");
    await prepareSceneMedia(Number(buttons[i].getAttribute("data-scene")),buttons[i]);
    if((buttons[i].closest(".plan-scene").querySelector(".scene-media-status").textContent||"").includes("ready ✓"))ok++;else failed++;
  }
  progress.textContent="Batch complete • "+ok+"/"+buttons.length+" visuals ready"+(failed?" • "+failed+" failed":"")+" ✓";
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
  try{var r=await fetch(API_BASE+"/api/youtube/status",{cache:"no-store"}),d=await r.json();if(d.connected){state.textContent="Connected ✓";msg.textContent="YouTube authorization is stored securely on Railway.";dot.classList.add("online");btn.textContent="Reconnect YouTube";btn.onclick=function(){location.href=API_BASE+"/api/youtube/connect"}}
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

async function generateThumbnail(){
  var btn=document.getElementById("generateThumbnail"),status=document.getElementById("thumbnailStatus"),img=document.getElementById("thumbnailPreview"),id=localStorage.getItem("activeProjectId"),title=sessionStorage.getItem("selectedTitle")||document.getElementById("youtubeTitle")?.value||"";
  if(!id||!title){status.textContent="Choose a project/topic first.";return}
  btn.disabled=true;btn.textContent="Generating…";status.textContent="Generating AI thumbnail…";
  try{var r=await fetch(API_BASE+"/api/ai/thumbnail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,title:title})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Thumbnail failed");img.src=API_BASE+d.thumbnailUrl+"?v="+Date.now();img.style.display="block";status.textContent="Thumbnail ready ✓ 1280×720";btn.textContent="↻ Regenerate Thumbnail"}
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
