import express from "express";
import cors from "cors";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import {createCanvas,GlobalFonts} from "@napi-rs/canvas";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile,readFile,rm,mkdir,stat,readdir,statfs} from "node:fs/promises";
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

const allowedOrigins=new Set([allowedOrigin,"https://asyfialr.github.io"]);app.use(cors({origin:function(origin,cb){if(!origin||allowedOrigins.has(origin))return cb(null,true);cb(new Error("CORS origin not allowed"))},exposedHeaders:["X-Project-Id","X-Video-Url"]}));
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

app.post("/api/ai/ideas",async(req,res)=>{
  const geminiKey=process.env.GEMINI_API_KEY,openaiKey=process.env.OPENAI_API_KEY;
  const niche=String(req.body?.niche||"AI & Technology").trim().slice(0,120),audience=String(req.body?.audience||"United States").trim().slice(0,80);
  if(!geminiKey&&!openaiKey)return res.status(503).json({error:"ai_not_configured",message:"No AI provider is configured."});
  const prompt="Generate exactly 4 original faceless YouTube video ideas for the niche: "+niche+"\nTarget audience: "+audience+"\nPrioritize evergreen or timely-interest concepts with a clear curiosity gap, useful payoff, and strong potential for one Long video plus three distinct Shorts. Avoid fake urgency, unsupported claims, repetitive angles, and generic titles. Return ONLY valid JSON with key ideas, an array of exactly 4 objects. Each object must have title (max 85 characters), angle (one concise sentence), and hook (one concise sentence).";
  async function normalize(raw,provider,model){
    const parsed=JSON.parse(raw),items=Array.isArray(parsed?.ideas)?parsed.ideas.slice(0,4):[];
    const ideas=items.map(x=>({title:String(x?.title||"").trim().slice(0,85),angle:String(x?.angle||"").trim().slice(0,220),hook:String(x?.hook||"").trim().slice(0,220)})).filter(x=>x.title);
    if(ideas.length!==4)throw new Error("AI provider did not return exactly 4 valid ideas");
    return {ok:true,provider,model:model||null,ideas};
  }
  if(geminiKey)try{
    const models=[process.env.GEMINI_IDEA_MODEL||"gemini-3.5-flash-lite",process.env.GEMINI_MODEL,"gemini-3.5-flash-lite"].filter((v,i,a)=>v&&a.indexOf(v)===i);
    let lastError=null;
    for(const model of models){
      const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(geminiKey),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})});
      const data=await r.json();
      if(r.ok){const raw=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";console.log("[ideas] Gemini success",JSON.stringify({model,status:r.status}));return res.json(await normalize(raw,"gemini",model))}
      lastError=data?.error?.message||"Gemini request failed";
      console.warn("[ideas] Gemini failed",JSON.stringify({model,status:r.status,error:String(lastError).slice(0,500)}));
    }
    if(!openaiKey)return res.status(502).json({error:"gemini_error",details:"Gemini Idea Generator is temporarily unavailable. Check GEMINI_API_KEY / Gemini quota and try again."});
    if(/credit|billing|quota|insufficient_quota/i.test(String(lastError||"")))console.warn("[ideas] Gemini unavailable; trying OpenAI fallback");
  }catch(e){if(!openaiKey)return res.status(500).json({error:"idea_generation_failed",message:e.message})}
  try{
    const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":"Bearer "+openaiKey,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5-mini",input:prompt,text:{format:{type:"json_object"}}})}),data=await r.json();
    if(!r.ok){const detail=data?.error?.message||"OpenAI request failed";console.warn("[ideas] OpenAI fallback failed",JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5-mini",status:r.status,error:String(detail).slice(0,500)}));return res.status(502).json({error:/credit|billing|quota|insufficient_quota/i.test(detail)?"ai_credits_unavailable":"ai_provider_error",details:/credit|billing|quota|insufficient_quota/i.test(detail)?"AI provider credits are unavailable. Add credits or configure Gemini, then try again.":detail});}
    const raw=data.output_text||data.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("")||"";
    return res.json(await normalize(raw,"openai",process.env.OPENAI_MODEL||"gpt-5-mini"));
  }catch(e){return res.status(500).json({error:"idea_generation_failed",message:e.message})}
});

app.post("/api/ai/script",async(req,res)=>{
  const geminiKey=process.env.GEMINI_API_KEY;
  const openaiKey=process.env.OPENAI_API_KEY;
  const title=String(req.body?.title||"").trim();
  if(!title)return res.status(400).json({error:"title_required"});
  if(!geminiKey&&!openaiKey)return res.status(503).json({error:"ai_not_configured",message:"No AI provider is configured."});
  const audience=String(req.body?.audience||"US / International");
  const duration=String(req.body?.duration||"8-10 minutes");
  const prompt="Create an original faceless YouTube video script in natural American English. Topic: "+title+"\nAudience: "+audience+"\nTarget duration: "+duration+"\nQuality target: strong YouTube retention without clickbait. Open with a specific curiosity gap in the first 1-2 sentences, reveal useful information progressively, vary sentence length for natural narration, use concrete examples, and add a brief pattern interrupt or forward-looking tease roughly every 30-45 seconds. Avoid filler, repeated points, generic hype, fake urgency, and unsupported factual claims. End with a concise satisfying takeaway rather than a long outro. Each of the 3 Shorts angles must work as a standalone hook with one clear payoff and must not merely repeat the Long intro. Return ONLY valid JSON with keys hook (string), outline (array of 5 strings), narration (string), shortsAngles (array of 3 strings). Avoid copying source text.";
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
  const scratchRoot=join(storageRoot,".scratch");await mkdir(scratchRoot,{recursive:true});const dir=await mkdtemp(join(scratchRoot,"faceless-"));
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
  const projectDir=join(storageRoot,projectId),captionScratch=join(projectDir,".caption-scratch"),words=narration.replace(/\s+/g," ").split(" ").filter(Boolean);await rm(captionScratch,{recursive:true,force:true}).catch(()=>{});await mkdir(captionScratch,{recursive:true});
  const xml=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const ff=(args,label)=>new Promise((resolve,reject)=>{const cp=spawn(ffmpegPath,args);let err="";cp.stderr.on("data",d=>err+=d.toString().slice(-2500));cp.on("error",reject);cp.on("close",(code,signal)=>code===0?resolve():reject(new Error(label+" code="+code+" signal="+(signal||"none")+" "+err.slice(-850))))});
  const getSpeechWindows=async(audioPath,duration,count)=>{
    if(!count)return [];
    const raw=join(captionScratch,"caption-audio.raw");
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
      const img=join(captionScratch,`cap-${label}-${i}.png`),part=join(captionScratch,`cap-part-${label}-${i}.mp4`);await writeFile(img,canvas.toBuffer("image/png"));
      const st=Math.max(0,bounds[i]),len=Math.max(.18,bounds[i+1]-bounds[i]);
      await ff(["-y","-ss",st.toFixed(3),"-t",len.toFixed(3),"-i",input,"-loop","1","-i",img,"-filter_complex",`[0:v][1:v]overlay=(W-w)/2:${y}:shortest=1[v]`,"-map","[v]","-map","0:a?","-c:v","libx264","-preset","ultrafast","-crf","31","-threads","1","-c:a","aac","-b:a","96k","-shortest",part],label+" segment "+(i+1));
      await rm(img,{force:true}).catch(()=>{});parts.push(part);
    }
    const list=join(captionScratch,`concat-${label}.txt`);await writeFile(list,parts.map(p=>"file '"+p.replace(/'/g,"'\\''")+"'").join("\n"));
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
  finally{await rm(captionScratch,{recursive:true,force:true}).catch(()=>{})}
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
    const prompt="Create high-performing YouTube packaging for a faceless video targeting a US/international English audience. Topic: "+title+"\nNarration context: "+narration.slice(0,6000)+"\nThe Long title should create a clear curiosity gap or promise a specific useful insight while staying completely supported by the narration. Prefer natural spoken-English phrasing, strong concrete nouns/verbs, and front-load the most interesting idea. Avoid generic labels, ALL CAPS, excessive punctuation, fake urgency, sensational claims, and vague clickbait. Aim for roughly 45-70 characters when possible and never exceed 90. The 3 Shorts titles must each use a different angle/payoff and make sense standalone; do not simply number or paraphrase the Long title. The description should explain the value quickly in the first sentence, then give concise context and a natural CTA. Hashtags must be directly relevant. Return ONLY valid JSON with: longTitle (max 90 chars), description (2 concise paragraphs plus natural CTA), hashtags (array of 3-5 strings without #), shortsTitles (array of exactly 3 distinct titles, each max 80 chars).";
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
    
    const out=join(projectDir,"thumbnail.jpg"),stop=new Set(["THE","A","AN","TO","OF","FOR","AND","ARE","IS","USING","EVERY","PEOPLE","THIS","THAT","WITH","FROM","YOUR","YOU","WHAT","WHY","HOW"]);
    const kw=title.split(/\s+/).map(v=>v.replace(/[^a-zA-Z0-9]/g,"")).filter(v=>v&&!stop.has(v.toUpperCase())).slice(0,3);
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
    const body=req.body||{},allowed=["title","narration","visualPlan","metadata","scriptReady","productionReady","renderReady","shortsReady","captionTimingReady","captionsReady","reviewApproved","scheduleReady","archived","archivedAt"];
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
      projects.push({id:meta.id||entry.name,title:meta.title||"Untitled project",updatedAt:meta.updatedAt||meta.createdAt||null,progress:Math.round(done/stages.length*100),productionReady:!!(meta.captionsReady&&meta.metadata),youtubeVerified:reality.ready===true,thumbnailVerified:reality.thumbnailOk===true,schedule:Array.isArray(yt.schedule)?yt.schedule:[],longVideoId:yt.longVideoId||null,shortCount:(yt.shorts||[]).filter(x=>x?.videoId).length,archived:meta.archived===true,attention:reality.ready===true?null:!meta.renderReady?"Render incomplete":!meta.shortsReady?"Shorts incomplete":!meta.captionsReady?"Captions incomplete":!meta.metadata?"Metadata incomplete":!yt.longVideoId?"YouTube Long missing":(yt.shorts||[]).filter(x=>x?.videoId).length<3?"YouTube Shorts incomplete":!reality.thumbnailOk?"Thumbnail not verified":"YouTube verification pending"});
    }catch(e){}}
    projects.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));res.json({ok:true,projects});
  }catch(e){res.status(500).json({error:"projects_list_failed",message:e.message})}
});
app.post("/api/projects/:id/archive",async(req,res)=>{
  const id=String(req.params.id||"").replace(/[^a-zA-Z0-9_-]/g,"");if(!id)return res.status(400).json({error:"invalid_project_id"});
  try{const path=join(storageRoot,id,"project.json"),meta=JSON.parse(await readFile(path,"utf8")),archived=req.body?.archived!==false;meta.archived=archived;meta.archivedAt=archived?new Date().toISOString():null;meta.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(meta,null,2));res.json({ok:true,archived,project:meta})}
  catch(e){res.status(404).json({error:"project_not_found",message:e.message})}
});
app.delete("/api/projects/:id",async(req,res)=>{
  const id=String(req.params.id||"").replace(/[^a-zA-Z0-9_-]/g,"");if(!id)return res.status(400).json({error:"invalid_project_id"});
  try{
    const dir=join(storageRoot,id),path=join(dir,"project.json"),meta=JSON.parse(await readFile(path,"utf8"));
    if(meta.archived!==true)return res.status(409).json({error:"archive_required",message:"Archive the project before permanent deletion."});
    const confirmation=String(req.body?.confirmation||"").trim(),expected=String(meta.title||"Untitled project").trim();
    if(confirmation!==expected)return res.status(400).json({error:"confirmation_mismatch",message:"Project title confirmation does not match."});
    await rm(dir,{recursive:true,force:true});res.json({ok:true,deleted:true,id,title:expected});
  }catch(e){res.status(404).json({error:"project_not_found",message:e.message})}
});
app.get("/api/projects/:id",async(req,res)=>{
  const id=String(req.params.id||"").replace(/[^a-zA-Z0-9_-]/g,"");
  try{const raw=await readFile(join(storageRoot,id,"project.json"),"utf8");res.json(JSON.parse(raw))}
  catch(e){res.status(404).json({error:"project_not_found"})}
});

app.get("/api/autopilot/config",async(req,res)=>{
  try{const raw=await readFile(join(storageRoot,"autopilot-config.json"),"utf8");res.json(JSON.parse(raw))}
  catch(e){res.json({enabled:false,days:["MON","WED","FRI"],time:"19:00",timeZone:"America/New_York",shortIntervalDays:1,updatedAt:null})}
});
app.post("/api/autopilot/config",async(req,res)=>{
  try{
    const allowedDays=["SUN","MON","TUE","WED","THU","FRI","SAT"],days=Array.isArray(req.body?.days)?req.body.days.filter(x=>allowedDays.includes(x)):[];
    const time=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(req.body?.time||""))?String(req.body.time):"19:00";
    const zones=["America/New_York","America/Chicago","America/Denver","America/Los_Angeles"],timeZone=zones.includes(req.body?.timeZone)?req.body.timeZone:"America/New_York";
    const shortIntervalDays=Math.max(1,Math.min(3,Number(req.body?.shortIntervalDays)||1));
    const config={enabled:req.body?.enabled===true,days,time,timeZone,shortIntervalDays,updatedAt:new Date().toISOString(),mode:"config-only"};
    await writeFile(join(storageRoot,"autopilot-config.json"),JSON.stringify(config,null,2));res.json({ok:true,config});
  }catch(e){res.status(500).json({error:"autopilot_config_failed",message:e.message})}
});
const autopilotConfigPath=join(storageRoot,"autopilot-config.json"),autopilotHistoryPath=join(storageRoot,"autopilot-history.json");
async function readAutopilotHistory(){try{return JSON.parse(await readFile(autopilotHistoryPath,"utf8"))}catch(e){return {runs:[]}}}
function autopilotLocalParts(date,timeZone){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone,weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date),o={};
  parts.forEach(p=>{if(p.type!=="literal")o[p.type]=p.value});return {day:String(o.weekday||"").toUpperCase(),date:o.year+"-"+o.month+"-"+o.day,time:o.hour+":"+o.minute};
}
async function evaluateAutopilot(now=new Date(),record=false,source="manual"){
  let config;try{config=JSON.parse(await readFile(autopilotConfigPath,"utf8"))}catch(e){config={enabled:false,days:[],time:"19:00",timeZone:"America/New_York",shortIntervalDays:1}}
  const local=autopilotLocalParts(now,config.timeZone||"America/New_York"),history=await readAutopilotHistory(),slot=local.date+"T"+String(config.time||"19:00")+"@"+String(config.timeZone||"America/New_York");
  const alreadyRun=(history.runs||[]).some(r=>r.slot===slot),due=config.enabled===true&&(config.days||[]).includes(local.day)&&local.time===config.time&&!alreadyRun;
  const result={enabled:config.enabled===true,due,alreadyRun,slot,local,config,mode:"dry-run",checkedAt:now.toISOString()};
  if(record&&due){const run={id:crypto.randomUUID(),slot,status:source==="automatic"?"auto-trigger-dry-run":"dry-run-complete",checkedAt:result.checkedAt,local,mode:"dry-run",source};history.runs=[run,...(history.runs||[])].slice(0,100);await writeFile(autopilotHistoryPath,JSON.stringify(history,null,2));result.recorded=run}
  return result;
}
app.get("/api/autopilot/engine/status",async(req,res)=>{try{res.json(await evaluateAutopilot(new Date(),false))}catch(e){res.status(500).json({error:"autopilot_engine_failed",message:e.message})}});
app.post("/api/autopilot/engine/pause",async(req,res)=>{try{let config;try{config=JSON.parse(await readFile(autopilotConfigPath,"utf8"))}catch{config={days:[],time:"19:00",timeZone:"America/New_York",shortIntervalDays:1}}config.enabled=false;config.pausedAt=new Date().toISOString();config.updatedAt=config.pausedAt;config.mode="config-only";await writeFile(autopilotConfigPath,JSON.stringify(config,null,2));res.json({ok:true,paused:true,config})}catch(e){res.status(500).json({error:"autopilot_pause_failed",message:e.message})}});
app.post("/api/autopilot/engine/resume",async(req,res)=>{try{let config;try{config=JSON.parse(await readFile(autopilotConfigPath,"utf8"))}catch{config={days:[],time:"19:00",timeZone:"America/New_York",shortIntervalDays:1}}config.enabled=true;config.resumedAt=new Date().toISOString();config.updatedAt=config.resumedAt;config.mode="config-only";await writeFile(autopilotConfigPath,JSON.stringify(config,null,2));res.json({ok:true,paused:false,config})}catch(e){res.status(500).json({error:"autopilot_resume_failed",message:e.message})}});
app.post("/api/autopilot/engine/dry-run",async(req,res)=>{try{res.json(await evaluateAutopilot(new Date(),true))}catch(e){res.status(500).json({error:"autopilot_dry_run_failed",message:e.message})}});
app.get("/api/autopilot/history",async(req,res)=>{try{res.json(await readAutopilotHistory())}catch(e){res.status(500).json({error:"autopilot_history_failed",message:e.message})}});
const autopilotTopicsPath=join(storageRoot,"autopilot-topics.json");
async function readAutopilotTopics(){try{return JSON.parse(await readFile(autopilotTopicsPath,"utf8"))}catch(e){return {topics:[]}}}
function nextQueuedAutopilotTopic(store){
  return (store.topics||[])
    .map((topic,index)=>({topic,index}))
    .filter(x=>x.topic.status==="queued")
    .sort((a,b)=>String(a.topic.createdAt||"").localeCompare(String(b.topic.createdAt||""))||a.index-b.index)[0]?.topic||null;
}
app.get("/api/autopilot/topics",async(req,res)=>{try{res.json(await readAutopilotTopics())}catch(e){res.status(500).json({error:"autopilot_topics_failed",message:e.message})}});
app.post("/api/autopilot/topics",async(req,res)=>{
  try{const incoming=Array.isArray(req.body?.topics)?req.body.topics:[],clean=incoming.map(x=>String(x||"").trim()).filter(Boolean).slice(0,50),store=await readAutopilotTopics();store.topics=[...(store.topics||[]),...clean.map(title=>({id:crypto.randomUUID(),title,status:"queued",createdAt:new Date().toISOString()}))].slice(-100);await writeFile(autopilotTopicsPath,JSON.stringify(store,null,2));res.json({ok:true,topics:store.topics})}
  catch(e){res.status(500).json({error:"autopilot_topics_save_failed",message:e.message})}
});
app.get("/api/autopilot/queue/control",async(req,res)=>{try{const store=await readAutopilotTopics(),queued=(store.topics||[]).map((topic,index)=>({topic,index})).filter(x=>x.topic.status==="queued").sort((a,b)=>String(a.topic.createdAt||"").localeCompare(String(b.topic.createdAt||""))||a.index-b.index).map(x=>x.topic),next=queued[0]||null;res.json({queued:queued.length,next:next?{id:next.id,title:next.title,createdAt:next.createdAt}:null,topics:queued.map(t=>({id:t.id,title:t.title,createdAt:t.createdAt,priorityAt:t.priorityAt||null}))})}catch(e){res.status(500).json({error:"autopilot_queue_control_failed",message:e.message})}});
app.post("/api/autopilot/queue/:id/prioritize",async(req,res)=>{try{const store=await readAutopilotTopics(),topic=(store.topics||[]).find(t=>t.id===req.params.id&&t.status==="queued");if(!topic)return res.status(404).json({error:"queued_topic_not_found"});const oldest=(store.topics||[]).filter(t=>t.status==="queued").map(t=>Date.parse(t.createdAt)||Date.now()).reduce((a,b)=>Math.min(a,b),Date.now());topic.createdAt=new Date(oldest-1000).toISOString();topic.priorityAt=new Date().toISOString();await writeFile(autopilotTopicsPath,JSON.stringify(store,null,2));res.json({ok:true,next:topic})}catch(e){res.status(500).json({error:"autopilot_queue_prioritize_failed",message:e.message})}});
app.post("/api/autopilot/queue/:id/skip",async(req,res)=>{try{const store=await readAutopilotTopics(),topic=(store.topics||[]).find(t=>t.id===req.params.id&&t.status==="queued");if(!topic)return res.status(404).json({error:"queued_topic_not_found"});topic.status="skipped";topic.skippedAt=new Date().toISOString();await writeFile(autopilotTopicsPath,JSON.stringify(store,null,2));res.json({ok:true,skipped:{id:topic.id,title:topic.title}})}catch(e){res.status(500).json({error:"autopilot_queue_skip_failed",message:e.message})}});
const autopilotJobsPath=join(storageRoot,"autopilot-jobs.json");
async function readAutopilotJobs(){try{return JSON.parse(await readFile(autopilotJobsPath,"utf8"))}catch(e){return {jobs:[]}}}
async function cleanupAutopilotPlaceholders(store){
  const before=(store.jobs||[]).length;
  store.jobs=(store.jobs||[]).filter(j=>!(!j.title&&!j.topicId&&!j.projectId&&j.status==="queued-safe"&&j.stage==="awaiting-backend-pipeline"));
  if(store.jobs.length!==before)await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  return store;
}
async function createAutopilotProductionJob(result){
  const store=await readAutopilotJobs();if((store.jobs||[]).some(j=>j.slot===result.slot))return null;
  const topics=await readAutopilotTopics(),topic=nextQueuedAutopilotTopic(topics);const job={id:crypto.randomUUID(),slot:result.slot,status:topic?"queued-safe":"waiting-topic",stage:topic?"script-ready":"awaiting-topic",topicId:topic?.id||null,title:topic?.title||null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),timeZone:result.config.timeZone,shortIntervalDays:result.config.shortIntervalDays,autoPublish:false,safety:"NO_UPLOAD"};if(topic){topic.status="assigned";topic.assignedJobId=job.id;topic.assignedAt=new Date().toISOString();await writeFile(autopilotTopicsPath,JSON.stringify(topics,null,2))}
  store.jobs=[job,...(store.jobs||[])].slice(0,100);await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));return job;
}
app.get("/api/autopilot/jobs",async(req,res)=>{try{res.json(await cleanupAutopilotPlaceholders(await readAutopilotJobs()))}catch(e){res.status(500).json({error:"autopilot_jobs_failed",message:e.message})}});
app.get("/api/autopilot/audit",async(req,res)=>{try{
  const store=await cleanupAutopilotPlaceholders(await readAutopilotJobs()),jobs=(store.jobs||[]).filter(j=>j.title||j.topicId||j.projectId).slice().sort((a,b)=>String(b.completedAt||b.updatedAt||b.createdAt||"").localeCompare(String(a.completedAt||a.updatedAt||a.createdAt||""))).slice(0,50),items=[];
  for(const j of jobs){
    let yt={};if(j.projectId)try{const meta=JSON.parse(await readFile(join(storageRoot,j.projectId,"project.json"),"utf8"));yt=meta.youtube||{}}catch{}
    const shortIds=Array.isArray(yt.shorts)?yt.shorts.map(x=>x?.videoId).filter(Boolean):[],longId=yt.longVideoId||null;
    items.push({id:j.id,projectId:j.projectId||null,title:j.title||"Untitled",status:j.status||null,stage:j.stage||null,createdAt:j.createdAt||null,completedAt:j.completedAt||null,updatedAt:j.updatedAt||null,durationSeconds:Number(j.longDuration||j.productionMetrics?.durationSeconds||0)||null,voiceProvider:j.voiceProvider||j.productionMetrics?.voiceProvider||null,voiceModel:j.voiceModel||j.productionMetrics?.voiceModel||null,visuals:Number(j.visualCount||j.productionMetrics?.visualCount||0),videos:Number(j.youtubeVideoCount||j.productionMetrics?.outputVideos||0),youtubeVerified:j.status==="youtube-complete"||j.stage==="complete",youtube:{longVideoId:longId,longUrl:longId?"https://www.youtube.com/watch?v="+encodeURIComponent(longId):null,shorts:shortIds.map(id=>({videoId:id,url:"https://www.youtube.com/shorts/"+encodeURIComponent(id)}))},recovered:Boolean(j.recoveredAt||j.storageRecoveredAt||j.lastStorageRecoveryAt),recoveryAt:j.recoveredAt||j.lastStorageRecoveryAt||j.storageRecoveredAt||null,error:j.error||j.lastError||null,costEstimate:j.costEstimate?.ttsUsageEquivalentUsd??null});
  }
  res.json({count:items.length,items});
}catch(e){res.status(500).json({error:"autopilot_audit_failed",message:e.message})}});
app.post("/api/autopilot/final-e2e",async(req,res)=>{try{
  const title=String(req.body?.title||"V6.7 Final Production Test").trim().slice(0,160);if(!title)return res.status(400).json({error:"title_required"});
  let config;try{config=JSON.parse(await readFile(autopilotConfigPath,"utf8"))}catch{config={enabled:false}}
  if(config.enabled!==true)return res.status(409).json({error:"autopilot_paused",message:"Resume Autopilot before starting the final E2E test."});
  const jobs=await cleanupAutopilotPlaceholders(await readAutopilotJobs());if((jobs.jobs||[]).some(isAutopilotJobActive))return res.status(409).json({error:"active_job_exists"});
  const topics=await readAutopilotTopics();if((topics.topics||[]).some(t=>t.status==="queued"))return res.status(409).json({error:"queue_not_empty",message:"Final E2E requires an empty queue."});
  const topic={id:crypto.randomUUID(),title,status:"queued",createdAt:new Date().toISOString(),finalE2E:true};topics.topics=[...(topics.topics||[]),topic].slice(-100);await writeFile(autopilotTopicsPath,JSON.stringify(topics,null,2));
  res.json({ok:true,releaseCandidate:"V7.0",topic:{id:topic.id,title:topic.title},message:"Final E2E topic queued. The normal autonomous pipeline will claim it on the next tick."});
}catch(e){res.status(500).json({error:"final_e2e_failed",message:e.message})}});
app.get("/api/autopilot/safety",async(req,res)=>{try{
  const store=await cleanupAutopilotPlaceholders(await readAutopilotJobs()),jobs=store.jobs||[],active=jobs.filter(isAutopilotJobActive),topics=await readAutopilotTopics(),queued=(topics.topics||[]).filter(t=>t.status==="queued"),assigned=(topics.topics||[]).filter(t=>t.status==="assigned");
  const slots=new Map(),projects=new Map();for(const j of jobs){if(j.slot)slots.set(j.slot,(slots.get(j.slot)||0)+1);if(j.projectId&&isAutopilotJobActive(j))projects.set(j.projectId,(projects.get(j.projectId)||0)+1)}
  const duplicateSlots=[...slots].filter(([,n])=>n>1).map(([slot,count])=>({slot,count})),duplicateActiveProjects=[...projects].filter(([,n])=>n>1).map(([projectId,count])=>({projectId,count}));
  let config;try{config=JSON.parse(await readFile(autopilotConfigPath,"utf8"))}catch{config={enabled:false}}
  let storage=null;try{const s=await statfs(storageRoot),total=Number(s.blocks)*Number(s.bsize),free=Number(s.bavail)*Number(s.bsize);storage={usedPercent:total?Number((((total-free)/total)*100).toFixed(1)):null,freeBytes:free}}catch{}
  const checks={singleActiveJob:active.length<=1,noDuplicateSlots:duplicateSlots.length===0,noDuplicateActiveProjects:duplicateActiveProjects.length===0,assignedTopicsBound:assigned.every(t=>jobs.some(j=>j.id===t.assignedJobId)),pauseBlocksNewClaims:config.enabled===true||active.length===0,storageHealthy:storage?.usedPercent==null||storage.usedPercent<90,lastTickHealthy:autopilotLastTickOk!==false};
  res.json({passed:Object.values(checks).every(Boolean),checks,counts:{active:active.length,queued:queued.length,assigned:assigned.length},duplicates:{slots:duplicateSlots,activeProjects:duplicateActiveProjects},storage,engineEnabled:config.enabled===true,lastTickAt:autopilotLastTickAt,lastTickError:autopilotLastTickError,checkedAt:new Date().toISOString()});
}catch(e){res.status(500).json({error:"autopilot_safety_failed",message:e.message})}});
app.get("/api/autopilot/quality",async(req,res)=>{try{
  const store=await cleanupAutopilotPlaceholders(await readAutopilotJobs()),jobs=(store.jobs||[]).filter(j=>j.projectId),latest=jobs.slice().sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")))[0]||null;
  if(!latest)return res.json({passed:true,version:"V7.1.4",message:"No production project available to inspect.",checks:{},checkedAt:new Date().toISOString()});
  let meta={};try{meta=JSON.parse(await readFile(join(storageRoot,latest.projectId,"project.json"),"utf8"))}catch{}
  const narration=String(meta.narration||""),words=narration.trim()?narration.trim().split(/\s+/).length:0,scenes=Array.isArray(meta.visualPlan)?meta.visualPlan:[],md=meta.metadata||{},longTitle=String(md.longTitle||""),shortTitles=Array.isArray(md.shortsTitles)?md.shortsTitles:[],selection=meta.shortsSelection||{},starts=Array.isArray(selection.starts)?selection.starts:[],angles=Array.isArray(meta.script?.shortsAngles)?meta.script.shortsAngles:[];
  const checks={
    narrationPresent:words>=100,
    visualPlanHealthy:scenes.length>=6&&scenes.length<=10&&scenes.every(s=>String(s.visualPrompt||"").trim().length>=20),
    longTitleHealthy:longTitle.length>=20&&longTitle.length<=90,
    shortsTitlesHealthy:shortTitles.length===3&&new Set(shortTitles.map(x=>String(x).trim().toLowerCase())).size===3,
    shortsDistributed:starts.length===3&&starts[0]<starts[1]&&starts[1]<starts[2],
    shortsAnglesReady:angles.length===3,
    thumbnailReady:meta.thumbnailReady===true||Boolean(meta.thumbnailUrl),
    captionsReady:meta.captionsReady===true
  };
  res.json({passed:Object.values(checks).every(Boolean),version:"V7.1.4",project:{id:latest.projectId,title:latest.title,status:latest.status,stage:latest.stage},checks,metrics:{narrationWords:words,visualScenes:scenes.length,longTitleChars:longTitle.length,shortTitleCount:shortTitles.length,shortStarts:starts,shortDuration:selection.duration??null,shortAngles:angles.length},checkedAt:new Date().toISOString()});
}catch(e){res.status(500).json({error:"autopilot_quality_failed",message:e.message})}});
app.get("/api/autopilot/stats",async(req,res)=>{try{const store=await cleanupAutopilotPlaceholders(await readAutopilotJobs()),jobs=store.jobs||[],done=jobs.filter(j=>j.stage==="complete"||j.status==="youtube-complete"),active=jobs.filter(j=>!(j.stage==="complete"||j.status==="youtube-complete")&&(j.title||j.topicId||j.projectId)),cloudflare=done.filter(j=>(j.voiceProvider||j.productionMetrics?.voiceProvider)==="cloudflare"),usage=done.reduce((sum,j)=>sum+Number(j.costEstimate?.ttsUsageEquivalentUsd||0),0),duration=done.reduce((sum,j)=>sum+Number(j.longDuration||j.productionMetrics?.durationSeconds||0),0),visuals=done.reduce((sum,j)=>sum+Number(j.visualCount||j.productionMetrics?.visualCount||0),0);res.json({completedJobs:done.length,activeJobs:active.length,totalVideos:done.reduce((sum,j)=>sum+Number(j.youtubeVideoCount||j.productionMetrics?.outputVideos||0),0),totalDurationSeconds:Number(duration.toFixed(1)),totalVisuals:visuals,cloudflareTtsJobs:cloudflare.length,ttsUsageEquivalentUsd:Number(usage.toFixed(6)),actualBilledUsd:null,freeTierMayCover:cloudflare.length>0,averageDurationSeconds:done.length?Number((duration/done.length).toFixed(1)):0,averageVisuals:done.length?Number((visuals/done.length).toFixed(1)):0,averageVideos:done.length?Number((done.reduce((sum,j)=>sum+Number(j.youtubeVideoCount||j.productionMetrics?.outputVideos||0),0)/done.length).toFixed(1)):0,lastCompletedAt:done.slice().sort((a,b)=>String(b.completedAt||b.updatedAt||"").localeCompare(String(a.completedAt||a.updatedAt||"")))[0]?.completedAt||null})}catch(e){res.status(500).json({error:"autopilot_stats_failed",message:e.message})}});
app.post("/api/autopilot/run-next",async(req,res)=>{
  try{
    const jobs=await readAutopilotJobs(),active=(jobs.jobs||[]).find(j=>(j.title||j.topicId||j.projectId)&&!["complete","youtube-error","visual-plan-error","voice-error","script-error","production-finalize-error","captions-error"].includes(String(j.stage||""))&&!["youtube-complete","youtube-failed","visual-plan-failed","voice-failed","script-failed","metadata-thumbnail-failed","captions-failed"].includes(String(j.status||"")));
    if(active)return res.status(409).json({error:"autopilot_busy",message:"An autopilot production job is already active.",job:active});
    const topics=await readAutopilotTopics(),topic=nextQueuedAutopilotTopic(topics);if(!topic)return res.status(409).json({error:"no_queued_topic",message:"No queued topic is available."});
    let config;try{config=JSON.parse(await readFile(autopilotConfigPath,"utf8"))}catch{config={enabled:false,days:[],time:"19:00",timeZone:"America/New_York",shortIntervalDays:1}}const now=new Date(),local=autopilotLocalParts(now,config.timeZone||"America/New_York"),result={slot:"manual-"+now.toISOString(),config,local,recorded:{id:crypto.randomUUID(),slot:"manual-"+now.toISOString(),status:"manual-repeatability-test",source:"manual"}};
    const job=await createAutopilotProductionJob(result);if(!job)throw new Error("Could not create repeatability test job");
    res.json({ok:true,job,topic:{id:topic.id,title:topic.title},message:"Queued topic assigned to the normal autonomous pipeline."});
  }catch(e){res.status(500).json({error:"run_next_failed",message:e.message})}
});
app.post("/api/autopilot/jobs/:id/retry-visual-plan",async(req,res)=>{
  try{const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>j.id===req.params.id);if(!job)return res.status(404).json({error:"job_not_found"});if(job.status!=="visual-plan-failed")return res.status(409).json({error:"job_not_failed",message:"Only failed visual-plan jobs can be retried."});job.status="voice-complete";job.stage="awaiting-visual-plan";job.visualPlanRetries=0;job.error=null;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));res.json({ok:true,job})}catch(e){res.status(500).json({error:"retry_failed",message:e.message})}
});
async function generateAutopilotScript(title){
  const geminiKey=process.env.GEMINI_API_KEY;if(!geminiKey)throw new Error("GEMINI_API_KEY not configured");
  const prompt="Create an original faceless YouTube video script in natural American English. Topic: "+title+"\nAudience: US / International\nTarget duration: 8-10 minutes\nReturn ONLY valid JSON with keys hook (string), outline (array of 5 strings), narration (string), shortsAngles (array of 3 strings). Avoid unsupported factual claims and avoid copying source text.";
  const models=[process.env.GEMINI_MODEL||"gemini-3.5-flash-lite","gemini-3.1-flash-lite"].filter((v,i,a)=>v&&a.indexOf(v)===i);let lastError="Gemini request failed";
  for(const model of models){for(let attempt=1;attempt<=2;attempt++){const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(geminiKey),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})}),data=await r.json();if(r.ok){const raw=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";return {model,script:JSON.parse(raw)}}lastError=data?.error?.message||lastError;if(attempt<2&&(r.status===429||r.status===503))await new Promise(resolve=>setTimeout(resolve,1200));else break}}
  throw new Error(lastError);
}
async function runAutopilotScriptWorker(){
  const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>j.stage==="script-ready"&&j.status==="queued-safe");if(!job)return null;
  job.status="running";job.stage="script-generating";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{
    const out=await generateAutopilotScript(job.title),projectId="auto-"+job.id.replace(/-/g,"").slice(0,16),dir=join(storageRoot,projectId);await mkdir(dir,{recursive:true});
    const meta={id:projectId,title:job.title,narration:out.script.narration,script:out.script,scriptReady:true,autopilotJobId:job.id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await writeFile(join(dir,"project.json"),JSON.stringify(meta,null,2));
    job.projectId=projectId;job.status="script-complete";job.stage="awaiting-voice";job.scriptModel=out.model;job.updatedAt=new Date().toISOString();job.safety="NO_UPLOAD";await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
    const topics=await readAutopilotTopics(),topic=(topics.topics||[]).find(x=>x.id===job.topicId);if(topic){topic.status="consumed";topic.consumedAt=new Date().toISOString();topic.projectId=projectId;await writeFile(autopilotTopicsPath,JSON.stringify(topics,null,2))}
    console.log("[autopilot] script complete",job.id,projectId);return job;
  }catch(e){job.status="script-failed";job.stage="script-error";job.error=String(e.message||e);job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] script failed",job.id,job.error);return job}
}
async function generateCloudflareVoice(text){
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_TOKEN;if(!accountId||!token)throw new Error("Cloudflare Workers AI credentials not configured");
  const model=process.env.CLOUDFLARE_TTS_MODEL||"@cf/myshell-ai/melotts",r=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(accountId)+"/ai/run/"+model,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({prompt:String(text||"").slice(0,4500),lang:"en"})});
  if(!r.ok){let data={};try{data=await r.json()}catch{}throw new Error("Cloudflare TTS: "+(data?.errors?.[0]?.message||data?.error||("HTTP "+r.status)))}
  const contentType=String(r.headers.get("content-type")||"");
  if(contentType.includes("audio/"))return {provider:"cloudflare",model,audio:Buffer.from(await r.arrayBuffer())};
  const data=await r.json(),encoded=data?.result?.audio||data?.audio;
  if(!encoded)throw new Error("Cloudflare TTS returned no audio");
  return {provider:"cloudflare",model,audio:Buffer.from(String(encoded).replace(/^data:audio\/[^;]+;base64,/,""),"base64")};
}
async function generateGoogleCloudVoice(text){
  const key=process.env.GOOGLE_CLOUD_TTS_API_KEY;if(!key)throw new Error("GOOGLE_CLOUD_TTS_API_KEY not configured");
  const languageCode=process.env.GOOGLE_CLOUD_TTS_LANGUAGE||"en-US",voiceName=process.env.GOOGLE_CLOUD_TTS_VOICE||"en-US-Wavenet-D";
  const r=await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({input:{text:String(text||"").slice(0,4500)},voice:{languageCode,name:voiceName},audioConfig:{audioEncoding:"LINEAR16",speakingRate:1.0,pitch:0}})}),data=await r.json();
  if(!r.ok)throw new Error("Google Cloud TTS: "+(data?.error?.message||("HTTP "+r.status)));
  if(!data?.audioContent)throw new Error("Google Cloud TTS returned no audio");
  return {provider:"google-cloud",model:voiceName,audio:Buffer.from(data.audioContent,"base64")};
}
async function generateGeminiVoice(text){
  const geminiKey=process.env.GEMINI_API_KEY;if(!geminiKey)throw new Error("GEMINI_API_KEY not configured");
  const model=process.env.GEMINI_TTS_MODEL||"gemini-3.8-flash-lite-tts",r=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{method:"POST",headers:{"x-goog-api-key":geminiKey,"Content-Type":"application/json"},body:JSON.stringify({model,input:[{type:"user_input",content:[{type:"text",text:String(text||"").slice(0,4000),annotations:[{type:"speech_metadata",style:"Natural confident American English YouTube documentary narration. Clear, warm, engaging, medium pace."}]}]}],response_format:{type:"audio"},generation_config:{speech_config:[{voice:"Kore"}]}})}),data=await r.json();
  if(!r.ok)throw new Error(data?.error?.message||"Gemini TTS request failed");const audio=data?.steps?.flatMap(step=>step?.content||[]).filter(item=>item?.type==="audio"&&item?.data).at(-1)?.data;if(!audio)throw new Error("Gemini TTS returned no audio");return {provider:"gemini",model,audio:Buffer.from(audio,"base64")};
}
async function generateAutopilotVoice(text){
  const preference=String(process.env.AUTOPILOT_TTS_PROVIDER||"auto").toLowerCase(),providers=[];
  if(preference==="cloudflare")providers.push(["cloudflare",generateCloudflareVoice]);
  else if(preference==="google-cloud")providers.push(["google-cloud",generateGoogleCloudVoice]);
  else if(preference==="gemini")providers.push(["gemini",generateGeminiVoice]);
  else{
    if(process.env.CLOUDFLARE_ACCOUNT_ID&&process.env.CLOUDFLARE_AI_TOKEN)providers.push(["cloudflare",generateCloudflareVoice]);
    if(process.env.GOOGLE_CLOUD_TTS_API_KEY)providers.push(["google-cloud",generateGoogleCloudVoice]);
    providers.push(["gemini",generateGeminiVoice]);
  }
  let lastError="No TTS provider available",errors=[];
  for(const [name,fn] of providers)try{return await fn(text)}catch(e){lastError=String(e.message||e);errors.push(name+": "+lastError);console.warn("[autopilot] TTS provider failed",name,lastError)}
  throw new Error(errors.join(" | ")||lastError);
}
function autopilotRetryDelayMs(message){
  const s=String(message||"");
  let m=s.match(/retry\s+in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if(!m)return 0;
  const ms=((Number(m[1]||0)*3600)+(Number(m[2]||0)*60)+Number(m[3]||0))*1000;
  return Math.max(60000,Math.ceil(ms));
}
async function runAutopilotVoiceWorker(){
  const store=await readAutopilotJobs(),now=Date.now();
  for(const failed of store.jobs||[]){
    if(failed.stage!=="voice-error"||failed.status!=="voice-failed")continue;
    const message=String(failed.error||""),delay=autopilotRetryDelayMs(message),rateLimited=/rate limit|quota|resource exhausted|too many requests/i.test(message);
    if(!rateLimited)continue;
    failed.status="script-complete";failed.stage="awaiting-voice";failed.voiceRateLimited=true;failed.voiceRetryAt=new Date(Date.now()+(delay||60*60*1000)+30000).toISOString();failed.updatedAt=new Date().toISOString();
    console.warn("[autopilot] migrated legacy voice rate-limit failure",failed.id,failed.voiceRetryAt);
    await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  }
  const cloudflareReady=Boolean(process.env.CLOUDFLARE_ACCOUNT_ID&&process.env.CLOUDFLARE_AI_TOKEN);
  const job=(store.jobs||[]).find(j=>j.stage==="awaiting-voice"&&j.status==="script-complete"&&(!j.voiceRetryAt||Date.parse(j.voiceRetryAt)<=now||(cloudflareReady&&j.voiceRateLimited)));if(!job)return null;
  if(cloudflareReady&&job.voiceRateLimited){console.log("[autopilot] bypassing Gemini retry timer; Cloudflare TTS available",job.id);delete job.voiceRetryAt;}
  job.status="running";job.stage="voice-generating";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{
    const dir=join(storageRoot,job.projectId),path=join(dir,"project.json"),meta=JSON.parse(await readFile(path,"utf8")),out=await generateAutopilotVoice(meta.narration);await writeFile(join(dir,"voice.wav"),out.audio);
    meta.voiceStored=true;meta.voiceUrl="/media/"+job.projectId+"/voice.wav";meta.voiceModel=out.model;meta.voiceProvider=out.provider||"unknown";meta.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(meta,null,2));
    job.status="voice-complete";job.stage="awaiting-visual-plan";job.voiceModel=out.model;job.voiceProvider=out.provider||"unknown";delete job.voiceRetryAt;delete job.voiceRateLimited;delete job.error;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] voice complete",job.id,job.projectId);return job;
  }catch(e){
    const message=String(e.message||e),delay=autopilotRetryDelayMs(message),rateLimited=/rate limit|quota|resource exhausted|too many requests/i.test(message);
    if(rateLimited){
      job.status="script-complete";job.stage="awaiting-voice";job.voiceRateLimited=true;job.voiceRetryAt=new Date(Date.now()+(delay||60*60*1000)+30000).toISOString();job.error=message;job.updatedAt=new Date().toISOString();
      await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.warn("[autopilot] voice rate limited; retry scheduled",job.id,job.voiceRetryAt);return job;
    }
    job.status="voice-failed";job.stage="voice-error";job.error=message;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] voice failed",job.id,job.error);return job;
  }
}
async function generateAutopilotVisualPlan(title,narration){
  const key=process.env.GEMINI_API_KEY;if(!key)throw new Error("GEMINI_API_KEY not configured");
  const models=[process.env.GEMINI_PLANNER_MODEL||"gemini-3.5-flash-lite","gemini-3.1-flash-lite"].filter((v,i,a)=>v&&a.indexOf(v)===i),prompt="Create a high-quality visual plan for an original faceless YouTube documentary. Title: "+title+"\nNarration: "+String(narration||"").slice(0,12000)+"\nEach scene must directly illustrate the specific narration beat it accompanies, not generic technology B-roll. Build visual continuity across the video while varying shot scale, composition, environment, and subject. Prefer concrete real-world objects, people from non-identifiable angles when useful, devices, workplaces, cities, diagrams-as-scenes, and believable near-future environments. For every visualPrompt specify the main subject, action, environment, framing/camera perspective, lighting/mood, and relevant visual details. Avoid logos, readable brand names, watermarks, UI text, celebrity likenesses, repeated compositions, abstract glowing AI brains, random robots, and unnecessary sci-fi imagery unless the narration specifically requires them. Keep onScreenText extremely short and only when it adds information. Return ONLY valid JSON with key scenes. scenes must be an array of 6 to 10 objects with keys: scene (number), duration (short string like 8-12 sec), visualPrompt (specific original image/video direction), onScreenText (short string, may be empty). Keep visuals realistic, copyright-conscious, safe, and suitable for a US/international audience.";let lastError="Visual planning failed";
  for(const model of models){for(let attempt=1;attempt<=3;attempt++){try{
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{scenes:{type:"ARRAY",minItems:6,maxItems:10,items:{type:"OBJECT",properties:{scene:{type:"INTEGER"},duration:{type:"STRING"},visualPrompt:{type:"STRING"},onScreenText:{type:"STRING"}},required:["scene","duration","visualPrompt","onScreenText"]}}},required:["scenes"]}}})}),data=await r.json();
    if(r.ok){let raw=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim()||"";raw=raw.replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");const first=raw.indexOf("{");if(first>=0){let depth=0,inString=false,escape=false,end=-1;for(let i=first;i<raw.length;i++){const ch=raw[i];if(inString){if(escape)escape=false;else if(ch==="\\\\")escape=true;else if(ch==='"')inString=false;continue}if(ch==='"'){inString=true;continue}if(ch==="{")depth++;else if(ch==="}"){depth--;if(depth===0){end=i;break}}}if(end>first)raw=raw.slice(first,end+1)}const plan=JSON.parse(raw);function findSceneArray(v,depth=0){if(depth>6||v==null)return null;if(Array.isArray(v)){if(v.length&&v.every(x=>x&&typeof x==="object")&&v.some(x=>x.visualPrompt||x.visual_prompt||x.prompt||x.visual||x.description))return v;for(const x of v){const found=findSceneArray(x,depth+1);if(found)return found}return null}if(typeof v==="object"){for(const key of ["scenes","visualPlan","visual_plan","shots","segments","plan"]){if(key in v){const found=findSceneArray(v[key],depth+1);if(found)return found}}for(const x of Object.values(v)){const found=findSceneArray(x,depth+1);if(found)return found}}return null}const found=findSceneArray(plan)||[],scenes=found.map((x,i)=>({scene:Number(x.scene||x.number||i+1),duration:String(x.duration||x.length||"8-12 sec"),visualPrompt:String(x.visualPrompt||x.visual_prompt||x.prompt||x.visual||x.description||""),onScreenText:String(x.onScreenText||x.on_screen_text||x.text||"")})).filter(x=>x.visualPrompt);if(!scenes.length)throw new Error("Visual plan JSON parsed but no usable scene array found");return {model,scenes:scenes.slice(0,10)}}
    lastError=data?.error?.message||("Gemini planner HTTP "+r.status);if(!(r.status===429||r.status===503))break;
  }catch(e){lastError=e.message||String(e)}
  if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1500));}}
  throw new Error(lastError);
}
async function runAutopilotVisualPlanWorker(){
  const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>(j.stage==="awaiting-visual-plan"&&j.status==="voice-complete")||(j.stage==="visual-plan-error"&&j.status==="visual-plan-failed"&&(j.visualPlanRetries||0)<2));if(!job)return null;if(job.status==="visual-plan-failed")job.visualPlanRetries=(job.visualPlanRetries||0)+1;
  job.status="running";job.stage="visual-plan-generating";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{const path=join(storageRoot,job.projectId,"project.json"),meta=JSON.parse(await readFile(path,"utf8")),out=await generateAutopilotVisualPlan(meta.title,meta.narration);meta.visualPlan=out.scenes;meta.visualPlanModel=out.model;meta.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(meta,null,2));job.status="visual-plan-complete";job.stage="awaiting-visuals";job.visualPlanModel=out.model;job.sceneCount=out.scenes.length;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] visual plan complete",job.id,out.scenes.length);return job}
  catch(e){job.status="visual-plan-failed";job.stage="visual-plan-error";job.error=String(e.message||e);job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] visual plan failed",job.id,job.error);return job}
}
async function generateAutopilotImage(prompt){
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_TOKEN,geminiKey=process.env.GEMINI_API_KEY;let cloudflareError="not configured";
  if(accountId&&token)try{const model="@cf/black-forest-labs/flux-1-schnell",r=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(accountId)+"/ai/run/"+model,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({prompt:String(prompt).slice(0,2048),steps:4})}),data=await r.json(),image=data?.result?.image;if(r.ok&&data?.success!==false&&image)return {provider:"cloudflare",model,mimeType:"image/jpeg",buffer:Buffer.from(image,"base64")};cloudflareError=(data?.errors?.map(e=>e.message).join("; ")||data?.error?.message||("HTTP "+r.status)).slice(0,500)}catch(e){cloudflareError=e.message}
  if(geminiKey)try{const model=process.env.GEMINI_IMAGE_MODEL||"gemini-3.1-flash-image",r=await fetch("https://generativelanguage.googleapis.com/v1/models/"+model+":generateContent",{method:"POST",headers:{"x-goog-api-key":geminiKey,"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"Generate one original cinematic 16:9 image for a faceless YouTube video. No logos, watermarks, copyrighted characters, or text. "+String(prompt).slice(0,1800)}]}],generationConfig:{responseModalities:["IMAGE"]}})}),data=await r.json(),parts=data?.candidates?.[0]?.content?.parts||[],part=parts.find(p=>p.inlineData?.data||p.inline_data?.data),inline=part?.inlineData||part?.inline_data;if(r.ok&&inline?.data)return {provider:"gemini",model,mimeType:inline.mimeType||inline.mime_type||"image/png",buffer:Buffer.from(inline.data,"base64")}}catch(e){}
  const safe=String(prompt||"Faceless Studio").split(/[.!?]/)[0].replace(/[<>&'"]/g," ").slice(0,72),svg='<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="720" fill="#111827"/><circle cx="1000" cy="180" r="360" fill="#1d4ed8" opacity=".25"/><circle cx="180" cy="650" r="420" fill="#2563eb" opacity=".18"/><text x="80" y="110" fill="#93c5fd" font-size="24" font-family="sans-serif">FACELESS STUDIO</text><text x="80" y="570" fill="#f8fafc" font-size="42" font-weight="700" font-family="sans-serif">'+safe+'</text></svg>';return {provider:"local-fallback",model:"sharp-procedural",mimeType:"image/jpeg",buffer:await sharp(Buffer.from(svg)).jpeg({quality:88}).toBuffer(),fallbackFrom:"cloudflare+gemini",providerError:cloudflareError};
}
async function runAutopilotVisualWorker(){
  const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>j.stage==="awaiting-visuals"&&j.status==="visual-plan-complete");if(!job)return null;
  job.status="running";job.stage="visuals-generating";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{const dir=join(storageRoot,job.projectId),path=join(dir,"project.json"),meta=JSON.parse(await readFile(path,"utf8")),scenes=Array.isArray(meta.visualPlan)?meta.visualPlan:[];if(!scenes.length)throw new Error("Project has no visual plan");const visualDir=join(dir,"visuals");await mkdir(visualDir,{recursive:true});const visuals=Array.isArray(meta.visuals)?meta.visuals:[];
    for(let i=0;i<scenes.length;i++){const existing=visuals.find(v=>v.scene===i+1);if(existing)continue;const out=await generateAutopilotImage(scenes[i].visualPrompt),ext=out.mimeType.includes("png")?"png":"jpg",name="scene-"+String(i+1).padStart(2,"0")+"."+ext;await writeFile(join(visualDir,name),out.buffer);visuals.push({scene:i+1,file:"visuals/"+name,url:"/media/"+job.projectId+"/visuals/"+name,provider:out.provider,model:out.model,mimeType:out.mimeType});meta.visuals=visuals;meta.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(meta,null,2));job.visualCount=visuals.length;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2))}
    meta.productionReady=visuals.length>=scenes.length;meta.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(meta,null,2));job.status="visuals-complete";job.stage="awaiting-long-render";job.visualCount=visuals.length;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] visuals complete",job.id,visuals.length);return job
  }catch(e){job.status="visuals-failed";job.stage="visuals-error";job.error=String(e.message||e);job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] visuals failed",job.id,job.error);return job}
}
async function getMediaDuration(path){
  return await new Promise((resolve,reject)=>{const cp=spawn(ffmpegPath,["-i",path,"-f","null","-"]);let err="";cp.stderr.on("data",d=>err+=d.toString());cp.on("error",reject);cp.on("close",()=>{const m=err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);m?resolve(Number(m[1])*3600+Number(m[2])*60+Number(m[3])):reject(new Error("Could not read media duration"))})});
}
async function runAutopilotLongRenderWorker(){
  const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>j.stage==="awaiting-long-render"&&j.status==="visuals-complete");if(!job)return null;
  job.status="running";job.stage="long-rendering";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{
    const dir=join(storageRoot,job.projectId),path=join(dir,"project.json"),meta=JSON.parse(await readFile(path,"utf8")),voice=join(dir,"voice.wav"),visuals=Array.isArray(meta.visuals)?meta.visuals:[];if(!visuals.length)throw new Error("No visuals available for Long render");
    const audioDuration=await getMediaDuration(voice),perScene=Math.max(2,audioDuration/visuals.length),listPath=join(dir,"autopilot-scenes.txt"),lines=[];
    for(const v of visuals.sort((a,b)=>a.scene-b.scene)){const imagePath=join(dir,v.file);lines.push("file '"+imagePath.replace(/'/g,"'\\''")+"'");lines.push("duration "+perScene.toFixed(3))}
    const last=join(dir,visuals[visuals.length-1].file);lines.push("file '"+last.replace(/'/g,"'\\''")+"'");await writeFile(listPath,lines.join("\n")+"\n");
    const out=join(dir,"long.mp4");await new Promise((resolve,reject)=>{const args=["-y","-f","concat","-safe","0","-i",listPath,"-i",voice,"-vf","scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p","-c:v","libx264","-preset","veryfast","-r","30","-c:a","aac","-b:a","128k","-shortest","-movflags","+faststart",out],cp=spawn(ffmpegPath,args);let err="";cp.stderr.on("data",d=>err=(err+d.toString()).slice(-5000));cp.on("error",reject);cp.on("close",code=>code===0?resolve():reject(new Error("FFmpeg exited "+code+" "+err.slice(-1500))))});
    meta.longVideoUrl="/media/"+job.projectId+"/long.mp4";meta.renderReady=true;meta.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(meta,null,2));job.status="long-render-complete";job.stage="awaiting-shorts";job.longDuration=Number(audioDuration.toFixed(1));job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] long render complete",job.id,job.longDuration);return job
  }catch(e){job.status="long-render-failed";job.stage="long-render-error";job.error=String(e.message||e);job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] long render failed",job.id,job.error);return job}
}
async function runAutopilotShortsWorker(){
  const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>j.stage==="awaiting-shorts"&&j.status==="long-render-complete");if(!job)return null;
  job.status="running";job.stage="shorts-rendering";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{
    const dir=join(storageRoot,job.projectId),input=join(dir,"long.mp4"),metaPath=join(dir,"project.json"),meta=JSON.parse(await readFile(metaPath,"utf8")),duration=await getMediaDuration(input),outputs=[];
    const clipLength=Math.min(24,Math.max(16,duration/8)),maxStart=Math.max(0,duration-clipLength),fractions=[0.04,0.38,0.72],starts=fractions.map(f=>Math.min(maxStart,Math.max(0,duration*f)));
    for(let i=0;i<3;i++){const start=starts[i],remaining=Math.max(2,duration-start),clip=Math.min(clipLength,remaining),out=join(dir,"short-"+(i+1)+".mp4");
      await new Promise((resolve,reject)=>{const args=["-y","-ss",String(start),"-i",input,"-t",String(clip),"-vf","scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p","-c:v","libx264","-preset","ultrafast","-threads","1","-r","30","-c:a","aac","-b:a","96k","-movflags","+faststart",out],cp=spawn(ffmpegPath,args);let err="";cp.stderr.on("data",d=>err=(err+d.toString()).slice(-3500));cp.on("error",reject);cp.on("close",(code,signal)=>code===0?resolve():reject(new Error("Short "+(i+1)+" FFmpeg code="+code+" signal="+(signal||"none")+" "+err.slice(-900))))});
      outputs.push("/media/"+job.projectId+"/short-"+(i+1)+".mp4");job.shortCount=outputs.length;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
    }
    meta.shorts=outputs;meta.shortsReady=true;meta.shortsSelection={strategy:"distributed-retention-v7.1.3",starts:starts.map(v=>Number(v.toFixed(1))),duration:Number(clipLength.toFixed(1)),angles:Array.isArray(meta.script?.shortsAngles)?meta.script.shortsAngles.slice(0,3):[]};meta.updatedAt=new Date().toISOString();await writeFile(metaPath,JSON.stringify(meta,null,2));job.status="shorts-complete";job.stage="awaiting-captions";job.shortCount=3;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] shorts complete",job.id);return job
  }catch(e){job.status="shorts-failed";job.stage="shorts-error";job.error=String(e.message||e);job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] shorts failed",job.id,job.error);return job}
}
async function cleanupAutopilotTempFiles(projectId){if(!projectId)return 0;const dir=join(storageRoot,projectId);let entries=[];try{entries=await readdir(dir,{withFileTypes:true})}catch{return 0}let removed=0;for(const e of entries){if(!e.isFile())continue;const n=e.name;if(n==="caption-audio.raw"||/^cap-(?:long|short\d+)-\d+\.png$/.test(n)||/^cap-part-(?:long|short\d+)-\d+\.mp4$/.test(n)||/^concat-(?:long|short\d+)\.txt$/.test(n)){try{await rm(join(dir,n),{force:true});removed++}catch{}}}if(removed)console.log("[autopilot] cleaned temp files",projectId,removed);return removed}
async function cleanupCompletedAutopilotMedia(excludeProjectId){
  const store=await readAutopilotJobs();let removed=0,bytes=0;
  const completed=(store.jobs||[]).filter(j=>j.status==="youtube-complete"&&j.stage==="complete"&&j.projectId&&j.projectId!==excludeProjectId).sort((a,b)=>String(a.completedAt||a.updatedAt||"").localeCompare(String(b.completedAt||b.updatedAt||"")));
  for(const job of completed){const dir=join(storageRoot,job.projectId);let entries=[];try{entries=await readdir(dir,{withFileTypes:true})}catch{continue}
    for(const e of entries){if(!e.isFile())continue;const n=e.name;if(n==="project.json"||/thumbnail/i.test(n))continue;if(!/\.(mp4|wav|raw|png|jpg|jpeg|webp)$/i.test(n))continue;
      const p=join(dir,n);try{const s=await stat(p);await rm(p,{force:true});removed++;bytes+=Number(s.size||0)}catch{}}
    if(removed>=12||bytes>=500*1024*1024)break;
  }
  if(removed)console.log("[autopilot] storage guard cleaned completed media",removed,Math.round(bytes/1048576)+"MB");return {removed,bytes};
}
async function runAutopilotCaptionsWorker(){
  const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>j.stage==="awaiting-captions"&&j.status==="shorts-complete");if(!job)return null;
  job.status="running";job.stage="captions-rendering";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{
    const path=join(storageRoot,job.projectId,"project.json"),meta=JSON.parse(await readFile(path,"utf8"));if(!meta.narration)throw new Error("Project narration is missing");
    const base=process.env.INTERNAL_BASE_URL||("http://127.0.0.1:"+port),r=await fetch(base+"/api/render/captions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:job.projectId,narration:meta.narration,longDuration:job.longDuration||0})}),data=await r.json();
    if(!r.ok)throw new Error(data?.message||data?.error||("Caption renderer HTTP "+r.status));
    const updated=JSON.parse(await readFile(path,"utf8"));updated.captionTimingReady=true;updated.captionsReady=true;updated.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(updated,null,2));
    job.status="captions-complete";job.stage="awaiting-metadata";job.captionEngine=data.captionEngine||"segmented-overlay";job.captionTiming=data.captionTiming||"unknown";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] captions complete",job.id,job.captionTiming);return job
  }catch(e){const msg=String(e.message||e),noSpace=/ENOSPC|no space left on device/i.test(msg);if(noSpace){await cleanupAutopilotTempFiles(job.projectId);await cleanupCompletedAutopilotMedia(job.projectId);job.status="shorts-complete";job.stage="awaiting-captions";job.storageRecoveryCount=Number(job.storageRecoveryCount||0)+1;job.lastStorageRecoveryAt=new Date().toISOString();job.error="Storage cleanup performed after ENOSPC; captions queued for retry";job.updatedAt=job.lastStorageRecoveryAt;console.warn("[autopilot] ENOSPC recovery",job.id,job.storageRecoveryCount)}else{job.status="captions-failed";job.stage="captions-error";job.error=msg;job.updatedAt=new Date().toISOString()}await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] captions failed",job.id,msg);return job}
  finally{await cleanupAutopilotTempFiles(job.projectId)}
}
async function runAutopilotMetadataThumbnailWorker(){
  const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>j.stage==="awaiting-metadata"&&j.status==="captions-complete");if(!job)return null;
  job.status="running";job.stage="metadata-generating";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{
    const path=join(storageRoot,job.projectId,"project.json"),meta=JSON.parse(await readFile(path,"utf8"));if(!meta.title||!meta.narration)throw new Error("Project title/narration is missing");
    const base=process.env.INTERNAL_BASE_URL||("http://127.0.0.1:"+port);
    const mr=await fetch(base+"/api/ai/metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:meta.title,narration:meta.narration})}),metadata=await mr.json();if(!mr.ok)throw new Error(metadata?.error||("Metadata HTTP "+mr.status));
    meta.metadata=metadata;meta.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(meta,null,2));
    job.stage="thumbnail-generating";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
    const tr=await fetch(base+"/api/ai/thumbnail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:job.projectId,title:metadata.longTitle||meta.title})}),thumb=await tr.json();if(!tr.ok)throw new Error(thumb?.error||("Thumbnail HTTP "+tr.status));
    const updated=JSON.parse(await readFile(path,"utf8"));updated.metadata=metadata;updated.metadataReady=true;updated.productionReady=true;updated.thumbnailReady=true;updated.updatedAt=new Date().toISOString();await writeFile(path,JSON.stringify(updated,null,2));
    job.status="production-complete";job.stage="awaiting-youtube";job.metadataReady=true;job.thumbnailReady=true;job.thumbnailProvider=thumb.provider||"unknown";job.thumbnailFrameSecond=thumb.frameSecond??null;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] production complete",job.id);return job
  }catch(e){job.status="metadata-thumbnail-failed";job.stage="production-finalize-error";job.error=String(e.message||e);job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] metadata/thumbnail failed",job.id,job.error);return job}
}
async function nextAutopilotPublishSlot(){
  let config;try{config=JSON.parse(await readFile(autopilotConfigPath,"utf8"))}catch{config={days:["SUN"],time:"19:00",timeZone:"America/New_York",shortIntervalDays:1}}
  const days=(config.days||[]).length?config.days:["SUN"],tz=config.timeZone||"America/New_York",time=config.time||"19:00",now=Date.now();
  for(let add=0;add<15;add++){const probe=new Date(now+add*86400000),lp=autopilotLocalParts(probe,tz);if(!days.includes(lp.day))continue;try{const utc=zonedLocalToUtc(lp.date,time,tz);if(utc.getTime()>now+5*60000)return {date:lp.date,time,timeZone:tz,shortIntervalDays:config.shortIntervalDays||1,utc}}catch{}}
  throw new Error("No future Autopilot publish slot found");
}
async function autopilotJsonPost(base,route,body){
  const r=await fetch(base+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error((d?.error||d?.message||route+" HTTP "+r.status));return d;
}
async function runAutopilotYouTubeWorker(){
  const store=await readAutopilotJobs(),job=(store.jobs||[]).find(j=>(j.stage==="awaiting-youtube"&&j.status==="production-complete")||(j.stage==="youtube-error"&&j.status==="youtube-failed"&&String(j.error||"").startsWith("Reality Check failed")));if(!job)return null;
  job.status="running";job.stage="youtube-uploading";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));
  try{
    const base=process.env.INTERNAL_BASE_URL||("http://127.0.0.1:"+port),metaPath=join(storageRoot,job.projectId,"project.json");let project=JSON.parse(await readFile(metaPath,"utf8")),md=project.metadata||{},yt=project.youtube||{},description=md.description||"";
    if(!yt.longVideoId){const d=await autopilotJsonPost(base,"/api/youtube/upload-long",{projectId:job.projectId,title:md.longTitle||project.title,description});job.youtubeLongId=d.videoId;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2))}
    project=JSON.parse(await readFile(metaPath,"utf8"));yt=project.youtube||{};
    for(let i=1;i<=3;i++){if(!yt.shorts?.[i-1]?.videoId){const d=await autopilotJsonPost(base,"/api/youtube/upload-short",{projectId:job.projectId,index:i,title:md.shortsTitles?.[i-1]||md.longTitle||project.title,description});job.youtubeShortCount=(job.youtubeShortCount||0)+1;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));project=JSON.parse(await readFile(metaPath,"utf8"));yt=project.youtube||{}}}
    job.stage="youtube-thumbnail";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));const thumb=await autopilotJsonPost(base,"/api/youtube/apply-thumbnail",{projectId:job.projectId});if(!thumb.thumbnailApplied)throw new Error("YouTube custom thumbnail not confirmed");
    job.stage="youtube-scheduling";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));const slot=await nextAutopilotPublishSlot(),sched=await autopilotJsonPost(base,"/api/youtube/schedule-project",{projectId:job.projectId,scheduleDate:slot.date,scheduleTime:slot.time,timeZone:slot.timeZone,shortIntervalDays:slot.shortIntervalDays});if(!Array.isArray(sched.scheduled)||sched.scheduled.length!==4)throw new Error("YouTube schedule did not confirm all 4 videos");
    job.stage="youtube-reality-check";job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));let reality=null;for(let attempt=1;attempt<=5;attempt++){reality=await autopilotJsonPost(base,"/api/youtube/reality-check",{projectId:job.projectId});job.realityAttempt=attempt;job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));if(reality.ready)break;if((reality.missing||[]).length)break;if(attempt<5)await new Promise(resolve=>setTimeout(resolve,attempt*5000))}if(!reality?.ready)throw new Error("Reality Check failed after "+(job.realityAttempt||1)+" checks: missing="+(reality?.missing||[]).join(",")+" unscheduled="+(reality?.unscheduled||[]).join(",")+" thumbnail="+reality?.thumbnailOk);
    job.status="youtube-complete";job.stage="complete";delete job.error;job.recovered=true;job.youtubeVerified=true;job.thumbnailVerified=true;job.youtubeVideoCount=4;job.publishSlot=slot.date+"T"+slot.time+"@"+slot.timeZone;job.completedAt=new Date().toISOString();job.updatedAt=job.completedAt;
    job.productionMetrics={voiceProvider:job.voiceProvider||project.voiceProvider||"unknown",voiceModel:job.voiceModel||project.voiceModel||"unknown",durationSeconds:Number(job.longDuration||0),visualCount:Number(job.visualCount||0),sceneCount:Number(job.sceneCount||0),outputVideos:4};
    job.costEstimate={currency:"USD",ttsUsageEquivalentUsd:job.productionMetrics.voiceProvider==="cloudflare"?Number((job.productionMetrics.durationSeconds/60*0.0002).toFixed(6)):null,actualBilledUsd:null,freeTierMayCover:job.productionMetrics.voiceProvider==="cloudflare",note:job.productionMetrics.voiceProvider==="cloudflare"?"Usage-equivalent estimate only. Actual billed cost may be $0 while Cloudflare Workers AI free allocation covers usage.":"Actual provider billing not measured; visual/render costs excluded unless metered."};
    try{const topics=await readAutopilotTopics(),topic=(topics.topics||[]).find(t=>t.id===job.topicId);if(topic){topic.status="consumed";topic.consumedAt=job.completedAt;topic.completedJobId=job.id;await writeFile(autopilotTopicsPath,JSON.stringify(topics,null,2))}}catch(e){console.warn("[autopilot] topic completion sync failed",job.id,e.message)}
    await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] YouTube Reality Check complete",job.id,job.publishSlot);return job
  }catch(e){job.status="youtube-failed";job.stage="youtube-error";job.error=String(e.message||e);job.updatedAt=new Date().toISOString();await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.error("[autopilot] YouTube failed",job.id,job.error);return job}
}
async function recoverInterruptedAutopilotJobs(){
  const store=await readAutopilotJobs();let changed=false;
  for(const job of store.jobs||[]){
    if(job.status!=="running")continue;
    const stage=String(job.stage||""),projectDir=job.projectId?join(storageRoot,job.projectId):null;
    if(stage==="script-generating"){job.status="queued-safe";job.stage="script-ready"}
    else if(stage==="voice-generating"){
      let voiceReady=false;try{await stat(join(projectDir,"voice.wav"));voiceReady=true}catch{}
      job.status=voiceReady?"voice-complete":"script-complete";job.stage=voiceReady?"awaiting-visual-plan":"awaiting-voice";
    }
    else if(stage==="visual-plan-generating"){
      let planReady=false;try{const meta=JSON.parse(await readFile(join(projectDir,"project.json"),"utf8"));planReady=Array.isArray(meta.visualPlan)&&meta.visualPlan.length>0}catch{}
      job.status=planReady?"visual-plan-complete":"voice-complete";job.stage=planReady?"awaiting-visuals":"awaiting-visual-plan";
    }
    else if(stage==="visuals-generating"){job.status="visual-plan-complete";job.stage="awaiting-visuals"}
    else if(stage==="long-rendering"){job.status="visuals-complete";job.stage="awaiting-long-render"}
    else if(stage==="shorts-rendering"){job.status="long-render-complete";job.stage="awaiting-shorts"}
    else if(stage==="captions-rendering"){job.status="shorts-complete";job.stage="awaiting-captions"}
    else if(stage==="metadata-generating"||stage==="thumbnail-generating"){job.status="captions-complete";job.stage="awaiting-metadata"}
    else if(stage.startsWith("youtube-")){job.status="production-complete";job.stage="awaiting-youtube"}
    else continue;
    job.recoveredFrom=stage;job.recoveredAt=new Date().toISOString();job.updatedAt=job.recoveredAt;delete job.error;changed=true;
  }
  if(changed){await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));console.log("[autopilot] recovered interrupted jobs safely")}
  return changed;
}
let autopilotTimerBusy=false,autopilotLastTickAt=null,autopilotLastTickOk=null,autopilotLastTickError=null;
const autopilotTerminalStages=new Set(["complete","youtube-error","visual-plan-error","voice-error","script-error","production-finalize-error","captions-error"]);
const autopilotTerminalStatuses=new Set(["youtube-complete","youtube-failed","visual-plan-failed","voice-failed","script-failed","metadata-thumbnail-failed","captions-failed"]);
function isAutopilotJobActive(job){
  return Boolean(job&&(job.title||job.topicId||job.projectId)&&!autopilotTerminalStages.has(String(job.stage||""))&&!autopilotTerminalStatuses.has(String(job.status||"")));
}
app.get("/api/autopilot/health",async(req,res)=>{try{const store=await readAutopilotJobs(),active=(store.jobs||[]).filter(isAutopilotJobActive),latest=(store.jobs||[]).slice().sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")))[0]||null,age=autopilotLastTickAt?Date.now()-Date.parse(autopilotLastTickAt):null;res.json({healthy:autopilotLastTickOk!==false&&(age===null||age<120000),busy:autopilotTimerBusy,lastTickAt:autopilotLastTickAt,lastTickOk:autopilotLastTickOk,lastError:autopilotLastTickError,activeJobs:active.length,latestJob:latest?{id:latest.id,status:latest.status,stage:latest.stage,title:latest.title||null}:null})}catch(e){res.status(500).json({healthy:false,error:"autopilot_health_failed",message:e.message})}});
async function recoverRetryableAutopilotFailures(){const store=await readAutopilotJobs();let changed=false;for(const job of store.jobs||[]){
  const legacyEnospc=job.status==="captions-failed"&&job.stage==="captions-error"&&/ENOSPC|no space left on device/i.test(String(job.error||""));
  let retries=Number(job.autoRetryCount||0);if(legacyEnospc&&job.storageFixVersion!=="V5.7.2"){await cleanupAutopilotTempFiles(job.projectId);await cleanupCompletedAutopilotMedia(job.projectId);job.autoRetryCount=0;retries=0;job.storageFixVersion="V5.7.2";job.storageRecoveredAt=new Date().toISOString();console.log("[autopilot] legacy ENOSPC caption recovery",job.id)}
  if(retries>=3)continue;let next=null;if(job.status==="visual-plan-failed"&&job.stage==="visual-plan-error")next=["voice-complete","awaiting-visual-plan"];else if(job.status==="captions-failed"&&job.stage==="captions-error")next=["shorts-complete","awaiting-captions"];else if(job.status==="metadata-thumbnail-failed"&&job.stage==="production-finalize-error")next=["captions-complete","awaiting-metadata"];else if(job.status==="youtube-failed"&&job.stage==="youtube-error")next=["production-complete","awaiting-youtube"];if(!next)continue;
  const last=job.lastAutoRetryAt?Date.parse(job.lastAutoRetryAt):0;if(!legacyEnospc&&last&&Date.now()-last<60000)continue;job.autoRetryCount=retries+1;job.lastAutoRetryAt=new Date().toISOString();job.recoveredFrom=job.stage;job.status=next[0];job.stage=next[1];job.updatedAt=job.lastAutoRetryAt;delete job.error;changed=true;console.log("[autopilot] auto retry",job.id,job.autoRetryCount,job.stage)}
  if(changed)await writeFile(autopilotJobsPath,JSON.stringify(store,null,2));return changed}
async function validateAutopilotProductionReadiness(){const jobs=await cleanupAutopilotPlaceholders(await readAutopilotJobs()),topics=await readAutopilotTopics(),all=jobs.jobs||[],done=all.filter(j=>j.status==="youtube-complete"&&j.stage==="complete"),active=all.filter(isAutopilotJobActive),failed=all.filter(j=>String(j.status||"").endsWith("-failed")),latest=done.slice().sort((a,b)=>String(b.completedAt||b.updatedAt||"").localeCompare(String(a.completedAt||a.updatedAt||"")))[0]||null,checks={completedProduction:done.length>0,autonomousSingleWorker:active.length<=1,queueConsistent:!(topics.topics||[]).some(t=>t.status==="assigned"&&!all.some(j=>j.id===t.assignedJobId)),youtubeRealityCheck:!!latest?.youtubeVerified,outputsComplete:Number(latest?.youtubeVideoCount||0)===4,thumbnailReady:!!latest?.thumbnailReady,ttsProviderTracked:!!(latest?.voiceProvider||latest?.productionMetrics?.voiceProvider),healthTick:autopilotLastTickOk!==false};checks.noActiveFailures=failed.filter(j=>!j.recoveredAt&&!j.completedAt).length===0;checks.storageRecoveryReady=typeof cleanupCompletedAutopilotMedia==="function";const passed=Object.values(checks).every(Boolean);const report={passed,releaseCandidate:passed?"V6.0-ready":"needs-attention",checks,counts:{completed:done.length,active:active.length,failed:failed.length,queued:(topics.topics||[]).filter(t=>t.status==="queued").length},latestCompleted:latest?{id:latest.id,title:latest.title||null,completedAt:latest.completedAt||null}:null,checkedAt:new Date().toISOString()};if(passed){try{await writeFile(join(storageRoot,"v6-release-candidate.json"),JSON.stringify(report,null,2))}catch(e){console.warn("[autopilot] release report write failed",e.message)}}return report}
app.get("/api/autopilot/validation",async(req,res)=>{try{res.json(await validateAutopilotProductionReadiness())}catch(e){res.status(500).json({passed:false,error:"autopilot_validation_failed",message:e.message})}});
app.get("/api/autopilot/diagnostics",async(req,res)=>{try{
  const store=await cleanupAutopilotPlaceholders(await readAutopilotJobs()),jobs=store.jobs||[],failed=jobs.filter(j=>String(j.status||"").endsWith("-failed")||String(j.stage||"").endsWith("-error")).slice().sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||""))),j=failed[0]||null;
  const adviceFor=(stage,error)=>{const s=String(stage||""),e=String(error||"");if(/ENOSPC|no space left/i.test(e))return"Storage is full. Run cleanup/recovery before retrying.";if(/youtube/i.test(s))return"Check YouTube OAuth, quota, scheduling permissions, then retry the YouTube stage.";if(/caption/i.test(s))return"Check render storage and caption assets, then retry captions.";if(/visual-plan/i.test(s))return"Check planner/API availability and retry visual planning.";if(/voice/i.test(s))return"Check the active TTS provider/quota and retry voice generation.";if(/script/i.test(s))return"Check script provider/API response and retry script generation.";if(/production-finalize|metadata/i.test(s))return"Check metadata/thumbnail provider and project files, then retry finalization.";return"Review the latest error and retry the failed stage after its dependency is healthy.";};
  res.json({healthy:!j,latestFailure:j?{id:j.id,projectId:j.projectId||null,title:j.title||"Untitled",status:j.status||null,stage:j.stage||null,error:j.error||j.lastError||"Unknown error",updatedAt:j.updatedAt||j.createdAt||null,retries:Number(j.autoRetryCount||0),suggestedAction:adviceFor(j.stage,j.error||j.lastError)}:null,checkedAt:new Date().toISOString()});
}catch(e){res.status(500).json({error:"autopilot_diagnostics_failed",message:e.message})}});
app.get("/api/autopilot/monitor",async(req,res)=>{try{
  const store=await cleanupAutopilotPlaceholders(await readAutopilotJobs()),jobs=store.jobs||[],done=jobs.filter(j=>j.stage==="complete"||j.status==="youtube-complete"),latest=done.slice().sort((a,b)=>String(b.completedAt||b.updatedAt||"").localeCompare(String(a.completedAt||a.updatedAt||"")))[0]||null,recovery=jobs.filter(j=>j.lastStorageRecoveryAt||j.storageRecoveredAt).slice().sort((a,b)=>String(b.lastStorageRecoveryAt||b.storageRecoveredAt||"").localeCompare(String(a.lastStorageRecoveryAt||a.storageRecoveredAt||"")))[0]||null;
  let storage=null;try{const s=await statfs(storageRoot),total=Number(s.blocks)*Number(s.bsize),free=Number(s.bavail)*Number(s.bsize);storage={totalBytes:total,freeBytes:free,usedBytes:Math.max(0,total-free),usedPercent:total?Number(((total-free)/total*100).toFixed(1)):null,freeInodes:Number(s.ffree??0)}}catch(e){storage={error:e.message}}
  const usage=done.reduce((sum,j)=>sum+Number(j.costEstimate?.ttsUsageEquivalentUsd||0),0);
  res.json({storage,tts:{provider:latest?.voiceProvider||latest?.productionMetrics?.voiceProvider||"unknown",model:latest?.voiceModel||latest?.productionMetrics?.voiceModel||"unknown",usageEquivalentUsd:Number(usage.toFixed(6)),actualBilledUsd:null,freeTierMayCover:done.some(j=>j.costEstimate?.freeTierMayCover)},recovery:recovery?{jobId:recovery.id,title:recovery.title||null,at:recovery.lastStorageRecoveryAt||recovery.storageRecoveredAt,count:Number(recovery.storageRecoveryCount||1),version:recovery.storageFixVersion||null}:null,updatedAt:new Date().toISOString()});
}catch(e){res.status(500).json({error:"autopilot_monitor_failed",message:e.message})}});
async function claimNextQueuedTopicAutomatically(){
  const jobs=await cleanupAutopilotPlaceholders(await readAutopilotJobs());
  if((jobs.jobs||[]).some(isAutopilotJobActive))return null;
  const topics=await readAutopilotTopics(),topic=nextQueuedAutopilotTopic(topics);
  if(!topic)return null;
  let config;try{config=JSON.parse(await readFile(autopilotConfigPath,"utf8"))}catch{config={enabled:false,days:[],time:"19:00",timeZone:"America/New_York",shortIntervalDays:1}}
  const now=new Date(),local=autopilotLocalParts(now,config.timeZone||"America/New_York"),slot="queue-"+now.toISOString();
  const job=await createAutopilotProductionJob({slot,config,local,recorded:{id:crypto.randomUUID(),slot,status:"queue-auto",source:"queue-runner"}});
  if(job)console.log("[autopilot] queue runner claimed",topic.title,job.id);
  return job;
}
async function automaticAutopilotTick(){
  if(autopilotTimerBusy)return;autopilotTimerBusy=true;
  try{
    const tickStartedAt=new Date().toISOString();
    const result=await evaluateAutopilot(new Date(),true,"automatic");
    if(result.recorded){console.log("[autopilot] automatic dry-run trigger recorded",result.recorded.slot);await createAutopilotProductionJob(result)}
    await recoverRetryableAutopilotFailures();
    await cleanupCompletedAutopilotMedia();
    if(result.enabled===true)await claimNextQueuedTopicAutomatically();
    await runAutopilotScriptWorker();await runAutopilotVoiceWorker();await runAutopilotVisualPlanWorker();await runAutopilotVisualWorker();await runAutopilotLongRenderWorker();await runAutopilotShortsWorker();await runAutopilotCaptionsWorker();await runAutopilotMetadataThumbnailWorker();await runAutopilotYouTubeWorker();
    const store=await readAutopilotJobs(),active=(store.jobs||[]).filter(isAutopilotJobActive),latest=(store.jobs||[]).slice().sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")))[0]||null;
    autopilotLastTickAt=new Date().toISOString();autopilotLastTickOk=true;autopilotLastTickError=null;
    console.log("[autopilot] health",JSON.stringify({tickStartedAt,lastTickAt:autopilotLastTickAt,activeJobs:active.length,latestJobId:latest?.id||null,latestStatus:latest?.status||null,latestStage:latest?.stage||null}));
  }
  catch(e){autopilotLastTickAt=new Date().toISOString();autopilotLastTickOk=false;autopilotLastTickError=String(e.message||e);console.error("[autopilot] automatic tick failed",e.message)}
  finally{autopilotTimerBusy=false}
}
recoverInterruptedAutopilotJobs().catch(e=>console.error("[autopilot] recovery failed",e.message)).finally(()=>setTimeout(automaticAutopilotTick,5000));
setInterval(automaticAutopilotTick,30000);
app.listen(port,()=>console.log(`Faceless Studio backend listening on ${port}`));
