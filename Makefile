.PHONY: up down build logs clean prune test scan

# Default target
help:
	@echo "Available commands:"
	@echo "  make up      - Start the entire stack in the background"
	@echo "  make down    - Stop and remove all containers"
	@echo "  make build   - Rebuild all containers"
	@echo "  make logs    - Tail logs for all containers"
	@echo "  make clean   - Remove all containers, volumes, and networks"
	@echo "  make prune   - Remove unused Docker resources"
	@echo "  make scan    - Scan the images with Trivy (requires Trivy installed locally)"

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

clean:
	docker compose down -v --remove-orphans

prune:
	docker system prune -f

scan:
	trivy image foodbridge-frontend
	trivy image foodbridge-backend
