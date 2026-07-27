import os
import re
import logging
from typing import TypedDict, Annotated, Sequence
from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.graph import StateGraph, END, add_messages
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()
logger = logging.getLogger(__name__)

os.environ["GOOGLE_API_KEY"] = os.getenv("LLM_API_KEY", "")

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

llm = ChatGoogleGenerativeAI(
    model=os.getenv("LLM_MODEL", "gemini-2.0-flash-lite"),
    streaming=False,
    temperature=0.2
)

SYSTEM_PROMPT = """You are the ColaCode AI Copilot, an expert full-stack engineer pair-programming with the user.
Analyze the surrounding file context and fulfill the user's requests.

CRITICAL INSTRUCTIONS:
1. Output ONLY valid, clean, executable programming code matching the target language.
2. Do NOT wrap your response inside markdown code blocks (e.g., do NOT use ```typescript or ```).
3. Do NOT provide inline conversational commentary, introductory summaries, or markdown notes.
4. Produce raw code characters only."""

def sanitize_llm_code(text: str) -> str:
    """Strips markdown code fences (```lang ... ```) if the LLM output includes them."""
    cleaned = text.strip()
    match = re.search(r'```(?:\w+)?\n?(.*?)\n?```', cleaned, re.DOTALL)
    if match:
        return match.group(1).strip()
    return cleaned

async def agent_node(state: AgentState) -> dict:
    messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(state["messages"])
    response = await llm.ainvoke(messages)
    
    # Clean output
    if hasattr(response, 'content'):
        response.content = sanitize_llm_code(str(response.content))
        
    return {"messages": [response]}

workflow = StateGraph(AgentState)
workflow.add_node("agent", agent_node)
workflow.set_entry_point("agent")
workflow.add_edge("agent", END)

agent_engine = workflow.compile()