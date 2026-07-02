# packages/ai-workflow

Reserved for future AI workflow and agent orchestration definitions.

This boundary must not be collapsed into `apps/web` or `apps/api`. Group A does not implement agents or real LLM runtime behavior.

Phase 3 boundary: this package carries the versioned prompt templates (`prompts/`) plus the agent I/O contract (no runtime); the agent runtime that loads and executes them lives in `apps/api`.
