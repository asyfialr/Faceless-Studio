const stages=["Researching topic","Writing script","Generating voice","Preparing visuals","Rendering long video","Extracting Shorts","Adding captions","Ready for review"];
const pipeline=document.getElementById("pipeline");
const progressBar=document.getElementById("progressBar");
const progressLabel=document.getElementById("progressLabel");
const createBtn=document.getElementById("createBtn");
const statusText=document.getElementById("statusText");
const projects=document.getElementById("projects");
const longCount=document.getElementById("longCount");
const shortCount=document.getElementById("shortCount");
const queueCount=document.getElementById("queueCount");

function drawStages(active=-1){
  pipeline.innerHTML=stages.map((s,i)=>`<div class="step ${i<=active?"done":""}"><span class="dot"></span><span>${s}</span></div>`).join("");
}
drawStages();

function addProjects(){
  projects.classList.remove("empty");
  projects.innerHTML=`
    <div class="project"><div><strong>Long Video #001</strong><small>8–10 min • Ready for review</small></div><span>16:9</span></div>
    <div class="project"><div><strong>Short #001</strong><small>35 sec • Ready</small></div><span>9:16</span></div>
    <div class="project"><div><strong>Short #002</strong><small>42 sec • Ready</small></div><span>9:16</span></div>
    <div class="project"><div><strong>Short #003</strong><small>29 sec • Ready</small></div><span>9:16</span></div>`;
}

createBtn.addEventListener("click",async()=>{
  createBtn.disabled=true;
  queueCount.textContent="1";
  longCount.textContent="0/1";
  shortCount.textContent="0/3";
  for(let i=0;i<stages.length;i++){
    drawStages(i);
    const pct=Math.round(((i+1)/stages.length)*100);
    progressBar.style.width=pct+"%";
    progressLabel.textContent=pct+"%";
    statusText.textContent=stages[i]+"…";
    if(i===4) longCount.textContent="1/1";
    if(i>=5) shortCount.textContent=Math.min(3,i-4)+"/3";
    await new Promise(r=>setTimeout(r,550));
  }
  shortCount.textContent="3/3";
  queueCount.textContent="0";
  statusText.textContent="Production complete. Ready for review and scheduling.";
  addProjects();
  createBtn.disabled=false;
  createBtn.textContent="Create Another";
});

document.getElementById("autopilot").addEventListener("change",e=>{
  statusText.textContent=e.target.checked
    ?"Autopilot enabled. Future runs can be scheduled automatically."
    :"Autopilot off. Manual approval mode active.";
});