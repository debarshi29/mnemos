"""
Core data models: Episode, Fact, GoalFact, and provenance junctions.
Domain-agnostic by design — domain fields live in `metadata` JSON.
"""

import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


FactType = Literal["preference", "status", "event", "skill", "goal", "other"]
GoalStatus = Literal["not_started", "in_progress", "done"]


def new_id() -> str:
    return str(uuid.uuid4())


class Episode(BaseModel):
    episode_id: str = Field(default_factory=new_id)
    user_id: str
    session_id: str
    text: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class Fact(BaseModel):
    fact_id: str = Field(default_factory=new_id)
    content: str
    type: FactType = "other"
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    last_seen: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict = Field(default_factory=dict)
    superseded_by: Optional[str] = None   # fact_id that replaced this one
    flagged: bool = False                  # both-flagged on tie contradiction


class GoalFact(BaseModel):
    goal_id: str = Field(default_factory=new_id)
    user_id: str
    topic: str
    phase_index: int
    phase_content: str
    status: GoalStatus = "not_started"
    metadata: dict = Field(default_factory=dict)


class FactProvenance(BaseModel):
    fact_id: str
    episode_id: str


class GoalFactProvenance(BaseModel):
    goal_id: str
    episode_id: str


class ConsolidationLogEntry(BaseModel):
    run_id: str = Field(default_factory=new_id)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    user_id: str
    episodes_processed: int
    facts_created: int
    facts_updated: int
    contradictions_resolved: int
    facts_pruned: int
    details: list[dict] = Field(default_factory=list)
