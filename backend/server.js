import express from "express";
import cors from "cors";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import {createCanvas,GlobalFonts} from "@napi-rs/canvas";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile,readFile,rm,mkdir,stat,readdir} from "node:fs/promises";
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
const storageRoot=process.env.STORAGE_DIR||"/data";

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
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_TOKEN,geminiKey=process.env.GEMINI_API_KEY;
  const prompt=String(req.body?.prompt||"").trim();if(!prompt)return res.status(400).json({error:"prompt_required"});
  let cloudflareError="not configured";
  if(accountId&&token)try{
    const model="@cf/black-forest-labs/flux-1-schnell",r=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(accountId)+"/ai/run/"+model,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({prompt:prompt.slice(0,2048),steps:4})}),data=await r.json();
    const image=data?.result?.image;if(r.ok&&data?.success!==false&&image)return res.json({ok:true,provider:"cloudflare",model,mimeType:"image/jpeg",image});
    cloudflareError=(data?.errors?.map(e=>e.message).join("; ")||data?.error?.message||("HTTP "+r.status)).slice(0,500);
  }catch(e){cloudflareError=e.message}
  if(geminiKey)try{
    const model=process.env.GEMINI_IMAGE_MODEL||"gemini-3.1-flash-image";
    const r=await fetch("https://generativelanguage.googleapis.com/v1/models/"+model+":generateContent",{method:"POST",headers:{"x-goog-api-key":geminiKey,"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"Generate one original cinematic 16:9 image for a faceless YouTube video. No logos, watermarks, copyrighted characters, or text. "+prompt.slice(0,1800)}]}],generationConfig:{responseModalities:["IMAGE"]}})});
    const data=await r.json(),parts=data?.candidates?.[0]?.content?.parts||[],part=parts.find(p=>p.inlineData?.data||p.inline_data?.data),inline=part?.inlineData||part?.inline_data;
    if(r.ok&&inline?.data)return res.json({ok:true,provider:"gemini",model,mimeType:inline.mimeType||inline.mime_type||"image/png",image:inline.data,fallbackFrom:"cloudflare"});
    const geminiError=(data?.error?.message||("HTTP "+r.status)).slice(0,500);const safe=(prompt.split(/[.!?]/)[0]||"FACeless Studio").replace(/[<>&'"]/g," ").slice(0,72),svg='<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101827"/><stop offset=".5" stop-color="#172554"/><stop offset="1" stop-color="#111827"/></linearGradient><radialGradient id="r"><stop offset="0" stop-color="#60a5fa" stop-opacity=".35"/><stop offset="1" stop-color="#60a5fa" stop-opacity="0"/></radialGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="980" cy="170" r="330" fill="url(#r)"/><circle cx="220" cy="650" r="420" fill="url(#r)" opacity=".45"/><path d="M0 560 Q320 430 640 560 T1280 540 V720 H0Z" fill="#030712" opacity=".55"/><text x="80" y="110" fill="#93c5fd" font-size="24" font-family="sans-serif" letter-spacing="5">FACELESS STUDIO</text><text x="80" y="570" fill="#f8fafc" font-size="42" font-weight="700" font-family="sans-serif">'+safe+'</text><text x="80" y="625" fill="#94a3b8" font-size="22" font-family="sans-serif">Fallback visual • production continues automatically</text></svg>';const buf=await sharp(Buffer.from(svg)).jpeg({quality:88}).toBuffer();return res.json({ok:true,provider:"local-fallback",model:"sharp-procedural",mimeType:"image/jpeg",image:buf.toString("base64"),fallbackFrom:"cloudflare+gemini",providerErrors:{cloudflare:cloudflareError,gemini:geminiError}});
  }catch(e){const safe=(prompt.split(/[.!?]/)[0]||"Faceless Studio").replace(/[<>&\'"]/g," ").slice(0,72),svg=`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="720" fill="#111827"/><circle cx="1000" cy="180" r="360" fill="#1d4ed8" opacity=".25"/><circle cx="180" cy="650" r="420" fill="#2563eb" opacity=".18"/><text x="80" y="110" fill="#93c5fd" font-size="24" font-family="sans-serif" letter-spacing="5">FACELESS STUDIO</text><text x="80" y="570" fill="#f8fafc" font-size="42" font-weight="700" font-family="sans-serif">${safe}</text><text x="80" y="625" fill="#94a3b8" font-size="22" font-family="sans-serif">Fallback visual • production continues automatically</text></svg>`;const buf=await sharp(Buffer.from(svg)).jpeg({quality:88}).toBuffer();return res.json({ok:true,provider:"local-fallback",model:"sharp-procedural",mimeType:"image/jpeg",image:buf.toString("base64"),fallbackFrom:"cloudflare+gemini",providerErrors:{cloudflare:cloudflareError,gemini:e.message}})}
  return res.status(503).json({error:"image_providers_failed",details:"Cloudflare: "+cloudflareError+" | Gemini: not configured"});
});

app.post("/api/ai/visual-plan",async(req,res)=>{
  const geminiKey=process.env.GEMINI_API_KEY;
  const narration=String(req.body?.narration||"").trim();
  const title=String(req.body?.title||"Untitled video").trim();
  if(!geminiKey)return res.status(503).json({error:"gemini_not_configured"});
  if(!narration)return res.status(400).json({error:"narration_required"});
  try{
    const models=[process.env.GEMINI_PLANNER_MODEL||"gemini-3.5-flash-lite","gemini-3.1-flash-lite"].filter((v,i,a)=>v&&a.indexOf(v)===i);let model=models[0];
    const prompt="Create a visual plan for an original faceless YouTube video. Title: "+title+"\nNarration: "+narration.slice(0,12000)+"\nReturn ONLY valid JSON with key scenes. scenes must be an array of 6 to 10 objects with keys: scene (number), duration (short string like 8-12 sec), visualPrompt (specific original B-roll/image/video direction), onScreenText (short string, may be empty). Keep visuals safe, realistic, copyright-conscious, and suitable for a US/international audience.";
    let r,data;
    for(const candidate of models){model=candidate;for(let attempt=1;attempt<=3;attempt++){
      r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(geminiKey),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})
      });
      data=await r.json();if(r.ok)break;if(!(r.status===429||r.status===503)||attempt===3)break;await new Promise(resolve=>setTimeout(resolve,attempt*1500));
    }if(r?.ok)break}
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
    const meta={id:projectId,title:String(req.body?.title||"Untitled project"),updatedAt:new Date().toISOString(),longVideoUrl:"/media/"+projectId+"/long.mp4",voiceUrl:"/media/"+projectId+"/voice.wav",voiceStored:true};
    await writeFile(join(projectDir,"project.json"),JSON.stringify(meta,null,2));
    res.setHeader("X-Project-Id",projectId);res.setHeader("X-Video-Url",meta.longVideoUrl);
    res.setHeader("Content-Type","video/mp4");res.setHeader("Content-Length",video.length);res.send(video);
  }catch(error){res.status(500).json({error:"render_failed",message:error.message})}
  finally{await rm(dir,{recursive:true,force:true}).catch(()=>{})}
});


const geminiWordTimestamps=async(audioPath,projectDir)=>{
  const cache=join(projectDir,"word-timestamps.json");
  try{const saved=JSON.parse(await readFile(cache,"utf8"));if(Array.isArray(saved)&&saved.length)return saved}catch{}
  const key=process.env.GEMINI_API_KEY;if(!key)return [];
  try{
    const audio=await readFile(audioPath);
    const start=await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key="+encodeURIComponent(key),{method:"POST",headers:{"X-Goog-Upload-Protocol":"resumable","X-Goog-Upload-Command":"start","X-Goog-Upload-Header-Content-Length":String(audio.length),"X-Goog-Upload-Header-Content-Type":"audio/wav","Content-Type":"application/json"},body:JSON.stringify({file:{display_name:"faceless-voice.wav"}})});
    if(!start.ok)throw new Error("Gemini upload start "+start.status+" "+(await start.text()).slice(0,300));
    const uploadUrl=start.headers.get("x-goog-upload-url");if(!uploadUrl)throw new Error("Gemini upload URL missing");
    const uploaded=await fetch(uploadUrl,{method:"POST",headers:{"X-Goog-Upload-Command":"upload, finalize","X-Goog-Upload-Offset":"0","Content-Length":String(audio.length),"Content-Type":"audio/wav"},body:audio});
    const fileData=await uploaded.json();if(!uploaded.ok)throw new Error("Gemini upload "+uploaded.status+" "+JSON.stringify(fileData).slice(0,300));
    const uri=fileData?.file?.uri,mime=fileData?.file?.mimeType||"audio/wav";if(!uri)throw new Error("Gemini file URI missing");
    const tr=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{method:"POST",headers:{"x-goog-api-key":key,"Content-Type":"application/json"},body:JSON.stringify({model:"gemini-3.5-transcribe",input:[{type:"audio",uri,mime_type:mime}],generation_config:{transcription_config:{mode:{type:"verbatim",timestamp_granularities:["word"]}}}})});
    const data=await tr.json();if(!tr.ok)throw new Error("Gemini transcribe "+tr.status+" "+(data?.error?.message||JSON.stringify(data).slice(0,300)));
    const out=[];for(const step of data?.steps||[])for(const content of step?.content||[])for(const an of content?.annotations||[])if(an?.type==="word_info"){const sec=v=>{if(typeof v==="number")return v;const m=String(v||"").match(/([\d.]+)s?/);return m?Number(m[1]):NaN},st=sec(an.start_offset),en=sec(an.end_offset);if(Number.isFinite(st)&&Number.isFinite(en))out.push({word:String(an.word||an.text||"").trim(),start:st,end:en})}
    if(out.length)await writeFile(cache,JSON.stringify(out,null,2));return out;
  }catch(e){console.error("Gemini word timestamps fallback:",e.message);return []}
};

app.post("/api/captions/analyze",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,"");
    if(!projectId)return res.status(400).json({error:"projectId required"});
    const projectDir=join(storageRoot,projectId),voicePath=join(projectDir,"voice.wav");
    try{await readFile(voicePath)}catch{return res.status(404).json({error:"voice.wav not found. Render Long first."})}
    const words=await geminiWordTimestamps(voicePath,projectDir);
    if(!words.length)return res.status(502).json({error:"Precision transcription unavailable. Stable captions are unchanged."});
    const valid=words.filter(x=>x.word&&Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start).sort((a,b)=>a.start-b.start);
    if(valid.length<3)return res.status(502).json({error:"Timestamp result was not valid enough to use."});
    const audioDuration=await new Promise(resolve=>{const cp=spawn(ffmpegPath,["-i",voicePath,"-f","null","-"]);let err="";cp.stderr.on("data",d=>err+=d.toString());cp.on("error",()=>resolve(valid[valid.length-1].end));cp.on("close",()=>{const m=err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);resolve(m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):valid[valid.length-1].end)})});
    let overlaps=0,largeGaps=0;for(let i=1;i<valid.length;i++){if(valid[i].start<valid[i-1].start)overlaps++;if(valid[i].start-valid[i-1].end>3)largeGaps++}
    const first=valid[0].start,last=valid[valid.length-1].end,coverage=audioDuration>0?Math.max(0,Math.min(1,(last-first)/audioDuration)):0;
    const quality=valid.length>=10&&overlaps===0&&coverage>=0.65&&last<=audioDuration+5;
    const report={status:quality?"ok":"needs-review",projectId,wordCount:valid.length,start:first,end:last,audioDuration,coverage:Number(coverage.toFixed(3)),overlaps,largeGaps,timing:"word-level",validated:quality};
    await writeFile(join(projectDir,"word-timestamps.json"),JSON.stringify(valid,null,2));
    await writeFile(join(projectDir,"word-timestamps-report.json"),JSON.stringify(report,null,2));
    res.status(quality?200:422).json(report);
  }catch(e){console.error("Caption timing analyze failed",e);res.status(500).json({error:e.message||"Caption timing analysis failed"})}
});

app.post("/api/render/captions",async(req,res)=>{
  const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,""),narration=String(req.body?.narration||"").trim();
  if(!projectId||!narration)return res.status(400).json({error:"caption_assets_required"});
  const projectDir=join(storageRoot,projectId),words=narration.replace(/\s+/g," ").split(" ").filter(Boolean);
  const xml=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const ff=(args,label)=>new Promise((resolve,reject)=>{const cp=spawn(ffmpegPath,args);let err="";cp.stderr.on("data",d=>err+=d.toString().slice(-2500));cp.on("error",reject);cp.on("close",(code,signal)=>code===0?resolve():reject(new Error(label+" code="+code+" signal="+(signal||"none")+" "+err.slice(-850))))});
  const getSpeechWindows=async(audioPath,duration,count)=>{
    if(!count)return [];
    const raw=join(projectDir,"caption-audio.raw");
    try{
      await ff(["-y","-i",audioPath,"-ac","1","-ar","8000","-f","s16le",raw],"caption audio analysis");
      const buf=await readFile(raw),samples=new Int16Array(buf.buffer,buf.byteOffset,Math.floor(buf.length/2)),rate=8000,frame=400;
      const energy=[];for(let i=0;i<samples.length;i+=frame){let sum=0,n=Math.min(frame,samples.length-i);for(let k=0;k<n;k++){const v=samples[i+k];sum+=v*v}energy.push(Math.sqrt(sum/Math.max(1,n)))}
      const sorted=[...energy].sort((a,b)=>a-b),noise=sorted[Math.floor(sorted.length*.3)]||0,peak=sorted[Math.floor(sorted.length*.9)]||1,threshold=Math.max(noise*2.2,peak*.12,120);
      const active=energy.map(e=>e>threshold);for(let i=1;i<active.length-1;i++)if(!active[i]&&active[i-1]&&active[i+1])active[i]=true;
      const speech=[];let st=-1;for(let i=0;i<=active.length;i++){if(i<active.length&&active[i]&&st<0)st=i;if((i===active.length||!active[i])&&st>=0){if(i-st>=2)speech.push([st*frame/rate,Math.min(duration,i*frame/rate)]);st=-1}}
      if(!speech.length)return [];
      const totalSpeech=speech.reduce((a,x)=>a+x[1]-x[0],0),targets=[];for(let i=0;i<=count;i++)targets.push(totalSpeech*i/count);
      const timeAt=target=>{let acc=0;for(const [a,b] of speech){const d=b-a;if(acc+d>=target)return a+(target-acc);acc+=d}return speech[speech.length-1][1]};
      const bounds=targets.map(timeAt);bounds[0]=Math.max(0,speech[0][0]-.08);bounds[bounds.length-1]=Math.min(duration,speech[speech.length-1][1]+.12);return bounds;
    }catch(e){console.error("Speech alignment fallback:",e.message);return []}finally{await rm(raw,{force:true}).catch(()=>{})}
  };
  const render=async(input,out,chunks,duration,w,font,y,label,speechBounds)=>{
    const weights=chunks.map(x=>Math.max(1,x.replace(/[^A-Za-z0-9]/g,"").length)),totalWeight=weights.reduce((a,b)=>a+b,0),fallback=[0];weights.forEach(x=>fallback.push(fallback[fallback.length-1]+duration*x/totalWeight));const bounds=Array.isArray(speechBounds)&&speechBounds.length===chunks.length+1?speechBounds:fallback;
    const maxTextWidth=Math.round(w*(label==="long"?.82:.78)),rowH=label==="long"?118:142,parts=[];
    const wrap=(ctx,text,maxWidth)=>{const ws=text.split(/\s+/),lines=[];let line="";for(const word of ws){const t=line?line+" "+word:word;if(ctx.measureText(t).width<=maxWidth||!line)line=t;else{lines.push(line);line=word}}if(line)lines.push(line);return lines};
    for(let i=0;i<chunks.length;i++){
      let fs=font,canvas=createCanvas(w,rowH),ctx=canvas.getContext("2d"),lines;do{ctx.font="700 "+fs+"px CaptionInter";lines=wrap(ctx,chunks[i],maxTextWidth);if(lines.length<=2&&lines.every(x=>ctx.measureText(x).width<=maxTextWidth))break;fs-=2}while(fs>22);
      ctx.clearRect(0,0,w,rowH);ctx.font="700 "+fs+"px CaptionInter";ctx.textAlign="center";ctx.textBaseline="middle";ctx.lineJoin="round";ctx.lineWidth=Math.max(5,Math.round(fs*.16));ctx.strokeStyle="black";ctx.fillStyle="white";const lh=Math.round(fs*1.18),top=rowH/2-(Math.min(2,lines.length)-1)*lh/2;lines.slice(0,2).forEach((line,n)=>{const yy=top+n*lh;ctx.strokeText(line,w/2,yy,maxTextWidth);ctx.fillText(line,w/2,yy,maxTextWidth)});
      const img=join(projectDir,`cap-${label}-${i}.png`),part=join(projectDir,`cap-part-${label}-${i}.mp4`);await writeFile(img,canvas.toBuffer("image/png"));
      const st=Math.max(0,bounds[i]),len=Math.max(.18,bounds[i+1]-bounds[i]);
      await ff(["-y","-ss",st.toFixed(3),"-t",len.toFixed(3),"-i",input,"-loop","1","-i",img,"-filter_complex",`[0:v][1:v]overlay=(W-w)/2:${y}:shortest=1[v]`,"-map","[v]","-map","0:a?","-c:v","libx264","-preset","ultrafast","-crf","31","-threads","1","-c:a","aac","-b:a","96k","-shortest",part],label+" segment "+(i+1));
      await rm(img,{force:true}).catch(()=>{});parts.push(part);
    }
    const list=join(projectDir,`concat-${label}.txt`);await writeFile(list,parts.map(p=>"file '"+p.replace(/'/g,"'\\''")+"'").join("\n"));
    await ff(["-y","-fflags","+genpts","-f","concat","-safe","0","-i",list,"-c:v","libx264","-preset","ultrafast","-crf","31","-threads","1","-c:a","aac","-b:a","96k","-af","aresample=async=1:first_pts=0","-movflags","+faststart",out],label+" concat");
    await rm(list,{force:true}).catch(()=>{});await Promise.all(parts.map(p=>rm(p,{force:true}).catch(()=>{})));
  };
  try{
    let longChunks=[];for(let i=0;i<words.length;i+=9)longChunks.push(words.slice(i,i+9).join(" "));
    let longDuration=Number(req.body?.longDuration)||0;
    const voicePath=join(projectDir,"voice.wav");
    let voiceAvailable=false;try{await readFile(voicePath);voiceAvailable=true}catch{}
    let timedWords=[];
    try{
      const report=JSON.parse(await readFile(join(projectDir,"word-timestamps-report.json"),"utf8"));
      const cached=JSON.parse(await readFile(join(projectDir,"word-timestamps.json"),"utf8"));
      if(report?.validated===true&&Array.isArray(cached)&&cached.length>=10)timedWords=cached.filter(x=>x.word&&Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start);
    }catch{}
    if(!longDuration){
      longDuration=await new Promise((resolve,reject)=>{const cp=spawn(ffmpegPath,["-i",join(projectDir,"long.mp4"),"-f","null","-"]);let err="";cp.stderr.on("data",d=>err+=d.toString());cp.on("close",()=>{const m=err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);m?resolve(Number(m[1])*3600+Number(m[2])*60+Number(m[3])):resolve(67)});cp.on("error",reject)});
    }
    let longSpeechBounds=[];
    if(timedWords.length>=3){
      longChunks=[];longSpeechBounds=[];
      const usableTimedWords=timedWords.filter(x=>x.start<longDuration+.25);for(let i=0;i<usableTimedWords.length;i+=12){const group=usableTimedWords.slice(i,i+12),next=usableTimedWords[i+12];if(!group.length)continue;longChunks.push(group.map(x=>x.word).join(" "));if(!longSpeechBounds.length)longSpeechBounds.push(Math.max(0,group[0].start));longSpeechBounds.push(Math.min(longDuration,next?next.start:group[group.length-1].end))}
    }
    await render(join(projectDir,"long.mp4"),join(projectDir,"long-captioned.mp4"),longChunks,longDuration,1280,34,520,"long",longSpeechBounds);
    const outputs=[];
    for(let i=0;i<3;i++){
      const clipStart=i*20,clipEnd=clipStart+20;let use=[],shortBounds=[];
      if(timedWords.length>=3){
        const sw=timedWords.filter(x=>x.start<clipEnd&&x.end>clipStart);
        for(let k=0;k<sw.length;k+=5){const group=sw.slice(k,k+5),next=sw[k+5];if(!group.length)continue;use.push(group.map(x=>x.word).join(" "));if(!shortBounds.length)shortBounds.push(Math.max(0,group[0].start-clipStart));shortBounds.push(Math.min(20,Math.max(0,(next?next.start:group[group.length-1].end)-clipStart)))}
      }
      if(!use.length){const sw=words.slice(i*28,(i+1)*28);for(let k=0;k<sw.length;k+=4)use.push(sw.slice(k,k+4).join(" "));if(!use.length)use=[words.slice(0,4).join(" ")];shortBounds=[]}
      await render(join(projectDir,`short-${i+1}.mp4`),join(projectDir,`short-${i+1}-captioned.mp4`),use,20,720,46,820,"short"+(i+1),shortBounds);outputs.push("/media/"+projectId+"/short-"+(i+1)+"-captioned.mp4")
    }
    const longUrl="/media/"+projectId+"/long-captioned.mp4",metaPath=join(projectDir,"project.json");let meta=JSON.parse(await readFile(metaPath,"utf8"));meta.longVideoUrl=longUrl;meta.shorts=outputs;meta.captions=true;meta.captionEngine="segmented-overlay";meta.captionTiming=timedWords.length?"validated-word-timestamps":(voiceAvailable?"voice-duration-weighted":"video-duration-weighted");meta.updatedAt=new Date().toISOString();await writeFile(metaPath,JSON.stringify(meta,null,2));
    res.json({ok:true,longVideoUrl:longUrl,shorts:outputs,captionEngine:"segmented-overlay",captionTiming:timedWords.length?"validated-word-timestamps":(voiceAvailable?"voice-duration-weighted":"video-duration-weighted")});
  }catch(error){res.status(500).json({error:"caption_render_failed",message:error.message})}
});

const youtubeTokenPath=join(storageRoot,"youtube-oauth.json");
const youtubeRedirect=()=>process.env.YOUTUBE_REDIRECT_URI||"https://faceless-studio-production-c487.up.railway.app/api/youtube/callback";
const youtubeConfigured=()=>Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET);
const readYoutubeToken=async()=>{try{return JSON.parse(await readFile(youtubeTokenPath,"utf8"))}catch{return null}};

app.get("/api/youtube/status",async(req,res)=>{
  const saved=await readYoutubeToken();if(!saved)return res.json({configured:youtubeConfigured(),connected:false,editScope:false,scopes:[],scopeVerified:false});
  let scopes=String(saved.scope||"").split(/\s+/).filter(Boolean),token=saved.access_token||"",scopeVerified=false,apiVerified=false,apiError="";
  try{token=await youtubeAccessToken()}catch(e){apiError=e.message}
  try{if(token){const r=await fetch("https://oauth2.googleapis.com/tokeninfo?access_token="+encodeURIComponent(token),{cache:"no-store"}),d=await r.json();if(r.ok&&d.scope){scopes=String(d.scope).split(/\s+/).filter(Boolean);scopeVerified=true}}}catch(e){}
  try{if(token){const r=await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",{headers:{Authorization:"Bearer "+token}}),d=await r.json();apiVerified=r.ok;if(!r.ok)apiError=d?.error?.message||("YouTube API HTTP "+r.status)}}catch(e){apiError=e.message}
  const editScope=scopes.includes("https://www.googleapis.com/auth/youtube.force-ssl")||scopes.includes("https://www.googleapis.com/auth/youtube");
  res.json({configured:youtubeConfigured(),connected:Boolean(saved.refresh_token||saved.access_token),editScope,scopes,scopeVerified,apiVerified,apiError});
});
app.get("/api/youtube/connect",(req,res)=>{
  if(!youtubeConfigured())return res.status(503).send("YouTube OAuth is not configured.");
  const state=crypto.randomUUID(),statePath=join(storageRoot,"youtube-oauth-state.json");
  writeFile(statePath,JSON.stringify({state,createdAt:Date.now()})).then(()=>{
    const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:youtubeRedirect(),response_type:"code",scope:"https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl",access_type:"offline",include_granted_scopes:"false",prompt:"consent",state});
    res.redirect("https://accounts.google.com/o/oauth2/v2/auth?"+q.toString());
  }).catch(e=>res.status(500).send(e.message));
});
app.get("/api/youtube/callback",async(req,res)=>{
  try{
    const code=String(req.query.code||""),state=String(req.query.state||"");if(!code||!state)throw new Error("Missing OAuth code/state");
    const saved=JSON.parse(await readFile(join(storageRoot,"youtube-oauth-state.json"),"utf8"));if(saved.state!==state||Date.now()-saved.createdAt>10*60*1000)throw new Error("Invalid or expired OAuth state");
    const body=new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:youtubeRedirect(),grant_type:"authorization_code"});
    const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});const d=await r.json();if(!r.ok)throw new Error(d.error_description||d.error||"Token exchange failed");
    const previous=await readYoutubeToken();let grantedScopes=String(d.scope||"").split(/\s+/).filter(Boolean);try{const vr=await fetch("https://oauth2.googleapis.com/tokeninfo?access_token="+encodeURIComponent(d.access_token),{cache:"no-store"}),vd=await vr.json();if(vr.ok&&vd.scope)grantedScopes=String(vd.scope).split(/\s+/).filter(Boolean)}catch(e){}const merged={...previous,...d,scope:grantedScopes.join(" "),refresh_token:d.refresh_token||previous?.refresh_token,obtained_at:Date.now()};await writeFile(youtubeTokenPath,JSON.stringify(merged,null,2));await rm(join(storageRoot,"youtube-oauth-state.json"),{force:true}).catch(()=>{});
    res.redirect("https://asyfialr.github.io/Faceless-Studio/#youtube");
  }catch(e){console.error("YouTube OAuth callback failed",e);res.status(500).send("YouTube connection failed: "+e.message)}
});

async function youtubeAccessToken(){
  const saved=await readYoutubeToken();if(!saved)throw new Error("YouTube is not connected");
  if(saved.access_token&&saved.obtained_at&&Date.now()<saved.obtained_at+(Number(saved.expires_in||3600)-120)*1000)return saved.access_token;
  if(!saved.refresh_token)throw new Error("YouTube refresh token is missing. Reconnect YouTube.");
  const body=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:saved.refresh_token,grant_type:"refresh_token"});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});const d=await r.json();
  if(!r.ok)throw new Error(d.error_description||d.error||"YouTube token refresh failed");
  const next={...saved,...d,refresh_token:saved.refresh_token,obtained_at:Date.now()};await writeFile(youtubeTokenPath,JSON.stringify(next,null,2));return next.access_token;
}
app.post("/api/youtube/upload-long",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,""),title=String(req.body?.title||"Faceless Studio Video").trim().slice(0,100),description=String(req.body?.description||"").slice(0,5000);
    if(!projectId)return res.status(400).json({error:"projectId required"});
    const projectDir=join(storageRoot,projectId),captioned=join(projectDir,"long-captioned.mp4"),plain=join(projectDir,"long.mp4");let filePath=captioned;
    try{await stat(filePath)}catch{filePath=plain}const info=await stat(filePath),token=await youtubeAccessToken();
    const metadata={snippet:{title,description,categoryId:"28"},status:{privacyStatus:"private",selfDeclaredMadeForKids:false}};
    const init=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Length":String(info.size),"X-Upload-Content-Type":"video/mp4"},body:JSON.stringify(metadata)});
    if(!init.ok)throw new Error("YouTube upload init "+init.status+" "+(await init.text()).slice(0,500));const uploadUrl=init.headers.get("location");if(!uploadUrl)throw new Error("YouTube did not return an upload URL");
    const data=await readFile(filePath);const put=await fetch(uploadUrl,{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"video/mp4","Content-Length":String(data.length)},body:data});const result=await put.json().catch(()=>({}));
    if(!put.ok)throw new Error("YouTube upload "+put.status+" "+JSON.stringify(result).slice(0,500));
    let thumbnailApplied=false;try{const thumb=await readFile(join(projectDir,"thumbnail.jpg"));const tr=await fetch("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId="+encodeURIComponent(result.id)+"&uploadType=media",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"image/jpeg","Content-Length":String(thumb.length)},body:thumb});thumbnailApplied=tr.ok;if(!tr.ok)console.warn("YouTube thumbnail set failed",tr.status,(await tr.text()).slice(0,300))}catch(e){console.warn("YouTube thumbnail unavailable",e.message)}
    const metaPath=join(projectDir,"project.json");let project={id:projectId};try{project=JSON.parse(await readFile(metaPath,"utf8"))}catch{}project.youtube={...(project.youtube||{}),longVideoId:result.id,privacyStatus:"private",uploadedAt:new Date().toISOString(),thumbnailApplied,thumbnailVideoId:thumbnailApplied?result.id:null};await writeFile(metaPath,JSON.stringify(project,null,2));
    res.json({ok:true,videoId:result.id,url:"https://www.youtube.com/watch?v="+result.id,privacyStatus:"private",thumbnailApplied});
  }catch(e){console.error("YouTube long upload failed",e);res.status(500).json({error:e.message||"YouTube upload failed"})}
});


app.post("/api/youtube/apply-thumbnail",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,"");if(!projectId)return res.status(400).json({error:"projectId required"});
    const projectDir=join(storageRoot,projectId),metaPath=join(projectDir,"project.json"),project=JSON.parse(await readFile(metaPath,"utf8")),videoId=project.youtube?.longVideoId;
    if(!videoId)return res.status(409).json({error:"Long YouTube video is missing"});
    const thumbPath=join(projectDir,"thumbnail.jpg"),info=await stat(thumbPath);if(info.size>2*1024*1024)return res.status(400).json({error:"Thumbnail exceeds YouTube 2 MB limit"});
    const thumb=await readFile(thumbPath),token=await youtubeAccessToken();
    const tr=await fetch("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId="+encodeURIComponent(videoId)+"&uploadType=media",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"image/jpeg","Content-Length":String(thumb.length)},body:thumb});
    const td=await tr.json().catch(()=>({}));if(!tr.ok)throw new Error("YouTube thumbnail "+tr.status+" "+JSON.stringify(td).slice(0,500));
    project.youtube.thumbnailApplied=true;project.youtube.thumbnailAppliedAt=new Date().toISOString();project.youtube.thumbnailVideoId=videoId;await writeFile(metaPath,JSON.stringify(project,null,2));
    res.json({ok:true,videoId,thumbnailApplied:true});
  }catch(e){console.error("YouTube thumbnail apply failed",e);res.status(500).json({error:e.message||"YouTube thumbnail apply failed"})}
});

app.post("/api/youtube/upload-short",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,""),index=Math.max(1,Math.min(3,Number(req.body?.index||1))),baseTitle=String(req.body?.title||"Faceless Studio Short").trim();
    if(!projectId)return res.status(400).json({error:"projectId required"});
    const projectDir=join(storageRoot,projectId),captioned=join(projectDir,"short-"+index+"-captioned.mp4"),plain=join(projectDir,"short-"+index+".mp4");let filePath=captioned;
    try{await stat(filePath)}catch{filePath=plain}const info=await stat(filePath),token=await youtubeAccessToken();
    const title=(baseTitle+" #Shorts").slice(0,100),description=String(req.body?.description||"").slice(0,4900)+"\n\n#Shorts";
    const metadata={snippet:{title,description,categoryId:"28"},status:{privacyStatus:"private",selfDeclaredMadeForKids:false}};
    const init=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Length":String(info.size),"X-Upload-Content-Type":"video/mp4"},body:JSON.stringify(metadata)});
    if(!init.ok)throw new Error("YouTube Short init "+init.status+" "+(await init.text()).slice(0,500));const uploadUrl=init.headers.get("location");if(!uploadUrl)throw new Error("YouTube did not return an upload URL");
    const data=await readFile(filePath);const put=await fetch(uploadUrl,{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"video/mp4","Content-Length":String(data.length)},body:data});const result=await put.json().catch(()=>({}));
    if(!put.ok)throw new Error("YouTube Short upload "+put.status+" "+JSON.stringify(result).slice(0,500));
    const metaPath=join(projectDir,"project.json");let project={id:projectId};try{project=JSON.parse(await readFile(metaPath,"utf8"))}catch{}project.youtube=project.youtube||{};project.youtube.shorts=project.youtube.shorts||[];project.youtube.shorts[index-1]={videoId:result.id,privacyStatus:"private",uploadedAt:new Date().toISOString()};await writeFile(metaPath,JSON.stringify(project,null,2));
    res.json({ok:true,index,videoId:result.id,url:"https://www.youtube.com/watch?v="+result.id,privacyStatus:"private"});
  }catch(e){console.error("YouTube Short upload failed",e);res.status(500).json({error:e.message||"YouTube Short upload failed"})}
});

app.post("/api/youtube/publish-project",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,""),privacy=String(req.body?.privacyStatus||"private");
    if(!projectId)return res.status(400).json({error:"projectId required"});
    if(!["private","unlisted","public"].includes(privacy))return res.status(400).json({error:"Invalid privacy status"});
    const metaPath=join(storageRoot,projectId,"project.json");const project=JSON.parse(await readFile(metaPath,"utf8")),yt=project.youtube||{};
    const ids=[yt.longVideoId,...(yt.shorts||[]).map(x=>x?.videoId)].filter(Boolean);if(!ids.length)return res.status(400).json({error:"No uploaded YouTube videos found"});
    const token=await youtubeAccessToken(),updated=[];
    for(const id of ids){
      const r=await fetch("https://www.googleapis.com/youtube/v3/videos?part=status",{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({id,status:{privacyStatus:privacy,selfDeclaredMadeForKids:false}})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error("YouTube status update "+r.status+" "+JSON.stringify(d).slice(0,500));updated.push(id);
    }
    project.youtube.privacyStatus=privacy;project.youtube.publishedAt=new Date().toISOString();if(project.youtube.shorts)project.youtube.shorts=project.youtube.shorts.map(x=>x?{...x,privacyStatus:privacy}:x);
    await writeFile(metaPath,JSON.stringify(project,null,2));res.json({ok:true,privacyStatus:privacy,updated});
  }catch(e){console.error("YouTube publish project failed",e);res.status(500).json({error:e.message||"YouTube publishing failed"})}
});

function zonedLocalToUtc(date,time,timeZone){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||"")),t=/^(\d{2}):(\d{2})$/.exec(String(time||""));if(!m||!t)throw new Error("Invalid schedule date/time");
  const wanted=Date.UTC(+m[1],+m[2]-1,+m[3],+t[1],+t[2]),fmt=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const wallMs=ms=>{const p=Object.fromEntries(fmt.formatToParts(new Date(ms)).filter(x=>x.type!=="literal").map(x=>[x.type,+x.value]));return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second||0)};
  let utc=wanted;for(let i=0;i<4;i++)utc=wanted-(wallMs(utc)-utc);
  if(Math.abs(wallMs(utc)-wanted)>1000)throw new Error("Selected local time is invalid or ambiguous in "+timeZone);
  return new Date(utc);
}
async function youtubeVideoExists(id,token){
  if(!id)return false;
  try{const r=await fetch("https://www.googleapis.com/youtube/v3/videos?part=id&id="+encodeURIComponent(id),{headers:{Authorization:"Bearer "+token}}),d=await r.json();return Boolean(r.ok&&Array.isArray(d.items)&&d.items.some(x=>x.id===id))}catch(e){return false}
}
app.post("/api/youtube/verify-project",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,"");if(!projectId)return res.status(400).json({error:"projectId required"});
    const metaPath=join(storageRoot,projectId,"project.json"),project=JSON.parse(await readFile(metaPath,"utf8")),token=await youtubeAccessToken(),yt=project.youtube||{};
    if(yt.longVideoId&&!(await youtubeVideoExists(yt.longVideoId,token)))delete yt.longVideoId;
    if(Array.isArray(yt.shorts))for(let i=0;i<yt.shorts.length;i++)if(yt.shorts[i]?.videoId&&!(await youtubeVideoExists(yt.shorts[i].videoId,token)))yt.shorts[i]=null;
    project.youtube=yt;await writeFile(metaPath,JSON.stringify(project,null,2));res.json({ok:true,youtube:yt});
  }catch(e){res.status(500).json({error:e.message||"YouTube verification failed"})}
});

app.post("/api/youtube/reality-check",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,"");if(!projectId)return res.status(400).json({error:"projectId required"});
    const metaPath=join(storageRoot,projectId,"project.json"),project=JSON.parse(await readFile(metaPath,"utf8")),yt=project.youtube||{},token=await youtubeAccessToken();
    const expected=[{type:"long",id:yt.longVideoId},...Array.from({length:3},(_,i)=>({type:"short"+(i+1),id:yt.shorts?.[i]?.videoId}))];
    const ids=expected.map(x=>x.id).filter(Boolean),found=new Map();
    if(ids.length){const r=await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,processingDetails&id="+encodeURIComponent(ids.join(",")),{headers:{Authorization:"Bearer "+token}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error("YouTube reality check "+r.status+" "+JSON.stringify(d).slice(0,500));for(const v of d.items||[])found.set(v.id,v)}
    const videos=expected.map(x=>{const v=found.get(x.id);return {type:x.type,id:x.id||null,exists:!!v,title:v?.snippet?.title||null,duration:v?.contentDetails?.duration||null,hasCustomThumbnail:v?.contentDetails?.hasCustomThumbnail===true,thumbnail:v?.snippet?.thumbnails?.maxres?.url||v?.snippet?.thumbnails?.high?.url||null,privacyStatus:v?.status?.privacyStatus||null,publishAt:v?.status?.publishAt||null,processingStatus:v?.processingDetails?.processingStatus||null}});
    const long=videos[0],shorts=videos.slice(1),missing=videos.filter(v=>!v.exists).map(v=>v.type),unscheduled=videos.filter(v=>v.exists&&!v.publishAt).map(v=>v.type),thumbnailOk=long.exists&&long.hasCustomThumbnail;
    const ready=missing.length===0&&unscheduled.length===0&&thumbnailOk;
    project.youtube.realityCheck={ready,checkedAt:new Date().toISOString(),missing,unscheduled,thumbnailOk};await writeFile(metaPath,JSON.stringify(project,null,2));
    res.json({ok:true,ready,thumbnailOk,missing,unscheduled,videos});
  }catch(e){console.error("YouTube reality check failed",e);res.status(500).json({error:e.message||"YouTube reality check failed"})}
});

app.post("/api/youtube/schedule-project",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,""),longAt=String(req.body?.longPublishAt||""),scheduleDate=String(req.body?.scheduleDate||""),scheduleTime=String(req.body?.scheduleTime||""),timeZone=String(req.body?.timeZone||"America/New_York"),intervalDays=Math.max(1,Math.min(30,Number(req.body?.shortIntervalDays||1)));
    if(!projectId||(!longAt&&(!scheduleDate||!scheduleTime)))return res.status(400).json({error:"projectId and schedule date/time required"});
    let base;if(scheduleDate&&scheduleTime){try{base=zonedLocalToUtc(scheduleDate,scheduleTime,timeZone)}catch(e){return res.status(400).json({error:e.message})}}else base=new Date(longAt);if(!Number.isFinite(base.getTime())||base.getTime()<=Date.now()+60000)return res.status(400).json({error:"Schedule time must be in the future"});
    const metaPath=join(storageRoot,projectId,"project.json"),project=JSON.parse(await readFile(metaPath,"utf8")),yt=project.youtube||{};
    const missingUploads=[];if(!yt.longVideoId)missingUploads.push("long");for(let i=0;i<3;i++)if(!yt.shorts?.[i]?.videoId)missingUploads.push("short"+(i+1));if(missingUploads.length)return res.status(409).json({error:"Auto Publish incomplete. Missing YouTube upload: "+missingUploads.join(", ")+". Upload/retry missing items before scheduling.",missing:missingUploads});
    const entries=[{type:"long",id:yt.longVideoId,at:new Date(base)}];
    yt.shorts.slice(0,3).forEach((x,i)=>{const at=new Date(base);at.setUTCDate(at.getUTCDate()+(i+1)*intervalDays);entries.push({type:"short"+(i+1),id:x.videoId,at})});
    const token=await youtubeAccessToken(),scheduled=[],missing=[];
    for(const item of entries){if(!(await youtubeVideoExists(item.id,token))){missing.push(item.type);continue}
      const publishAt=item.at.toISOString();const r=await fetch("https://www.googleapis.com/youtube/v3/videos?part=status",{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({id:item.id,status:{privacyStatus:"private",publishAt,selfDeclaredMadeForKids:false}})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(item.type+" schedule "+r.status+" "+JSON.stringify(d).slice(0,500));scheduled.push({type:item.type,videoId:item.id,publishAt});
    }
    if(missing.length)return res.status(409).json({error:"Saved YouTube upload is missing: "+missing.join(", ")+". Run Auto Publish to re-upload missing videos.",missing});
    project.youtube.schedule=scheduled;project.youtube.privacyStatus="private";project.youtube.scheduledAt=new Date().toISOString();await writeFile(metaPath,JSON.stringify(project,null,2));
    res.json({ok:true,scheduled,requestedLocal:{date:scheduleDate,time:scheduleTime,timeZone},resolvedUtc:base.toISOString()});
  }catch(e){console.error("YouTube scheduling failed",e);res.status(500).json({error:e.message||"YouTube scheduling failed"})}
});

app.post("/api/ai/metadata",async(req,res)=>{
  try{
    const key=process.env.GEMINI_API_KEY,title=String(req.body?.title||"").trim(),narration=String(req.body?.narration||"").trim();
    if(!key)return res.status(503).json({error:"Gemini is not configured"});if(!title)return res.status(400).json({error:"title required"});
    const prompt="Create YouTube metadata for a faceless video targeting a US/international English audience. Be compelling but accurate, not clickbait or misleading. Topic: "+title+"\nNarration context: "+narration.slice(0,6000)+"\nReturn ONLY valid JSON with: longTitle (max 90 chars), description (2 concise paragraphs plus natural CTA), hashtags (array of 3-5 strings without #), shortsTitles (array of exactly 3 distinct titles, each max 80 chars).";
    const models=[process.env.GEMINI_MODEL||"gemini-3.5-flash-lite","gemini-3.1-flash-lite"].filter((v,i,a)=>v&&a.indexOf(v)===i);let last="";
    for(const model of models){
      const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})});
      const d=await r.json();if(!r.ok){last=JSON.stringify(d).slice(0,500);continue}
      const raw=d?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("")||"";let out;try{out=JSON.parse(raw)}catch{throw new Error("Gemini returned invalid metadata JSON")}
      out.longTitle=String(out.longTitle||title).slice(0,90);out.description=String(out.description||"").slice(0,4500);out.hashtags=Array.isArray(out.hashtags)?out.hashtags.slice(0,5).map(x=>String(x).replace(/^#/,"")):[];out.shortsTitles=Array.isArray(out.shortsTitles)?out.shortsTitles.slice(0,3).map(x=>String(x).slice(0,80)):[];
      while(out.shortsTitles.length<3)out.shortsTitles.push((out.longTitle+" — Short "+(out.shortsTitles.length+1)).slice(0,80));
      return res.json(out);
    }throw new Error("Gemini metadata failed "+last);
  }catch(e){console.error("AI metadata failed",e);res.status(500).json({error:e.message||"AI metadata failed"})}
});

app.post("/api/ai/thumbnail",async(req,res)=>{
  try{
    const projectId=String(req.body?.projectId||"").replace(/[^a-zA-Z0-9_-]/g,""),title=String(req.body?.title||"").trim();
    if(!projectId||!title)return res.status(400).json({error:"projectId and title required"});
    const projectDir=join(storageRoot,projectId);await mkdir(projectDir,{recursive:true});
    const metaPath=join(projectDir,"project.json");let meta={id:projectId};try{meta=JSON.parse(await readFile(metaPath,"utf8"))}catch{}
    
    const out=join(projectDir,"thumbnail.jpg"),stop=new Set(["THE","A","AN","TO","OF","FOR","AND","ARE","IS","USING","EVERY","PEOPLE"]);
    const kw=title.split(/\s+/).map(v=>v.replace(/[^a-zA-Z0-9]/g,"")).filter(v=>v&&!stop.has(v.toUpperCase())).slice(0,4);
    const headline=(kw.join(" ")||"NEW VIDEO").toUpperCase(),words=headline.split(/\s+/),lines=[];while(words.length&&lines.length<2)lines.push(words.splice(0,Math.min(3,words.length)).join(" "));
    const c=createCanvas(1280,720),x=c.getContext("2d"),g=x.createLinearGradient(0,0,1280,720);g.addColorStop(0,"#05080f");g.addColorStop(1,"#27314a");x.fillStyle=g;x.fillRect(0,0,1280,720);
    let visual=null;
    const framePath=join(projectDir,"thumbnail-frame.jpg"),previousFramePath=join(projectDir,"thumbnail-frame-prev.jpg");
    const candidateTimes=[4,8,12,16,20,26,32,40,50,60];
    const savedCandidate=Number(meta.thumbnailCandidateIndex);
    const candidateStart=((Number.isInteger(savedCandidate)?savedCandidate:-1)+1)%candidateTimes.length;
    let chosenCandidate=candidateStart,frameSecond=candidateTimes[candidateStart],bestDiff=-1,bestBuffer=null;
    let previousHash=null;
    try{previousHash=await sharp(await readFile(previousFramePath)).resize(16,16,{fit:"fill"}).grayscale().raw().toBuffer()}catch{}
    for(let attempt=0;attempt<Math.min(6,candidateTimes.length);attempt++){
      const idx=(candidateStart+attempt)%candidateTimes.length,sec=candidateTimes[idx],tempPath=join(projectDir,"thumbnail-candidate-"+idx+".jpg");
      try{
        await new Promise((resolve,reject)=>{
          const p=spawn(ffmpegPath,["-y","-ss",String(sec),"-i",join(projectDir,"long.mp4"),"-frames:v","1","-q:v","3",tempPath]);
          let err="";p.stderr.on("data",d=>{err+=d.toString()});p.on("error",reject);p.on("close",code=>code===0?resolve():reject(new Error(err.slice(-400)||"frame extract failed")));
        });
        const buf=await readFile(tempPath);
        let diff=999;
        if(previousHash){const hash=await sharp(buf).resize(16,16,{fit:"fill"}).grayscale().raw().toBuffer();let sum=0;for(let i=0;i<Math.min(hash.length,previousHash.length);i++)sum+=Math.abs(hash[i]-previousHash[i]);diff=sum/Math.min(hash.length,previousHash.length)}
        if(diff>bestDiff){bestDiff=diff;bestBuffer=buf;chosenCandidate=idx;frameSecond=sec}
        if(!previousHash||diff>=18)break;
      }catch(e){console.warn("Thumbnail candidate "+sec+"s:",e.message)}
    }
    if(bestBuffer){visual=bestBuffer;await writeFile(framePath,bestBuffer);await writeFile(previousFramePath,bestBuffer)}
    else{for(const name of ["scene-1.jpg","scene1.jpg","visual-1.jpg","visual1.jpg","image-1.jpg","image1.jpg"]){try{visual=await readFile(join(projectDir,name));break}catch{}}}
    let panel=null;if(visual){try{panel=await sharp(visual).resize(620,720,{fit:"cover",position:"attention"}).modulate({brightness:.82,saturation:1.08}).png().toBuffer()}catch{visual=null;panel=null}}
    if(!visual){x.fillStyle="rgba(255,255,255,.10)";x.beginPath();x.arc(1035,225,245,0,Math.PI*2);x.fill();x.fillStyle="rgba(255,255,255,.055)";x.beginPath();x.arc(1110,520,170,0,Math.PI*2);x.fill()}
    x.textBaseline="middle";x.lineJoin="round";x.strokeStyle="rgba(0,0,0,.95)";x.lineWidth=12;x.fillStyle="#fff";const ys=lines.length>1?[315,415]:[365];lines.forEach((line,i)=>{let size=76;while(size>48){x.font="900 "+size+"px CaptionInter, sans-serif";if(x.measureText(line).width<=570)break;size-=2}x.strokeText(line,64,ys[i]);x.fillText(line,64,ys[i])});
    const canvasBuf=c.toBuffer("image/png");if(panel){const fade=Buffer.from('<svg width="620" height="720" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="f"><stop stop-color="#05080f" stop-opacity=".92"/><stop offset=".34" stop-color="#05080f" stop-opacity=".28"/><stop offset="1" stop-color="#05080f" stop-opacity="0"/></linearGradient></defs><rect width="220" height="720" fill="url(#f)"/></svg>');const composed=await sharp(panel).composite([{input:fade,left:0,top:0}]).png().toBuffer();await sharp(canvasBuf).composite([{input:composed,left:660,top:0}]).jpeg({quality:92}).toFile(out)}else await sharp(canvasBuf).jpeg({quality:92}).toFile(out);
    const url="/media/"+projectId+"/thumbnail.jpg";
    meta.thumbnailUrl=url;meta.thumbnailProvider=visual?"video-frame":"deterministic";meta.thumbnailSafety="smart-frame-v4.3";meta.thumbnailCandidateIndex=chosenCandidate;meta.thumbnailFrameIndex=chosenCandidate;meta.thumbnailFrameSecond=frameSecond;meta.thumbnailFrameDifference=Math.round(bestDiff*10)/10;meta.updatedAt=new Date().toISOString();await writeFile(metaPath,JSON.stringify(meta,null,2));
    res.json({ok:true,thumbnailUrl:url,provider:meta.thumbnailProvider,safety:meta.thumbnailSafety,frameIndex:chosenCandidate,frameSecond,frameDifference:meta.thumbnailFrameDifference});
  }catch(e){console.error("Thumbnail generation failed",e);res.status(500).json({error:e.message||"Thumbnail generation failed"})}
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


app.use("/media",express.static(storageRoot,{maxAge:"1h"}));
app.post("/api/projects/:id/checkpoint",async(req,res)=>{
  const id=String(req.params.id||"").replace(/[^a-zA-Z0-9_-]/g,"");if(!id)return res.status(400).json({error:"invalid_project_id"});
  try{
    const dir=join(storageRoot,id),path=join(dir,"project.json");await mkdir(dir,{recursive:true});let meta={id};try{meta=JSON.parse(await readFile(path,"utf8"))}catch(e){}
    const body=req.body||{},allowed=["title","narration","visualPlan","metadata","scriptReady","productionReady","renderReady","shortsReady","captionTimingReady","captionsReady","reviewApproved","scheduleReady"];
    for(const key of allowed)if(Object.prototype.hasOwnProperty.call(body,key))meta[key]=body[key];
    meta.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(meta,null,2));res.json({ok:true,project:meta});
  }catch(e){res.status(500).json({error:"checkpoint_save_failed",message:e.message})}
});
app.get("/api/projects",async(req,res)=>{
  try{
    const entries=await readdir(storageRoot,{withFileTypes:true}),projects=[];
    for(const entry of entries){if(!entry.isDirectory())continue;try{
      const meta=JSON.parse(await readFile(join(storageRoot,entry.name,"project.json"),"utf8")),yt=meta.youtube||{},reality=yt.realityCheck||{};
      const stages=[!!(meta.scriptReady||meta.narration),!!meta.voiceStored,!!(Array.isArray(meta.visualPlan)&&meta.visualPlan.length),!!meta.productionReady,!!meta.renderReady,!!meta.shortsReady,!!meta.captionTimingReady,!!meta.captionsReady,!!meta.metadata],done=stages.filter(Boolean).length;
      projects.push({id:meta.id||entry.name,title:meta.title||"Untitled project",updatedAt:meta.updatedAt||meta.createdAt||null,progress:Math.round(done/stages.length*100),productionReady:!!(meta.captionsReady&&meta.metadata),youtubeVerified:reality.ready===true,thumbnailVerified:reality.thumbnailOk===true,schedule:Array.isArray(yt.schedule)?yt.schedule:[],longVideoId:yt.longVideoId||null,shortCount:(yt.shorts||[]).filter(x=>x?.videoId).length});
    }catch(e){}}
    projects.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));res.json({ok:true,projects});
  }catch(e){res.status(500).json({error:"projects_list_failed",message:e.message})}
});
app.get("/api/projects/:id",async(req,res)=>{
  const id=String(req.params.id||"").replace(/[^a-zA-Z0-9_-]/g,"");
  try{const raw=await readFile(join(storageRoot,id,"project.json"),"utf8");res.json(JSON.parse(raw))}
  catch(e){res.status(404).json({error:"project_not_found"})}
});

app.listen(port,()=>console.log(`Faceless Studio backend listening on ${port}`));
