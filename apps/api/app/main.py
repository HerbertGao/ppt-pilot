"""Phase 1 FastAPI shell.

Only the health endpoint is implemented here. Business APIs for project
lifecycle, requirement discovery, outline planning, slide planning, preview,
export, and workflow state transitions are intentionally out of scope.
"""

from fastapi import FastAPI

app = FastAPI(
    title="PPTPilot API",
    summary="Phase 1 FastAPI shell for PPTPilot.",
    version="0.1.0",
)


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    """Return API shell health without touching business state."""

    return {
        "status": "ok",
        "service": "ppt-pilot-api",
        "phase": "phase-1-foundation",
    }


def run() -> None:
    """Run the API shell with a clear Python entrypoint."""

    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    run()
