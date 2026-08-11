"""Small executable probes for the two LangGraph interrupt edge cases in Sprint 0."""

from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt


class ParallelState(TypedDict):
    answers: Annotated[list[str], operator.add]


def build_parallel_graph(checkpointer: Any):
    def review_a(_: ParallelState):
        return {"answers": [f"a:{interrupt({'review': 'a'})}"]}

    def review_b(_: ParallelState):
        return {"answers": [f"b:{interrupt({'review': 'b'})}"]}

    graph = StateGraph(ParallelState)
    graph.add_node("review_a", review_a)
    graph.add_node("review_b", review_b)
    graph.add_edge(START, "review_a")
    graph.add_edge(START, "review_b")
    graph.add_edge("review_a", END)
    graph.add_edge("review_b", END)
    return graph.compile(checkpointer=checkpointer)


class ChildState(TypedDict):
    reviewed: str


class ParentState(TypedDict):
    reviewed: str


def build_subgraph_graph(checkpointer: Any):
    def child_review(_: ChildState):
        return {"reviewed": interrupt({"review": "subgraph"})}

    child = StateGraph(ChildState)
    child.add_node("child_review", child_review)
    child.add_edge(START, "child_review")
    child.add_edge("child_review", END)

    parent = StateGraph(ParentState)
    parent.add_node("child", child.compile())
    parent.add_edge(START, "child")
    parent.add_edge("child", END)
    return parent.compile(checkpointer=checkpointer)


def run_parallel_probe() -> dict[str, Any]:
    from langgraph.checkpoint.memory import InMemorySaver

    graph = build_parallel_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "parallel-spike"}}
    paused = graph.invoke({"answers": []}, config=config)
    interrupts = paused["__interrupt__"]
    responses = {item.id: f"answer-for-{item.value['review']}" for item in interrupts}
    completed = graph.invoke(Command(resume=responses), config=config)
    return {"interrupt_count": len(interrupts), "answers": completed["answers"]}


def run_subgraph_probe() -> dict[str, Any]:
    from langgraph.checkpoint.memory import InMemorySaver

    graph = build_subgraph_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "subgraph-spike"}}
    paused = graph.invoke({"reviewed": ""}, config=config)
    interrupt_item = paused["__interrupt__"][0]
    snapshot = graph.get_state(config)
    child_task = snapshot.tasks[0]
    completed = graph.invoke(Command(resume="approved-in-parent"), config=config)
    return {
        "interrupt_payload": interrupt_item.value,
        "child_checkpoint_namespace": child_task.state["configurable"]["checkpoint_ns"],
        "reviewed": completed["reviewed"],
    }


if __name__ == "__main__":
    print("parallel:", run_parallel_probe())
    print("subgraph:", run_subgraph_probe())
