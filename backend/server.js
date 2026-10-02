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
  version:"1.0.0"
}));

app.get("/api/capabilities",(req,res)=>res.json({
  youtube:false,
  ai:false,
  renderer:false,
  storage:false
}));

app.listen(port,()=>console.log(`Faceless Studio backend listening on ${port}`));
