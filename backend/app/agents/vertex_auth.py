"""Shared ADC token helper for calling Vertex AI directly over REST.

Used by matcher_agent.py (embeddings) and orchestrator.py (function-calling
generation) — both need a project-billed Vertex call, not the free per-API-key
generativelanguage.googleapis.com path.
"""
import google.auth
import google.auth.transport.requests as ga_requests

_credentials = None
_auth_request = None


def get_vertex_access_token() -> str:
    """Cache+refresh an ADC token (Cloud Run's default service account in prod)."""
    global _credentials, _auth_request
    if _credentials is None:
        _credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        _auth_request = ga_requests.Request()
    if not _credentials.valid:
        _credentials.refresh(_auth_request)
    return _credentials.token
