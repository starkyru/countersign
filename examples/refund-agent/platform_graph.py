"""LangGraph API entry point for the local Agent Inbox/Platform exercise."""

from refund_agent import build_refund_graph

# LangGraph API supplies durable thread/checkpoint storage. Deployment graphs
# therefore compile without an application-owned checkpointer.
graph = build_refund_graph(None)
