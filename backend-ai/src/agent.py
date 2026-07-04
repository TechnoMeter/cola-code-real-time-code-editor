import os
import logging
from typing import TypedDict, Annotated, Sequence
from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.graph import StateGraph, END, add_messages
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

logger = logging.getLogger(__name__)

# Bind the custom key configuration directly into the expected Google API wrapper environment
os.environ["GOOGLE_API_KEY"] = os.getenv("LLM_API_KEY", "")

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

# Initialize the LLM using your previous project's parameters and thinking profiles
llm = ChatGoogleGenerativeAI(
    model=os.getenv("LLM_MODEL", "gemini-3.1-flash-lite"),
    streaming=True,
    model_kwargs={
        "thinking_config": {"thinking_level": "HIGH"}
    }
)

SYSTEM_PROMPT = """You are the ColaCode AI Copilot, an expert full-stack engineer pair-programming with the user.
Analyze the surrounding file context and fulfill the user's requests.

CRITICAL INSTRUCTIONS:
1. Output ONLY valid, clean, executable programming code matching the target language.
2. Do NOT wrap your response inside markdown code blocks (e.g., do NOT use ```typescript or ```).
3. Do NOT provide inline conversational commentary, introductory summaries, or markdown notes.
4. Produce raw code characters only."""

async def agent_node(state: AgentState) -> dict:
    """Processes message arrays inside a unified system context framework."""
    messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(state["messages"])
    response = await llm.ainvoke(messages)
    return {"messages": [response]}

# Define the production state graph loop matrix
workflow = StateGraph(AgentState)
workflow.add_node("agent", agent_node)
workflow.set_entry_point("agent")
workflow.add_edge("agent", END)

agent_engine = workflow.compile()