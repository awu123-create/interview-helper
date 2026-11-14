.PHONY: all format format-check typecheck lint test secrets layers verify setup-hooks

all: verify

format:
	npm run format

format-check:
	npm run format:check

typecheck:
	npm run typecheck

lint:
	npm run lint

test:
	npm test

secrets:
	npm run secrets

layers:
	npm run layers

verify:
	npm run verify:offline

setup-hooks:
	pre-commit install --install-hooks
