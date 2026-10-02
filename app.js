const stages=["Researching topic","Writing script","Generating voice","Preparing visuals","Rendering long video","Extracting Shorts","Adding captions","Ready for review"];
let ideas=[["Why AI Agents Are Becoming the Next Big Tech Shift","AI","High potential"],["7 Technologies That Could Change Everyday Life by 2030","Future Tech","Evergreen"],["The Hidden AI Tools People Are Using to Save Hours Every Week","Productivity","Strong hook"],["What Happens When AI Can Work Without Constant Human Prompts?","AI","Explainer"]];
const ideaTemplates=[
["The {niche} Shift Most People Haven't Noticed Yet","Trend","Strong hook"],
["7 {niche} Changes That Could Matter in the Next Few Years","Explainer","Evergreen"],
["What Nobody Tells You About the Future of {niche}","Story","Curiosity"],
["How {niche} Is Quietly Changing Everyday Life","Documentary","Broad appeal"],
["The Biggest {niche} Mistakes People May Be Making Right Now","List","High CTR"],
["What Happens Next With {niche}?","Future","Discussion"]
];
let selectedTitle="Untitled AI Video", projectMade=false;
const $=id=>document.getElementById(id), pipeline=$("pipeline"), progressBar=$("progressBar"), progressLabel=$("progressLabel"), statusText=$("statusText"), createBtn=$("createBtn");
function drawStages(active=-1){pipeline.innerHTML=stages.map((s,i)=>`<div class="step ${i<=active?"done":""}"><span class="dot"></span><span>${s}</span></div>`).join("")}
function renderIdeas(){$("ideaList").innerHTML=ideas.map((x,i)=>`<article class="idea"><div class="idea-top"><h3>${x[0]}</h3><span class="tag">${x[2]}</span></div><p>${x[1]} • English US • Long + Shorts</p><button class="secondary use-idea" data-i="${i}">Use Idea</button></article>`).join("");document.querySelectorAll(".use-idea").forEach(b=>b.onclick=()=>{selectedTitle=ideas[+b.dataset.i][0];showPage("scriptStudio");$("scriptTitle").textContent=selectedTitle;$("scriptOutput").innerHTML="Idea selected. Generate a draft to continue.";$("scriptOutput").classList.add("empty")})}
function showPage(id){
  document.querySelectorAll(".page").forEach(function(p){p.classList.toggle("active",p.id===id)});
  document.querySelectorAll(".bottom-nav button").forEach(function(b){b.classList.toggle("active",b.getAttribute("data-page")===id)});
  try{window.scrollTo({top:0,behavior:"smooth"})}catch(e){window.scrollTo(0,0)}
}
window.addEventListener("hashchange",function(){var id=location.hash.slice(1);if(document.getElementById(id))showPage(id)});
document.querySelector(".bottom-nav").addEventListener("click",function(e){
  var button=e.target.closest("button[data-page]");
  if(!button)return;
  e.preventDefault();
  showPage(button.getAttribute("data-page"));
});
function addProjects(){projectMade=true;$("projects").classList.remove("empty");$("projects").innerHTML=`<div class="project"><div><strong>${selectedTitle}</strong><small>Long • 8–10 min • Ready for review</small></div><span>16:9</span></div>`+[1,2,3].map((n)=>`<div class="project"><div><strong>Short #00${n}</strong><small>Derived from long video • Ready</small></div><span>9:16</span></div>`).join("")}
createBtn.onclick=async()=>{createBtn.disabled=true;$("queueCount").textContent="1";$("longCount").textContent="0/1";$("shortCount").textContent="0/3";for(let i=0;i<stages.length;i++){drawStages(i);let pct=Math.round((i+1)/stages.length*100);progressBar.style.width=pct+"%";progressLabel.textContent=pct+"%";statusText.textContent=stages[i]+"…";if(i===4)$("longCount").textContent="1/1";if(i>=5)$("shortCount").textContent=Math.min(3,i-4)+"/3";await new Promise(r=>setTimeout(r,420))}$("shortCount").textContent="3/3";$("queueCount").textContent="0";statusText.textContent="Production complete. Ready for review and scheduling.";addProjects();createBtn.disabled=false;createBtn.textContent="Create Another"};
$("autopilot").onchange=e=>{localStorage.autopilot=e.target.checked?"1":"0";statusText.textContent=e.target.checked?"Autopilot enabled. Future runs can be scheduled automatically.":"Autopilot off. Manual approval mode active."};
$("autopilot").checked=localStorage.autopilot==="1";$("saveSettings").onclick=()=>{["niche","audience","duration","shortsSetting","voice"].forEach(k=>localStorage[k]=$(k).value);$("savedText").textContent="Saved on this device ✓";setTimeout(()=>$("savedText").textContent="",1800)};["niche","audience","duration","shortsSetting","voice"].forEach(k=>{if(localStorage[k])$(k).value=localStorage[k]});
drawStages();renderIdeas();
function generatePrototypeIdeas(){
  var niche=$("ideaNiche").value.trim()||"AI & Technology";
  var audience=$("ideaAudience").value;
  $("ideaStatus").textContent="Generating concepts…";
  $("generateIdeas").disabled=true;
  setTimeout(function(){
    ideas=ideaTemplates.slice().sort(function(){return Math.random()-.5}).slice(0,4).map(function(x){
      return [x[0].replaceAll("{niche}",niche),x[1]+" • "+audience,x[2]];
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
    $("sendProduction").onclick=function(){showPage("dashboard");location.hash="dashboard";statusText.textContent="Script ready: "+selectedTitle;createBtn.textContent="Start Production"};
    $("generateScript").disabled=false;$("generateScript").textContent="Regenerate Draft";
  },650);
}
$("generateScript").onclick=buildScriptDraft;
if(location.hash&&document.getElementById(location.hash.slice(1)))showPage(location.hash.slice(1));
