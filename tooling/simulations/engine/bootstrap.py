from __future__ import annotations
from typing import Any
import random
import json
import re
import html
import sys

from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.simulations.engine.models import SimUser


class SimulationBootstrap:
    def __init__(
        self,
        pb: PocketBaseClient,
        run_id: str,
        agent_count: int,
        user_password: str,
        question_title_prefix: str = "",
        question_title_suffix: str = "",
        group_config: dict[str, Any] | None = None,
    ):
        self.pb = pb
        self.run_id = run_id
        self.agent_count = agent_count
        self.user_password = user_password
        self.question_title_prefix = question_title_prefix
        self.question_title_suffix = question_title_suffix
        self.group_config = group_config
        self.sim_group_id: str | None = None

    def bootstrap_simulation_context(self, question_config: dict[str, Any] | None) -> dict[str, Any]:
        if question_config is None:
            raise ValueError(
                "No question_config provided and no question_id set. "
                "Pass a question config via --config (with a 'question' key) "
                "or attach to an existing question via --question-id."
            )
        return {"question": question_config, "agents": []}

    def _slugify(self, text: str) -> str:
        chars = [ch.lower() if ch.isalnum() else "_" for ch in text]
        raw = "".join(chars)
        while "__" in raw:
            raw = raw.replace("__", "_")
        return raw.strip("_")

    def create_users(self) -> list[SimUser]:
        from tooling.simulations.engine.frontend_client import FrontendApiClient
        users = []
        for i in range(1, self.agent_count + 1):
            display_name = f"Participant {i}"
            handle = f"agent{i:02d}"
            username = f"{handle}_sim_{i:02d}"
            email = f"{username}@sim.local"
            
            # Check if user already exists
            existing_users = self.pb.list_records("users", filter_expr=f'email="{email}"')
            if existing_users:
                user = existing_users[0]
            else:
                payload = {
                    "username": username,
                    "email": email,
                    "password": self.user_password,
                    "passwordConfirm": self.user_password,
                    "name": display_name,
                    "simulation": True,
                    "role": "admin" if i == 1 else "participant",
                }
                try:
                    user = self.pb.create_record("users", payload)
                except PocketBaseError as e:
                    if "validation_not_unique" in str(e):
                        existing_users = self.pb.list_records("users", filter_expr=f'email="{email}"')
                        if existing_users:
                            user = existing_users[0]
                            # Update password so the new password works
                            self.pb.update_record("users", user["id"], {
                                "password": self.user_password,
                                "passwordConfirm": self.user_password
                            })
                        else:
                            raise
                    else:
                        raise
            
            try:
                token = self.pb.user_auth(email, self.user_password)
            except Exception as e:
                print(f"[bootstrap] Warning: Failed to auth user {email} via PB directly: {e}", file=sys.stderr)
                token = None

            fc = FrontendApiClient(self.pb.base_url)
            if token:
                import urllib.parse
                import json
                cookie_val = urllib.parse.quote(json.dumps({
                    "token": token,
                    "record": user
                }))
                fc.session.cookies.set("pb_auth", cookie_val)

            users.append(
                SimUser(
                    id=user["id"],
                    username=username,
                    display_name=display_name,
                    email=email,
                    password=self.user_password,
                    token=token,
                    frontend_client=fc
                )
            )

            
        # Ensure the group exists
        if not self.sim_group_id:
            gc = self.group_config or {}
            group_name = gc.get("name") or "Global Simulation Group"
            group_desc = gc.get("description") or "Global group for all simulated questions"
            groups = self.pb.list_records("groups", filter_expr=f'name="{group_name}"')
            if groups:
                group = groups[0]
                self.sim_group_id = group["id"]
            else:
                author = users[0]
                import string
                import random
                invite_token = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
                group = self.pb.create_record("groups", {
                    "name": group_name,
                    "author": author.id,
                    "description": group_desc,
                    "visibility": "Public",
                    "invite_token": invite_token
                }, token=author.token)
                self.sim_group_id = group["id"]
            
        # Ensure all users are in the group
        existing_members_raw = self.pb.get_full_list("group_members", filter_expr=f'group="{self.sim_group_id}"')
        existing_member_user_ids = {m["user"] for m in existing_members_raw}
        
        for u in users:
            if u.id not in existing_member_user_ids:
                retry_count = 5
                for attempt in range(retry_count):
                    try:
                        self.pb.create_record("group_members", {
                            "group": self.sim_group_id,
                            "user": u.id,
                            "role": "Admin" if u.id == users[0].id else "Member"
                        })
                        break
                    except PocketBaseError as e:
                        err_str = str(e)
                        if "validation_not_unique" in err_str:
                            break  # Already exists, fine
                        elif "database is locked" in err_str and attempt < retry_count - 1:
                            import time
                            time.sleep(0.5 * (2 ** attempt))
                        else:
                            # We can't silently ignore other errors like locked DB giving up
                            print(f"[create_users] Failed to add {u.username} to group: {err_str}", file=sys.stderr)
                            break
        
        return users


    def _as_html(self, text: str) -> str:
        raw = (text or "").strip()
        if not raw:
            return "<p></p>"
        if re.search(r"<\s*(p|ul|ol|li|h1|h2|h3|h4|blockquote|strong|em)\b", raw, flags=re.IGNORECASE):
            return raw

        lines = [ln.strip() for ln in raw.replace("\r", "").split("\n") if ln.strip()]
        if not lines:
            return f"<p>{html.escape(raw, quote=False)}</p>"

        blocks: list[str] = []
        list_items: list[str] = []

        def flush_list() -> None:
            nonlocal list_items
            if list_items:
                blocks.append("<ul>" + "".join(f"<li>{item}</li>" for item in list_items) + "</ul>")
                list_items = []

        for line in lines:
            if line.startswith("- "):
                list_items.append(html.escape(line[2:].strip(), quote=False))
            else:
                flush_list()
                blocks.append(f"<p>{html.escape(line, quote=False)}</p>")
        flush_list()
        return "".join(blocks)

    def create_question(self, users: list[SimUser], question_context: dict[str, Any], behavior_profile: Any, simulated_now_pb_iso: str) -> str:
        author = users[0]
        ctx = question_context or {}
        title = str(ctx.get("title", "")).strip() or f"Simulation Question {self.run_id}"
        if self.question_title_prefix:
            title = f"{self.question_title_prefix}{title}"
        if self.question_title_suffix:
            title = f"{title} {self.question_title_suffix}"
        description = str(ctx.get("description", "")).strip() or "Find a converged solution with minimal tradeoffs."
        raw_constraints = ctx.get("constraints", [])
        # Normalise to list of strings
        constraints = [c.get("description") if isinstance(c, dict) else str(c) for c in raw_constraints]
        description_html = self._as_html(description)

        algorithm_config = {}
        if getattr(behavior_profile, "ballot_config", None) is not None:
            algorithm_config["ballot"] = behavior_profile.ballot_config

        payload = {
            "title": title[:120],
            "description": description_html[:4000],
            "constraints": constraints,
            "author": author.id,
            "group": self.sim_group_id,
            "visibility": "Group" if self.sim_group_id else "Public",
            "current_phase_name": "Proposed",
            "algorithm_config": json.dumps(algorithm_config) if algorithm_config else "{}",
        }

        question = self.pb.create_record("questions", payload)
        question_id = question["id"]

        # Skip Proposed phase entirely — force directly to AnswerSearch
        old_phase_id = str(question.get("current_phase", "")).strip()
        if old_phase_id:
            try:
                self.pb.update_record(
                    "question_phases", old_phase_id,
                    {"ended_at": simulated_now_pb_iso},
                )
            except PocketBaseError:
                pass

        new_phase = self.pb.create_record(
            "question_phases",
            {
                "question": question_id,
                "phase_name": "AnswerSearch",
                "started_at": simulated_now_pb_iso,
                "ended_at": "",
                "previous_phase": old_phase_id or None,
                "transition_type": "simulation_skip_proposed",
            },
        )
        self.pb.update_record(
            "questions", question_id,
            {"current_phase": new_phase["id"], "current_phase_name": "AnswerSearch"},
        )
        return question_id
