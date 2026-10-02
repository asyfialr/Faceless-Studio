import express from "express";
import cors from "cors";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import {createCanvas,GlobalFonts} from "@napi-rs/canvas";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile,readFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import crypto from "node:crypto";

const __dirname=dirname(fileURLToPath(import.meta.url));
let captionFontPath="";
try{
  captionFontPath=join(__dirname,"..","node_modules","@fontsource","inter","files","inter-latin-700-normal.woff");
  GlobalFonts.registerFromPath(captionFontPath,"CaptionInter");
}catch(e){console.error("Caption font register failed",e.message)}


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
    await writeFile(join(projectDir,"voice.wav"),Buffer.from(audio64,"base64"));
    const meta={id:projectId,title:String(req.body?.title||"Untitled project"),updatedAt:new Date().toISOString(),longVideoUrl:"/media/"+projectId+"/long.mp4",voiceStored:true};
    await writeFile(join(projectDir,"project.json"),JSON.stringify(meta,null,2));
    res.setHeader("X-Project-Id",projectId);res.setHeader("X-Video-Url",meta.longVideoUrl);
    res.setHeader("Content-Type","video/mp4");res.setHeader("Content-Length",video.length);res.send(video);
  }catch(error){res.status(500).json({error:"render_failed",message:error.message})}
  finally{await rm(dir,{recursive:true,force:true}).catch(()=>{})}
});

app.post("/api/render/captions",async(req,res)=>{
  const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,""),narration=String(req.body?.narration||"").trim();
  if(!projectId||!narration)return res.status(400).json({error:"caption_assets_required"});
  const projectDir=join(storageRoot,projectId),words=narration.replace(/\s+/g," ").split(" ").filter(Boolean);
  const xml=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const ff=(args,label)=>new Promise((resolve,reject)=>{const cp=spawn(ffmpegPath,args);let err="";cp.stderr.on("data",d=>err+=d.toString().slice(-2500));cp.on("error",reject);cp.on("close",(code,signal)=>code===0?resolve():reject(new Error(label+" code="+code+" signal="+(signal||"none")+" "+err.slice(-850))))});
  const render=async(input,out,chunks,duration,w,font,y,label)=>{
    const weights=chunks.map(x=>Math.max(1,x.replace(/[^A-Za-z0-9]/g,"").length)),totalWeight=weights.reduce((a,b)=>a+b,0),bounds=[0];weights.forEach(x=>bounds.push(bounds[bounds.length-1]+duration*x/totalWeight));const parts=[];
    const maxTextWidth=Math.round(w*(label==="long"?.82:.78));
    const wrap=(ctx,text,maxWidth)=>{
      const ws=text.split(/\s+/),lines=[];let line="";
      for(const word of ws){const test=line?line+" "+word:word;if(ctx.measureText(test).width<=maxWidth||!line)line=test;else{lines.push(line);line=word}}
      if(line)lines.push(line);return lines;
    };
    for(let i=0;i<chunks.length;i++){
      let fs=font,canvas,ctx,lines;
      do{
        const probe=createCanvas(w,180);ctx=probe.getContext("2d");ctx.font="700 "+fs+"px CaptionInter";lines=wrap(ctx,chunks[i],maxTextWidth);
        if(lines.length<=2&&lines.every(x=>ctx.measureText(x).width<=maxTextWidth)){canvas=probe;break}fs-=2;
      }while(fs>=22);
      if(!canvas)canvas=createCanvas(w,180);
      const lineH=Math.round(fs*1.22),h=Math.max(110,lineH*lines.length+30);canvas=createCanvas(w,h);ctx=canvas.getContext("2d");
      ctx.clearRect(0,0,w,h);ctx.font="700 "+fs+"px CaptionInter";ctx.textAlign="center";ctx.textBaseline="middle";ctx.lineJoin="round";ctx.lineWidth=Math.max(5,Math.round(fs*.16));ctx.strokeStyle="black";ctx.fillStyle="white";
      const top=h/2-(lines.length-1)*lineH/2;lines.slice(0,2).forEach((line,n)=>{const yy=top+n*lineH;ctx.strokeText(line,w/2,yy,maxTextWidth);ctx.fillText(line,w/2,yy,maxTextWidth)});
      const img=join(projectDir,`cap-${label}-${i}.png`),part=join(projectDir,`cap-part-${label}-${i}.mp4`);await writeFile(img,canvas.toBuffer("image/png"));
      const start=bounds[i].toFixed(3),len=Math.max(.25,bounds[i+1]-bounds[i]).toFixed(3);
      await ff(["-y","-ss",start,"-t",len,"-i",input,"-loop","1","-i",img,"-filter_complex",`[0:v][1:v]overlay=(W-w)/2:${y}:shortest=1[v]`,"-map","[v]","-map","0:a?","-c:v","libx264","-preset","ultrafast","-crf","30","-threads","1","-c:a","aac","-b:a","96k","-shortest",part],label+" part "+(i+1));
      await rm(img,{force:true}).catch(()=>{});parts.push(part);
    }
    const list=join(projectDir,`concat-${label}.txt`);await writeFile(list,parts.map(p=>"file '"+p.replace(/'/g,"'\\''")+"'").join("\n"));
    await ff(["-y","-f","concat","-safe","0","-i",list,"-c","copy","-movflags","+faststart",out],label+" concat");
    await rm(list,{force:true}).catch(()=>{});await Promise.all(parts.map(p=>rm(p,{force:true}).catch(()=>{})));
  };
  try{
    const longChunks=[];for(let i=0;i<words.length;i+=6)longChunks.push(words.slice(i,i+6).join(" "));
    let longDuration=Number(req.body?.longDuration)||0;
    const voicePath=join(projectDir,"voice.wav");
    let voiceAvailable=false;try{await readFile(voicePath);voiceAvailable=true}catch{}
    if(!longDuration){
      longDuration=await new Promise((resolve,reject)=>{const cp=spawn(ffmpegPath,["-i",join(projectDir,"long.mp4"),"-f","null","-"]);let err="";cp.stderr.on("data",d=>err+=d.toString());cp.on("close",()=>{const m=err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);m?resolve(Number(m[1])*3600+Number(m[2])*60+Number(m[3])):resolve(67)});cp.on("error",reject)});
    }
    await render(join(projectDir,"long.mp4"),join(projectDir,"long-captioned.mp4"),longChunks,longDuration,1280,34,520,"long");
    const outputs=[];
    for(let i=0;i<3;i++){const sw=words.slice(i*28,(i+1)*28),chunks=[];for(let k=0;k<sw.length;k+=4)chunks.push(sw.slice(k,k+4).join(" "));const use=chunks.length?chunks:[words.slice(0,4).join(" ")];await render(join(projectDir,`short-${i+1}.mp4`),join(projectDir,`short-${i+1}-captioned.mp4`),use,20,720,46,820,"short"+(i+1));outputs.push("/media/"+projectId+"/short-"+(i+1)+"-captioned.mp4")}
    const longUrl="/media/"+projectId+"/long-captioned.mp4",metaPath=join(projectDir,"project.json");let meta=JSON.parse(await readFile(metaPath,"utf8"));meta.longVideoUrl=longUrl;meta.shorts=outputs;meta.captions=true;meta.captionEngine="segmented-overlay";meta.captionTiming=voiceAvailable?"voice-duration-weighted":"video-duration-weighted";meta.updatedAt=new Date().toISOString();await writeFile(metaPath,JSON.stringify(meta,null,2));
    res.json({ok:true,longVideoUrl:longUrl,shorts:outputs,captionEngine:"segmented-overlay",captionTiming:voiceAvailable?"voice-duration-weighted":"video-duration-weighted"});
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
