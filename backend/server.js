import express from "express";
import cors from "cors";
import ffmpegPath from "ffmpeg-static";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile,readFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import crypto from "node:crypto";

const app=express();
const port=process.env.PORT||3000;
const allowedOrigin=process.env.FRONTEND_ORIGIN||"https://asyfialr.github.io";

app.use(cors({origin:allowedOrigin,exposedHeaders:["X-Project-Id","X-Video-Url"]}));
app.use(express.json({limit:"40mb"}));

app.get("/api/health",(req,res)=>res.json({
  status:"ok",
  service:"Faceless Studio Backend",
  version:"1.6.0"
}));

app.get("/api/capabilities",(req,res)=>res.json({
  youtube:false,
  ai:Boolean(process.env.GEMINI_API_KEY||process.env.OPENAI_API_KEY),
  renderer:false,
  storage:false
}));

app.post("/api/ai/script",async(req,res)=>{
  const geminiKey=process.env.GEMINI_API_KEY;
  const openaiKey=process.env.OPENAI_API_KEY;
  const title=String(req.body?.title||"").trim();
  if(!title)return res.status(400).json({error:"title_required"});
  if(!geminiKey&&!openaiKey)return res.status(503).json({error:"ai_not_configured",message:"No AI provider is configured."});
  const audience=String(req.body?.audience||"US / International");
  const duration=String(req.body?.duration||"8-10 minutes");
  const prompt="Create an original faceless YouTube video script in natural American English. Topic: "+title+"\nAudience: "+audience+"\nTarget duration: "+duration+"\nReturn ONLY valid JSON with keys hook (string), outline (array of 5 strings), narration (string), shortsAngles (array of 3 strings). Avoid unsupported factual claims and avoid copying source text.";
  if(geminiKey){
    try{
      const models=[process.env.GEMINI_MODEL||"gemini-3.5-flash-lite","gemini-3.1-flash-lite"].filter((v,i,a)=>v&&a.indexOf(v)===i);
      let model=models[0];
      let r,data;
      for(const candidate of models){
        model=candidate;
        for(let attempt=1;attempt<=2;attempt++){
          r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(geminiKey),{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})
          });
          data=await r.json();
          if(r.ok)break;
          const msg=String(data?.error?.message||"");
          const temporary=r.status===429||r.status===503||/high demand|temporar|overload|unavailable/i.test(msg);
          if(!temporary)break;
          if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1200));
        }
        if(r.ok)break;
        const msg=String(data?.error?.message||"");
        const temporary=r.status===429||r.status===503||/high demand|temporar|overload|unavailable/i.test(msg);
        if(!temporary)break;
      }
      if(r.ok){
        const raw=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
        return res.json({ok:true,provider:"gemini",model,script:JSON.parse(raw)});
      }
      const detail=data?.error?.message||"Gemini request failed";
      const busy=r.status===429||r.status===503||/high demand|temporar|overload|unavailable/i.test(detail);
      return res.status(busy?503:502).json({error:busy?"gemini_busy":"gemini_error",provider:"gemini",details:busy?"Gemini model "+model+" is busy right now. Automatic retries were attempted. Please try again shortly.":detail});
    }catch(error){
      return res.status(500).json({error:"gemini_generation_failed",provider:"gemini",message:error.message});
    }
  }
  try{
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",headers:{"Authorization":"Bearer "+openaiKey,"Content-Type":"application/json"},
      body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5-mini",input:prompt,text:{format:{type:"json_object"}}})
    });
    const data=await response.json();
    if(!response.ok)return res.status(502).json({error:"ai_provider_error",details:data?.error?.message||"OpenAI request failed"});
    const raw=data.output_text||data.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("")||"";
    return res.json({ok:true,provider:"openai",script:JSON.parse(raw)});
  }catch(error){return res.status(500).json({error:"ai_generation_failed",message:error.message})}
});

app.post("/api/ai/image",async(req,res)=>{
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
  const token=process.env.CLOUDFLARE_AI_TOKEN;
  const prompt=String(req.body?.prompt||"").trim();
  if(!accountId||!token)return res.status(503).json({error:"cloudflare_not_configured",message:"Cloudflare Workers AI is not configured."});
  if(!prompt)return res.status(400).json({error:"prompt_required"});
  try{
    const model="@cf/black-forest-labs/flux-1-schnell";
    const r=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(accountId)+"/ai/run/"+model,{
      method:"POST",
      headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({prompt:prompt.slice(0,2048),steps:4})
    });
    const data=await r.json();
    if(!r.ok||data?.success===false)return res.status(r.status||502).json({error:"cloudflare_image_error",details:data?.errors?.map(e=>e.message).join("; ")||"Cloudflare image generation failed"});
    const image=data?.result?.image;
    if(!image)return res.status(502).json({error:"image_missing",details:"Cloudflare returned no image."});
    return res.json({ok:true,provider:"cloudflare",model,mimeType:"image/jpeg",image});
  }catch(error){return res.status(500).json({error:"image_generation_failed",message:error.message})}
});

app.post("/api/ai/visual-plan",async(req,res)=>{
  const geminiKey=process.env.GEMINI_API_KEY;
  const narration=String(req.body?.narration||"").trim();
  const title=String(req.body?.title||"Untitled video").trim();
  if(!geminiKey)return res.status(503).json({error:"gemini_not_configured"});
  if(!narration)return res.status(400).json({error:"narration_required"});
  try{
    const model=process.env.GEMINI_PLANNER_MODEL||"gemini-3.5-flash-lite";
    const prompt="Create a visual plan for an original faceless YouTube video. Title: "+title+"\nNarration: "+narration.slice(0,12000)+"\nReturn ONLY valid JSON with key scenes. scenes must be an array of 6 to 10 objects with keys: scene (number), duration (short string like 8-12 sec), visualPrompt (specific original B-roll/image/video direction), onScreenText (short string, may be empty). Keep visuals safe, realistic, copyright-conscious, and suitable for a US/international audience.";
    let r,data;
    for(let attempt=1;attempt<=3;attempt++){
      r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(geminiKey),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})
      });
      data=await r.json();
      if(r.ok)break;
      if(!(r.status===429||r.status===503)||attempt===3)break;
      await new Promise(resolve=>setTimeout(resolve,attempt*1500));
    }
    if(!r.ok)return res.status(502).json({error:"visual_plan_failed",details:data?.error?.message||"Gemini visual planning failed"});
    const raw=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    const plan=JSON.parse(raw);
    return res.json({ok:true,provider:"gemini",model,plan});
  }catch(error){return res.status(500).json({error:"visual_plan_failed",message:error.message})}
});

app.post("/api/ai/voice",async(req,res)=>{
  const geminiKey=process.env.GEMINI_API_KEY;
  const text=String(req.body?.text||"").trim();
  if(!geminiKey)return res.status(503).json({error:"gemini_not_configured"});
  if(!text)return res.status(400).json({error:"text_required"});
  try{
    const model=process.env.GEMINI_TTS_MODEL||"gemini-3.8-flash-lite-tts";
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
      method:"POST",
      headers:{"x-goog-api-key":geminiKey,"Content-Type":"application/json"},
      body:JSON.stringify({
        model,
        input:[{type:"user_input",content:[{type:"text",text:text.slice(0,4000),annotations:[{type:"speech_metadata",style:"Natural confident American English YouTube documentary narration. Clear, warm, engaging, medium pace."}]}]}],
        response_format:{type:"audio"},
        generation_config:{speech_config:[{voice:"Kore"}]}
      })
    });
    const data=await r.json();
    if(!r.ok)return res.status(502).json({error:"gemini_tts_error",details:data?.error?.message||"Gemini TTS request failed"});
    const audio=data?.steps?.flatMap(step=>step?.content||[]).filter(item=>item?.type==="audio"&&item?.data).at(-1)?.data;
    if(!audio)return res.status(502).json({error:"audio_missing",details:"Gemini TTS completed but no audio block was found in the response."});
    res.json({ok:true,provider:"gemini",model,mimeType:"audio/wav",audio});
  }catch(error){res.status(500).json({error:"tts_generation_failed",message:error.message})}
});

app.post("/api/render/mp4",async(req,res)=>{
  const scenes=Array.isArray(req.body?.scenes)?req.body.scenes:[];
  const audio=String(req.body?.audio||"");
  if(!scenes.length||!audio)return res.status(400).json({error:"render_assets_required",message:"Scenes and voice audio are required."});
  const dir=await mkdtemp(join(tmpdir(),"faceless-"));
  try{
    const durations=[];
    for(let i=0;i<scenes.length;i++){
      const base64=String(scenes[i].image||"").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/,"");
      if(!base64)throw new Error("Missing image for scene "+(i+1));
      await writeFile(join(dir,`scene-${i}.jpg`),Buffer.from(base64,"base64"));
      const n=parseFloat(String(scenes[i].duration||"5").match(/[\d.]+/)?.[0]||"5");durations.push(Math.max(2,Math.min(30,n)));
    }
    const audio64=audio.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/,"");
    await writeFile(join(dir,"voice.wav"),Buffer.from(audio64,"base64"));
    const list=durations.map((d,i)=>`file 'scene-${i}.jpg'\nduration ${d}`).join("\n")+"\nfile 'scene-"+(scenes.length-1)+".jpg'\n";
    await writeFile(join(dir,"list.txt"),list);
    const out=join(dir,"output.mp4");
    await new Promise((resolve,reject)=>{
      const args=["-y","-f","concat","-safe","0","-i",join(dir,"list.txt"),"-i",join(dir,"voice.wav"),"-vf","scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p","-c:v","libx264","-preset","veryfast","-r","30","-c:a","aac","-b:a","128k","-shortest","-movflags","+faststart",out];
      const cp=spawn(ffmpegPath,args);let err="";cp.stderr.on("data",d=>err+=d.toString().slice(-4000));cp.on("error",reject);cp.on("close",code=>code===0?resolve():reject(new Error("FFmpeg exited "+code+" "+err.slice(-1200))));
    });
    const video=await readFile(out);
    const projectId=String(req.body?.projectId||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,"");
    const projectDir=join(storageRoot,projectId);await mkdir(projectDir,{recursive:true});
    await writeFile(join(projectDir,"long.mp4"),video);
    const meta={id:projectId,title:String(req.body?.title||"Untitled project"),updatedAt:new Date().toISOString(),longVideoUrl:"/media/"+projectId+"/long.mp4"};
    await writeFile(join(projectDir,"project.json"),JSON.stringify(meta,null,2));
    res.setHeader("X-Project-Id",projectId);res.setHeader("X-Video-Url",meta.longVideoUrl);
    res.setHeader("Content-Type","video/mp4");res.setHeader("Content-Length",video.length);res.send(video);
  }catch(error){res.status(500).json({error:"render_failed",message:error.message})}
  finally{await rm(dir,{recursive:true,force:true}).catch(()=>{})}
});

app.post("/api/render/captions",async(req,res)=>{
  const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,"");
  const narration=String(req.body?.narration||"").trim();
  if(!projectId||!narration)return res.status(400).json({error:"caption_assets_required"});
  const projectDir=join(storageRoot,projectId);
  try{
    const words=narration.replace(/\s+/g," ").split(" ").filter(Boolean);
    const chunks=[];for(let i=0;i<words.length;i+=4)chunks.push(words.slice(i,i+4).join(" "));
    const escapeSrt=t=>t.replace(/-->/g,"→").replace(/[<>]/g,"");
    const stamp=n=>{const ms=Math.max(0,Math.round(n*1000)),hh=String(Math.floor(ms/3600000)).padStart(2,"0"),mm=String(Math.floor(ms%3600000/60000)).padStart(2,"0"),ss=String(Math.floor(ms%60000/1000)).padStart(2,"0"),mmm=String(ms%1000).padStart(3,"0");return hh+":"+mm+":"+ss+","+mmm};
    const outputs=[];
    for(let i=0;i<3;i++){
      const input=join(projectDir,`short-${i+1}.mp4`),out=join(projectDir,`short-${i+1}-captioned.mp4`);
      const duration=20,segmentWords=words.slice(i*28,(i+1)*28),localChunks=[];for(let k=0;k<segmentWords.length;k+=4)localChunks.push(segmentWords.slice(k,k+4).join(" "));
      const useChunks=localChunks.length?localChunks:chunks.slice(0,7),step=duration/Math.max(1,useChunks.length);
      const srt=useChunks.map((x,k)=>(k+1)+"\n"+stamp(k*step)+" --> "+stamp(Math.min(duration,(k+1)*step))+"\n"+escapeSrt(x)+"\n").join("\n");
      const srtPath=join(projectDir,`short-${i+1}.srt`);await writeFile(srtPath,srt);
      const vf="subtitles="+srtPath.replace(/\\/g,"/").replace(/:/g,"\\:")+":force_style='FontSize=22,Bold=1,Alignment=2,MarginV=180,Outline=3,Shadow=1'";
      await new Promise((resolve,reject)=>{const cp=spawn(ffmpegPath,["-y","-i",input,"-vf",vf,"-c:v","libx264","-preset","ultrafast","-threads","1","-c:a","copy","-movflags","+faststart",out]);let err="";cp.stderr.on("data",d=>err+=d.toString().slice(-2500));cp.on("error",reject);cp.on("close",(code,signal)=>code===0?resolve():reject(new Error("Caption "+(i+1)+" code="+code+" signal="+(signal||"none")+" "+err.slice(-800))))});
      outputs.push("/media/"+projectId+"/short-"+(i+1)+"-captioned.mp4");
    }
    const metaPath=join(projectDir,"project.json");let meta=JSON.parse(await readFile(metaPath,"utf8"));meta.shorts=outputs;meta.captions=true;meta.updatedAt=new Date().toISOString();await writeFile(metaPath,JSON.stringify(meta,null,2));
    res.json({ok:true,shorts:outputs});
  }catch(error){res.status(500).json({error:"caption_render_failed",message:error.message})}
});

app.post("/api/render/shorts",async(req,res)=>{
  const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,"");
  if(!projectId)return res.status(400).json({error:"project_id_required"});
  const projectDir=join(storageRoot,projectId),input=join(projectDir,"long.mp4");
  try{
    await readFile(input);
    const outputs=[];
    for(let i=0;i<3;i++){
      const out=join(projectDir,`short-${i+1}.mp4`),start=i*20;
      await new Promise((resolve,reject)=>{
        const args=["-y","-ss",String(start),"-i",input,"-t","20","-vf","scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p","-c:v","libx264","-preset","ultrafast","-threads","1","-r","30","-c:a","aac","-b:a","96k","-movflags","+faststart",out];
        const cp=spawn(ffmpegPath,args);let err="";cp.stderr.on("data",d=>err+=d.toString().slice(-2500));cp.on("error",reject);cp.on("close",(code,signal)=>code===0?resolve():reject(new Error("Short "+(i+1)+" FFmpeg code="+code+" signal="+(signal||"none")+" "+err.slice(-700))));
      });
      outputs.push("/media/"+projectId+"/short-"+(i+1)+".mp4");
    }
    const metaPath=join(projectDir,"project.json");let meta={id:projectId};try{meta=JSON.parse(await readFile(metaPath,"utf8"))}catch(e){}
    meta.shorts=outputs;meta.updatedAt=new Date().toISOString();await writeFile(metaPath,JSON.stringify(meta,null,2));
    res.json({ok:true,shorts:outputs});
  }catch(error){res.status(500).json({error:"shorts_render_failed",message:error.message})}
});

const storageRoot=process.env.STORAGE_DIR||"/data";
app.use("/media",express.static(storageRoot,{maxAge:"1h"}));
app.get("/api/projects/:id",async(req,res)=>{
  const id=String(req.params.id||"").replace(/[^a-zA-Z0-9_-]/g,"");
  try{const raw=await readFile(join(storageRoot,id,"project.json"),"utf8");res.json(JSON.parse(raw))}
  catch(e){res.status(404).json({error:"project_not_found"})}
});

app.listen(port,()=>console.log(`Faceless Studio backend listening on ${port}`));
