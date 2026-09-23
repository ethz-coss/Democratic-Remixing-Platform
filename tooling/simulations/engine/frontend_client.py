import requests
from dataclasses import dataclass
from typing import Any

import os

@dataclass
class FrontendApiClient:
    base_url: str

    def __post_init__(self):
        # Use env var for frontend URL if inside dev container
        env_url = os.getenv("FRONTEND_INTERNAL_URL")
        if env_url:
            self.frontend_url = env_url.rstrip("/")
        elif self.base_url.startswith("http://localhost:8090") or self.base_url.startswith("http://localhost:18090") or self.base_url.startswith("http://pocketbase:8090"):
            self.frontend_url = "http://localhost:5173"
        else:
            self.frontend_url = "http://localhost:5173"
        self.session = requests.Session()
        
        # SvelteKit CSRF protection requires Origin or Referer to match the host
        self.session.headers.update({
            "Origin": self.frontend_url,
            "Referer": f"{self.frontend_url}/"
        })

        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        # SvelteKit dev server sometimes drops connections under heavy concurrent load
        retries = Retry(total=5, backoff_factor=0.5, status_forcelist=[ 500, 502, 503, 504 ], allowed_methods=["POST", "GET", "PUT", "DELETE"])
        adapter = HTTPAdapter(max_retries=retries)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
    
    def _retry_request(self, method: str, url: str, **kwargs):
        """Thin retry wrapper for connection errors not caught by urllib3 Retry."""
        import time
        for attempt in range(3):
            try:
                return self.session.request(method, url, **kwargs)
            except Exception as e:
                if attempt < 2:
                    time.sleep(0.5 * (2 ** attempt))
                else:
                    raise

    def user_auth(self, email: str, password: str) -> None:
        resp = self._retry_request(
            "POST",
            f"{self.frontend_url}/login",
            data={"username": email, "password": password},
            allow_redirects=False,
            timeout=30
        )
        try:
            if resp.status_code not in (200, 302, 303):
                raise RuntimeError(f"Login failed: {resp.status_code} {resp.text[:100]}")
            
            if resp.status_code == 200 and '"type":"failure"' in resp.text:
                raise RuntimeError(f"Login failed: {resp.status_code} {resp.text[:100]}")
        finally:
            resp.close()

    def _post_action(self, url_path: str, data: dict[str, str], form_list: list[tuple[str, str]] = None) -> dict[str, Any]:
        url = f"{self.frontend_url}{url_path}"
        headers = {"x-sveltekit-action": "true"}
        
        resp = self._retry_request(
            "POST",
            url,
            data=form_list if form_list else data,
            headers=headers,
            timeout=60
        )

        if resp.status_code >= 400:
            raise RuntimeError(f"Action failed {url_path}: {resp.status_code} {resp.text}")
        
        try:
            result = resp.json()
            if result.get("type") == "success" and "data" in result:
                import json
                try:
                    # SvelteKit sometimes returns stringified JSON in data
                    if isinstance(result["data"], str):
                        return json.loads(result["data"])
                    elif isinstance(result["data"], list):
                        # devalue format? let's hope it's not complex. Usually action returning raw object is stringified or just object.
                        # Wait, action data in SvelteKit with devalue usually is a list: `[{"success":true,"id":"xyz"}]` or similar.
                        # Let's just return result["data"] if we can't parse it as json object easily.
                        return result["data"]
                    return result["data"]
                except Exception:
                    return result["data"]
            if result.get("type") == "redirect" or result.get("status") == 303:
                raise RuntimeError(f"Action redirected to {result.get('location')} (unauthenticated?): {result}")
            elif result.get("type") == "failure":
                raise RuntimeError(f"Action failed {url_path} (SvelteKit failure): {result.get('data')}")
            return result
        except Exception as e:
            if isinstance(e, RuntimeError):
                raise e
            return {}

    def vote(self, question_id: str, solution_id: str, vote_value: int, simulated_at: str | None = None) -> dict[str, Any]:
        data = {"proposalId": solution_id, "vote": str(vote_value)}
        if simulated_at:
            data["simulated_at"] = simulated_at
        return self._post_action(f"/questions/{question_id}/proposals?/vote", data)

    def create_solution(self, question_id: str, title: str, content: str, reason: str = "", parent_ids: list[str] = None, simulated_at: str | None = None, label: str | None = None) -> dict[str, Any]:
        form_list = [
            ("title", title),
            ("content", content),
            ("reason_for_change", reason),
        ]
        if label:
            form_list.append(("label", label))
        if parent_ids:
            for pid in parent_ids:
                form_list.append(("parent_ids", pid))
        if simulated_at:
            form_list.append(("simulated_at", simulated_at))
            
        return self._post_action(f"/questions/{question_id}/proposals/editor", None, form_list)


    def vote_question(self, question_id: str, vote_value: int, simulated_at: str | None = None) -> dict[str, Any]:
        data = {"vote": str(vote_value)}
        if simulated_at:
            data["simulated_at"] = simulated_at
        return self._post_action(f"/questions/{question_id}?/vote", data)

    def log_action(self, question_id: str, action_type: str, target_id: str = "", metadata_json: Any = None, simulated_at: str | None = None) -> dict[str, Any]:
        url = f"{self.frontend_url}/api/action-logs"
        data = {
            "question": question_id,
            "action_type": action_type,
            "target_id": target_id,
            "metadata_json": metadata_json
        }
        if simulated_at:
            data["occurred_at"] = simulated_at
            
        resp = self._retry_request("POST", url, json=data, timeout=30)
        if resp.status_code >= 400:
            if resp.status_code != 404:  # Suppress 404s caused by production NGINX reverse proxy routing /api/ away from frontend
                print(f"Failed to log action: {resp.text}")
            return {}
        try:
            return resp.json()
        except:
            return {}

    def get_feed(self, question_id: str, mode: str = "PersonalFocus", opts: dict = None) -> list[str]:
        """
        Fetches the sorted feed of proposals using the frontend's recommendation engine.
        Returns a list of proposal IDs sorted according to the mode and options.
        """
        url = f"{self.frontend_url}/api/questions/{question_id}/feed"
        data = {
            "mode": mode,
            "opts": opts or {}
        }
        resp = self._retry_request("POST", url, json=data, timeout=30)
        if resp.status_code >= 400:
            print(f"Failed to fetch feed: {resp.status_code} {resp.text}")
            return []
        
        try:
            result = resp.json()
            return result.get("proposalIds", [])
        except Exception as e:
            print(f"Error parsing feed response: {e}")
            return []
