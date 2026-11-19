.PHONY: db-reset db-init migrate migrate-supabase seed logs api-docker

CONTAINER=knowflow-postgres
DB=knowflow
USER=postgres

# Connection string for remote Postgres (Supabase). Taken from the shell env if
# set, otherwise read from .env.local. For DDL prefer the session pooler (:5432)
# or the direct connection over the transaction pooler (:6543).
DATABASE_URL ?= $(shell grep -E '^DATABASE_URL=' .env.local 2>/dev/null | head -1 | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$$//' -e "s/^'//" -e "s/'$$//")

# db-reset:
# 	docker compose down -v
# 	docker compose up -d
# 	sleep 3
# 	make migrate

migrate:
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/001_init.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/002_add_meta_and_nullable_embedding.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/003_add_knowledge_bases.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/004_add_conversations.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/005_add_conversation_model.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/006_add_eval.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/007_add_auth.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/008_add_chunk_context.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/009_add_eval_judge_metrics.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/010_add_workspaces.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/011_add_workspace_invites.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/012_add_eval_run_filter.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/013_add_trgm_keyword_search.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/014_managed_eval_datasets.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/015_add_eval_dataset_revision.sql
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/migrations/017_add_eval_hit_at_k.sql

# Apply all migrations to DATABASE_URL (Supabase / any remote Postgres) via the
# local psql client instead of `docker exec`. Migrations are idempotent
# (IF NOT EXISTS), so this is safe to re-run; ON_ERROR_STOP halts on real errors.
migrate-supabase:
	@test -n "$(DATABASE_URL)" || { echo "DATABASE_URL is not set (looked in env and .env.local)"; exit 1; }
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/001_init.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/002_add_meta_and_nullable_embedding.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/003_add_knowledge_bases.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/004_add_conversations.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/005_add_conversation_model.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/006_add_eval.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/007_add_auth.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/008_add_chunk_context.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/009_add_eval_judge_metrics.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/010_add_workspaces.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/011_add_workspace_invites.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/012_add_eval_run_filter.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/013_add_trgm_keyword_search.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/014_managed_eval_datasets.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/015_add_eval_dataset_revision.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f db/migrations/017_add_eval_hit_at_k.sql

seed:
	pnpm seed:demo

logs:
	docker logs -f $(CONTAINER)

db-shell:
	docker exec -it $(CONTAINER) psql -U $(USER) -d $(DB)

# Build services/api/Dockerfile and run the Python API in a container on
# localhost:$(API_PORT) (override when 8000 is taken: make api-docker API_PORT=8001).
# Secrets come from .env.local at run time and are never baked into the image.
# Inside the container "localhost" is the container itself, so a localhost
# DATABASE_URL is rewritten to host.docker.internal (the host machine); a remote
# URL such as Supabase passes through unchanged. The run line is silenced (@) so
# the database password is not echoed.
API_PORT ?= 8000
API_DATABASE_URL = $(subst @127.0.0.1:,@host.docker.internal:,$(subst @localhost:,@host.docker.internal:,$(DATABASE_URL)))

api-docker:
	@test -n "$(DATABASE_URL)" || { echo "DATABASE_URL is not set (looked in env and .env.local)"; exit 1; }
	docker build -t knowflow-api services/api
	@docker run --rm --name knowflow-api -p $(API_PORT):8000 --env-file .env.local -e DATABASE_URL="$(API_DATABASE_URL)" knowflow-api
