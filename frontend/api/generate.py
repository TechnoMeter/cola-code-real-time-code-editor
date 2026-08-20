import os
import re
from typing import TypedDict, Annotated, Sequence
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END, add_messages
from langchain_google_genai import ChatGoogleGenerativeAI

app = FastAPI()

class GenerateRequest(BaseModel):
    prompt: str
    context: str = ""

SYSTEM_PROMPT = """You are the ColaCode AI Copilot, an expert full-stack engineer pair-programming with the user.
Analyze the surrounding file context and fulfill the user's requests.

CRITICAL INSTRUCTIONS:
1. Output ONLY valid, clean, executable programming code matching the target language.
2. Do NOT wrap your response inside markdown code blocks (e.g., do NOT use ```typescript or ```).
3. Do NOT provide inline conversational commentary, introductory summaries, or markdown notes.
4. Produce raw code characters only."""

def sanitize_llm_code(text: str) -> str:
    cleaned = text.strip()
    match = re.search(r'```(?:\w+)?\n?(.*?)\n?```', cleaned, re.DOTALL)
    if match:
        return match.group(1).strip()
    return cleaned

@app.post("/api/generate")
async def generate_code(req: GenerateRequest):
    api_key = os.getenv("LLM_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Missing LLM API key environment variable.")

    try:
        llm = ChatGoogleGenerativeAI(
            model=os.getenv("LLM_MODEL", "gemini-2.0-flash-lite"),
            google_api_key=api_key,
            streaming=False,
            temperature=0.2
        )
        
        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=f"Surrounding Workspace Code Context:\n{req.context}\n\nUser Instruction: {req.prompt}")
        ]
        
        response = await llm.ainvoke(messages)
        raw_content = str(response.content) if hasattr(response, 'content') else str(response)
        
        cleaned_code = sanitize_llm_code(raw_content)
        cleaned_code = cleaned_code.replace('\r\n', '\n').replace('\r', '')
        
        return {"code": cleaned_code}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Generation Error: {str(e)}")