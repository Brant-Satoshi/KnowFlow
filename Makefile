.PHONY: db-reset db-init migrate seed logs

CONTAINER=ai-rag-postgres
DB=airag
USER=postgres

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

seed:
	docker exec -i $(CONTAINER) \
		psql -U $(USER) -d $(DB) \
		< db/seeds/seed.sql

logs:
	docker logs -f $(CONTAINER)

db-shell:
	docker exec -it $(CONTAINER) psql -U $(USER) -d $(DB)