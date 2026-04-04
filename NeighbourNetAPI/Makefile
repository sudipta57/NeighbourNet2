# NeighbourNet Backend — Makefile
# Usage: make <target>
#
# Requires: httpx, curl, Docker (for Grafana local), uvicorn
# All env vars are read from .env in the project root.

include .env
export

# ---------------------------------------------------------------------------
# Local dev
# ---------------------------------------------------------------------------

.PHONY: dev
dev:
	uvicorn app.main:app --reload --port 8000

.PHONY: install
install:
	pip install -r requirements.txt

# ---------------------------------------------------------------------------
# Health & metrics sanity checks
# ---------------------------------------------------------------------------

.PHONY: health
health:
	curl -s http://localhost:8000/health | python3 -m json.tool

.PHONY: metrics
metrics:
	curl -s http://localhost:8000/metrics | grep neighbournet

# ---------------------------------------------------------------------------
# Demo: fire the CRITICAL SOS that Ratan sends from his rooftop
# This uses DEMO_MSG_ID from .env so Gemini cache kicks in.
# Run this on stage — the Grafana CRITICAL counter goes from 0 to 1.
# ---------------------------------------------------------------------------

.PHONY: sync
sync:
	curl -s -X POST http://localhost:8000/api/messages/batch \
	  -H "Content-Type: application/json" \
	  -d '{ \
	    "gateway_id": "demo-gateway-arun-001", \
	    "messages": [{ \
	      "message_id": "$(DEMO_MSG_ID)", \
	      "body": "Trapped on roof, elderly mother cannot walk, need boat urgently", \
	      "sender_id": "victim-ratan-basirhat-001", \
	      "gps_lat": 22.6517, \
	      "gps_lng": 88.7795, \
	      "location_hint": "near Basirhat station Block 4, North 24 Parganas", \
	      "priority_score": 0.96, \
	      "priority_tier": "CRITICAL", \
	      "ttl": 7, \
	      "hop_count": 3, \
	      "created_at": "2026-05-22T14:32:00Z", \
	      "last_hop_at": "2026-05-22T14:34:12Z" \
	    }] \
	  }' | python3 -m json.tool

# Second call to test dedup — should return in duplicate_ids, not persisted_ids.
.PHONY: sync-dedup
sync-dedup: sync
	@echo "\n--- Sending same SOS again to verify dedup ---"
	$(MAKE) sync

# ---------------------------------------------------------------------------
# Demo: Bengali CRITICAL message
# আমরা আটকে পড়েছি, জল বাড়ছে, সাহায্য করুন
# Expected cloud_priority_tier: CRITICAL
# ---------------------------------------------------------------------------

.PHONY: sync-bengali
sync-bengali:
	curl -s -X POST http://localhost:8000/api/messages/batch \
	  -H "Content-Type: application/json" \
	  -d '{ \
	    "gateway_id": "demo-gateway-arun-001", \
	    "messages": [{ \
	      "message_id": "b7e9c2d1-0000-4abc-8000-000000000002", \
	      "body": "আমরা আটকে পড়েছি, জল বাড়ছে, সাহায্য করুন", \
	      "sender_id": "victim-bengali-002", \
	      "gps_lat": 22.6521, \
	      "gps_lng": 88.7801, \
	      "location_hint": "Gosaba Block, South 24 Parganas", \
	      "priority_score": 0.94, \
	      "priority_tier": "CRITICAL", \
	      "ttl": 5, \
	      "hop_count": 5, \
	      "created_at": "2026-05-22T14:15:00Z", \
	      "last_hop_at": "2026-05-22T14:30:00Z" \
	    }] \
	  }' | python3 -m json.tool

# ---------------------------------------------------------------------------
# Demo: LOW priority message (checking in, safe)
# Expected tier: LOW — proves the triage model is discriminating
# ---------------------------------------------------------------------------

.PHONY: sync-low
sync-low:
	curl -s -X POST http://localhost:8000/api/messages/batch \
	  -H "Content-Type: application/json" \
	  -d '{ \
	    "gateway_id": "demo-gateway-arun-001", \
	    "messages": [{ \
	      "message_id": "a1b2c3d4-0000-4abc-8000-000000000003", \
	      "body": "Safe and dry, no help needed. Offering boat to neighbours.", \
	      "sender_id": "volunteer-priya-003", \
	      "gps_lat": 22.6490, \
	      "gps_lng": 88.7760, \
	      "location_hint": null, \
	      "priority_score": 0.12, \
	      "priority_tier": "LOW", \
	      "ttl": 9, \
	      "hop_count": 1, \
	      "created_at": "2026-05-22T14:40:00Z", \
	      "last_hop_at": "2026-05-22T14:41:00Z" \
	    }] \
	  }' | python3 -m json.tool

# ---------------------------------------------------------------------------
# Dashboard queries
# ---------------------------------------------------------------------------

.PHONY: list
list:
	curl -s "http://localhost:8000/api/messages?acknowledged=false&limit=10" | python3 -m json.tool

.PHONY: list-critical
list-critical:
	curl -s "http://localhost:8000/api/messages?tier=CRITICAL&limit=10" | python3 -m json.tool

# Acknowledge the demo message (replace MESSAGE_ID with actual UUID).
.PHONY: ack
ack:
	curl -s -X POST "http://localhost:8000/api/messages/$(DEMO_MSG_ID)/acknowledge" | python3 -m json.tool

# ---------------------------------------------------------------------------
# Grafana local (Docker)
# ---------------------------------------------------------------------------

.PHONY: grafana
grafana:
	docker run -d \
	  --name neighbournet-grafana \
	  -p 3001:3000 \
	  -v $(PWD)/grafana/dashboards:/var/lib/grafana/dashboards \
	  grafana/grafana:latest
	@echo "Grafana running at http://localhost:3001 (admin/admin)"
	@echo "Add Prometheus datasource pointing to http://host.docker.internal:8000/metrics"
	@echo "Import grafana/dashboards/neighbournet.json"

.PHONY: grafana-stop
grafana-stop:
	docker stop neighbournet-grafana && docker rm neighbournet-grafana

# ---------------------------------------------------------------------------
# Supabase migrations
# ---------------------------------------------------------------------------

.PHONY: migrate
migrate:
	supabase db push

.PHONY: migrate-local
migrate-local:
	psql $(SUPABASE_URL) -f supabase/migrations/001_initial_schema.sql