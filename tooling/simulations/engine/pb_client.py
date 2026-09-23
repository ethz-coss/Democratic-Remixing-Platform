from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import requests


class PocketBaseError(RuntimeError):
    pass


@dataclass
class PocketBaseClient:
    base_url: str

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        self._admin_token: str | None = None

    def admin_auth(self, email: str, password: str) -> None:
        payload = {"identity": email, "password": password}
        data: dict[str, Any] | None = None
        errors: list[str] = []
        for path in (
            "/api/admins/auth-with-password",
            "/api/collections/_superusers/auth-with-password",
        ):
            try:
                data = self._request("POST", path, json=payload)
                break
            except PocketBaseError as err:
                errors.append(str(err))

        if data is None:
            raise PocketBaseError("; ".join(errors))

        token = data.get("token")
        if not token:
            raise PocketBaseError("Admin auth succeeded without token")
        self._admin_token = token

    def user_auth(self, email: str, password: str) -> str:
        payload = {"identity": email, "password": password}
        data = self._request("POST", "/api/collections/users/auth-with-password", json=payload)
        token = data.get("token")
        if not token:
            raise PocketBaseError("User auth succeeded without token")
        return token

    def create_record(self, collection: str, body: dict[str, Any], token: str | None = None) -> dict[str, Any]:
        return self._request("POST", f"/api/collections/{collection}/records", json=body, token=token)

    def update_record(self, collection: str, record_id: str, body: dict[str, Any], token: str | None = None) -> dict[str, Any]:
        return self._request("PATCH", f"/api/collections/{collection}/records/{record_id}", json=body, token=token)

    def list_records(
        self,
        collection: str,
        *,
        filter_expr: str | None = None,
        sort: str | None = None,
        per_page: int = 200,
        page: int = 1,
        token: str | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"page": page, "perPage": per_page}
        if filter_expr:
            params["filter"] = filter_expr
        if sort:
            params["sort"] = sort
        data = self._request("GET", f"/api/collections/{collection}/records", params=params, token=token)
        return data.get("items", [])

    def get_full_list(
        self,
        collection: str,
        *,
        filter_expr: str | None = None,
        sort: str | None = None,
        batch_size: int = 500,
        token: str | None = None,
    ) -> list[dict[str, Any]]:
        page = 1
        all_items = []
        while True:
            params: dict[str, Any] = {"page": page, "perPage": batch_size}
            if filter_expr:
                params["filter"] = filter_expr
            if sort:
                params["sort"] = sort
            data = self._request("GET", f"/api/collections/{collection}/records", params=params, token=token)
            items = data.get("items", [])
            all_items.extend(items)
            if len(items) < batch_size or data.get("totalPages", 1) <= page:
                break
            page += 1
        return all_items

    def get_record(self, collection: str, record_id: str, token: str | None = None) -> dict[str, Any]:
        return self._request("GET", f"/api/collections/{collection}/records/{record_id}", token=token)

    def delete_record(self, collection: str, record_id: str, token: str | None = None) -> None:
        self._request("DELETE", f"/api/collections/{collection}/records/{record_id}", token=token)

    def request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        token: str | None = None,
    ) -> dict[str, Any]:
        """Public wrapper for calling arbitrary PocketBase API endpoints."""
        return self._request(method, path, json=json, params=params, token=token)

    def _request(
        self, method: str, path: str, json: dict[str, Any] | None = None, params: dict[str, str] | None = None, token: str | None = None
    ) -> Any:
        url = f"{self.base_url}{path}"
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        elif self._admin_token:
            headers["Authorization"] = f"Bearer {self._admin_token}"

        import time
        max_retries = 5
        for attempt in range(max_retries):
            try:
                resp = requests.request(method, url, headers=headers, json=json, params=params, timeout=60)
                if 200 <= resp.status_code < 300:
                    return resp.json() if resp.content else {}
                elif resp.status_code in [502, 503, 504] and attempt < max_retries - 1:
                    print(f"Server error {resp.status_code} on {method} {url}, retrying...")
                    time.sleep(2 ** attempt)
                    continue
                else:
                    raise PocketBaseError(f"{method} {path} failed [{resp.status_code}]: {resp.text}")
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                if attempt < max_retries - 1:
                    print(f"Network error {e} on {method} {url}, retrying...")
                    time.sleep(2 ** attempt)
                else:
                    raise PocketBaseError(f"{method} {path} failed due to network error: {e}")


