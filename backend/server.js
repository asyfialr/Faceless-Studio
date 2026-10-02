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
  version:"1.2.0"
}));

app.get("/api/capabilities",(req,res)=>res.json({
  youtube:false,
  ai:Boolean(process.env.OPENAI_API_KEY),
  renderer:false,
  storage:false
}));

app.post("/api/ai/script",async(req,res)=>{
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey)return res.status(503).json({error:"ai_not_configured",message:"OPENAI_API_KEY is not configured on the server."});
  const title=String(req.body?.title||"").trim();
  if(!title)return res.status(400).json({error:"title_required"});
  const audience=String(req.body?.audience||"US / International");
  const duration=String(req.body?.duration||"8-10 minutes");
  try{
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:process.env.OPENAI_MODEL||"gpt-5-mini",
        input:"Create an original faceless YouTube video script in natural American English. Topic: "+title+"\nAudience: "+audience+"\nTarget duration: "+duration+"\nReturn ONLY valid JSON with keys hook (string), outline (array of 5 strings), narration (string), shortsAngles (array of 3 strings). Avoid unsupported factual claims and avoid copying source text.",
        text:{format:{type:"json_object"}}
      })
    });
    const data=await response.json();
    if(!response.ok)return res.status(502).json({error:"ai_provider_error",details:data?.error?.message||"AI request failed"});
    const raw=data.output_text||data.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("")||"";
    const parsed=JSON.parse(raw);
    res.json({ok:true,script:parsed});
  }catch(error){
    res.status(500).json({error:"ai_generation_failed",message:error.message});
  }
});
app.listen(port,()=>console.log(`Faceless Studio backend listening on ${port}`));
