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

function buildScriptDraft(){
  if(!selectedTitle||selectedTitle==="Untitled AI Video"){ $("scriptOutput").textContent="Choose an idea from the Ideas tab first."; return; }
  $("generateScript").disabled=true;$("generateScript").textContent="Generating…";
  setTimeout(function(){
    var hook="Most people see this as another tech trend. But the real change is happening quietly—and it could reshape how ordinary people work, create, and make decisions.";
    var outline=["Cold open: challenge the viewer's assumption","Explain the shift in simple terms","Show 3 real-world implications","Explore risks and limitations","End with what viewers should watch next"];
    $("scriptOutput").classList.remove("empty");
    $("scriptOutput").innerHTML=
      '<div class="script-block"><h3>Hook</h3><p>'+hook+'</p></div>'+
      '<div class="script-block"><h3>Outline</h3><ol>'+outline.map(function(x){return "<li>"+x+"</li>"}).join("")+'</ol></div>'+
      '<div class="script-block"><h3>Narration Draft</h3><p>'+hook+' In this video, we break down '+selectedTitle+' without the hype. We will look at what is changing, why it matters, where the biggest opportunities may appear, and which claims still deserve skepticism. The goal is to leave the viewer with a clear picture of the trend and the signals worth following next.</p></div>'+
      '<div class="script-block"><h3>Shorts Angles</h3><ol><li>The surprising change in 30 seconds</li><li>The biggest misconception</li><li>What happens next?</li></ol></div>'+
      '<button id="sendProduction" class="primary">Send to Production</button>';
    $("sendProduction").onclick=function(){
  sessionStorage.setItem("selectedTitle",selectedTitle);
  sessionStorage.setItem("scriptReady","1");
  $("productionTitle").textContent=selectedTitle;
  $("productionStatus").textContent="Script approved. Production is ready to start.";
  location.hash="productionStudio";
};
    $("generateScript").disabled=false;$("generateScript").textContent="Regenerate Draft";
  },650);
}
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
