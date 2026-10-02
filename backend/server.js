import express from "express";
import cors from "cors";

const app=express();
const port=process.env.PORT||3000;
const allowedOrigin=process.env.FRONTEND_ORIGIN||"https://asyfialr.github.io";

app.use(cors({origin:allowedOrigin}));
app.use(express.json({limit:"1mb"}));

app.get("/api/health",(req,res)=>res.json({
  status:"ok",
  service:"Faceless Studio Backend",
  version:"1.4.1"
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

app.listen(port,()=>console.log(`Faceless Studio backend listening on ${port}`));
