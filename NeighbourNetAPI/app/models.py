"""
NeighbourNet — Pydantic v2 models.

All request / response bodies for the FastAPI backend.
Every field matches the mobile message schema exactly.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class PriorityTier(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


# ---------------------------------------------------------------------------
# Inbound message (one element of the batch the gateway phone uploads)
# ---------------------------------------------------------------------------


class MessageIn(BaseModel):
    message_id: str = Field(
        ...,
        description="UUID v4 generated on originating device. Primary dedup key.",
        min_length=36,
        max_length=36,
    )
    body: str = Field(
        ...,
        description="SOS body text — Bengali, English, or mixed. Max 500 chars.",
        min_length=1,
        max_length=500,
    )
    sender_id: str = Field(
        ...,
        description="Persistent Android ANDROID_ID of originating device.",
        min_length=1,
        max_length=64,
    )
    gps_lat: Optional[float] = Field(
        None,
        description="Last known GPS latitude. Null if unavailable.",
        ge=-90.0,
        le=90.0,
    )
    gps_lng: Optional[float] = Field(
        None,
        description="Last known GPS longitude. Null if unavailable.",
        ge=-180.0,
        le=180.0,
    )
    location_hint: Optional[str] = Field(
        None,
        description="Human-readable location hint, e.g. 'near Basirhat station Block 4'.",
        max_length=200,
    )
    priority_score: float = Field(
        ...,
        description="On-device LLM score. 0.0 = LOW, 1.0 = CRITICAL.",
        ge=0.0,
        le=1.0,
    )
    priority_tier: PriorityTier = Field(
        ...,
        description="Tier derived from priority_score on the device.",
    )
    ttl: int = Field(
        ...,
        description="Remaining hop budget at upload time. Starts at 10.",
        ge=0,
        le=10,
    )
    hop_count: int = Field(
        ...,
        description="Total hops traversed before upload.",
        ge=0,
    )
    created_at: datetime = Field(
        ...,
        description="Originating device timestamp (ISO 8601). May have clock skew.",
    )
    last_hop_at: datetime = Field(
        ...,
        description=(
            "Timestamp of the most recent relay. Used as canonical time "
            "because device clocks can have skew."
        ),
    )

    @field_validator("priority_tier", mode="before")
    @classmethod
    def tier_upper(cls, v: str) -> str:
        """Accept lowercase tiers from older app versions gracefully."""
        return v.upper() if isinstance(v, str) else v

    @model_validator(mode="after")
    def gps_both_or_neither(self) -> MessageIn:
        """GPS lat and lng must both be present or both be None."""
        lat_set = self.gps_lat is not None
        lng_set = self.gps_lng is not None
        if lat_set != lng_set:
            raise ValueError(
                "gps_lat and gps_lng must both be provided or both be null."
            )
        return self


# ---------------------------------------------------------------------------
# Batch request (envelope sent by the gateway phone)
# ---------------------------------------------------------------------------


class BatchRequest(BaseModel):
    gateway_id: str = Field(
        ...,
        description="sender_id of the uploading gateway phone.",
        min_length=1,
        max_length=64,
    )
    messages: list[MessageIn] = Field(
        ...,
        description="Up to 50 messages per request.",
        min_length=1,
        max_length=50,
    )


# ---------------------------------------------------------------------------
# Batch response — ALWAYS returned, even on partial failure
# ---------------------------------------------------------------------------


class BatchResponse(BaseModel):
    persisted_ids: list[str] = Field(
        description="message_ids successfully written to Supabase. Mobile marks these synced=true."
    )
    duplicate_ids: list[str] = Field(
        description="message_ids that already existed (deduped). No action needed on mobile."
    )
    failed_ids: list[str] = Field(
        description="message_ids that failed due to DB error. Mobile should retry these."
    )
    batch_size: int = Field(description="Total messages in the request.")


# ---------------------------------------------------------------------------
# Message read model (returned to coordinator dashboard)
# ---------------------------------------------------------------------------


class MessageOut(BaseModel):
    message_id: str
    body: str
    sender_id: str
    gps_lat: Optional[float]
    gps_lng: Optional[float]
    location_hint: Optional[str]
    priority_score: float
    priority_tier: PriorityTier
    # Cloud-refined fields (populated by Gemini worker, may be None initially)
    cloud_priority_tier: Optional[PriorityTier]
    triage_summary: Optional[str]
    extracted_location: Optional[str]
    hop_count: int
    ttl: int
    created_at: datetime
    last_hop_at: datetime
    acknowledged: bool
    acknowledged_at: Optional[datetime]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Acknowledge request
# ---------------------------------------------------------------------------


class AcknowledgeResponse(BaseModel):
    message_id: str
    acknowledged: bool
    acknowledged_at: datetime