"""LLM-driven content generation for the three solution types.

Each generator method has a dedicated prompt template tailored to the
platform's remix semantics.  Every method falls back to deterministic
output when the LLM is disabled or when the API call fails.
"""

from __future__ import annotations

import html
import json
import random
import re
from dataclasses import dataclass
from typing import Any

from tooling.simulations.engine.agents.agent_memory import AgentMemory
from tooling.simulations.engine.llm_client import LLMClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _strip_html(raw: str) -> str:
    return re.sub(r"<[^>]+>", " ", raw or "")


def _as_html(text: str) -> str:
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


def _excerpt(content: str, max_len: int = 600) -> str:
    return _strip_html(content)[:max_len].strip()


# ---------------------------------------------------------------------------
# Content Generator
# ---------------------------------------------------------------------------

@dataclass
class ContentGenerator:
    """Generates solution content via LLM with per-type prompt templates."""

    llm: LLMClient
    question_context: dict[str, Any]
    rng: random.Random
    language: str = "de"  # "de" or "en"

    # Maximum content length (characters) for generated solutions.
    max_content_len: int = 2400

    def _lang_instruction(self) -> str:
        """Return a language instruction snippet for LLM system prompts."""
        if self.language == "de":
            return "IMPORTANT: Write ALL content in German (Deutsch). "
        return "Write all content in English. "

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def generate_root_solution(
        self,
        agent_memory: AgentMemory,
    ) -> dict[str, str]:
        """Generate a new root solution (no parents).

        Returns ``{title, content}`` with HTML content.
        """
        question = self.question_context or {}
        fallback = self._fallback_root(agent_memory)

        result = self.llm.chat_json(
            system=(
                f"You are an active participant in this community. "
                f"{self._lang_instruction()}"
                "You are proposing an original solution to the question below. "
                "Return strict JSON with keys: title, content, label. "
                "content must be HTML suitable for a WYSIWYG editor "
                "(<p>, <ul>, <li>, <strong>; no markdown, no LaTeX, no code blocks). "
                "label should be a short 1-4 word cluster name for this idea. "
                "Default to a shortened version of your title, but you may adjust it "
                "to a broader category if appropriate (max 30 chars). "
                "Write as a clear, non-technical proposal a normal person would write. "
                "Use everyday language. Structure as: here's my idea, how it works in practice, "
                "why it's fair, and a quick example with real numbers. "
                ""
            ),
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Question: {question.get('title', 'Untitled')}\n"
                        f"Description: {question.get('description', '')}\n"
                        f"Constraints: {json.dumps(question.get('constraints', []))}\n\n"
                        f"Your background: {agent_memory.summary_for_llm()}\n\n"
                        "Write a new, original solution. Do not repeat solutions "
                        "you have already authored."
                    ),
                }
            ],
            fallback=fallback,
            max_tokens=400,
        )

        return {
            "title": str(result.get("title", fallback["title"])).strip()[:120],
            "content": _as_html(str(result.get("content", fallback["content"])).strip())[
                : self.max_content_len
            ],
            "label": str(result.get("label", result.get("title", "General"))).strip()[:30],
        }

    def generate_remix(
        self,
        parent_title: str,
        parent_content: str,
        agent_memory: AgentMemory,
        recent_comments: list[str] | None = None,
    ) -> dict[str, str]:
        """Generate a remix (iteration) of an existing solution.

        Returns ``{content, change_rationale}`` with HTML content.
        The title is inherited from the parent (platform convention).
        """
        question = self.question_context or {}
        comments_ctx = ""
        if recent_comments:
            numbered = [f"  {i + 1}. {c}" for i, c in enumerate(recent_comments[:5])]
            comments_ctx = "Recent comments on this solution:\n" + "\n".join(numbered)

        fallback = self._fallback_remix(parent_content)

        result = self.llm.chat_json(
            system=(
                f"You are an active participant in this community. "
                f"{self._lang_instruction()}"
                "You are creating an improved version (remix) of an existing solution. "
                "Return strict JSON with keys: content, change_rationale. "
                "content must be HTML (<p>, <ul>, <li>, <strong>; no markdown). "
                "The output should be a COMPLETE standalone solution — not a diff "
                "or a list of changes. Reproduce the parent's structure but make "
                "1-3 specific, meaningful improvements, "
                "the constraints, and the recent comments. "
                "Write naturally, as if explaining to a flatmate. "
                "change_rationale: max 100 characters, plain text summary of what you changed."
            ),
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Question: {question.get('title', 'Untitled')}\n"
                        f"Constraints: {json.dumps(question.get('constraints', []))}\n\n"
                        f"Parent solution: \"{parent_title}\"\n"
                        f"Parent content:\n{_excerpt(parent_content, 600)}\n\n"
                        f"{comments_ctx}\n\n"
                        f"Your background: {agent_memory.summary_for_llm()}\n\n"
                        "Produce your improved version of this solution."
                    ),
                }
            ],
            fallback=fallback,
            max_tokens=350,
        )

        return {
            "content": _as_html(str(result.get("content", fallback["content"])).strip())[
                : self.max_content_len
            ],
            "change_rationale": str(
                result.get("change_rationale", fallback.get("change_rationale", "Simplified the monthly process."))
            ).strip()[:100],
        }

    def generate_merge(
        self,
        parent_a_title: str,
        parent_a_content: str,
        parent_b_title: str,
        parent_b_content: str,
        agent_memory: AgentMemory,
    ) -> dict[str, str]:
        """Generate a merge proposal synthesizing two solutions.

        *parent_a* is the **base parent** (content starting point).
        Returns ``{title, content, merge_rationale}`` with HTML content.
        """
        question = self.question_context or {}
        fallback = self._fallback_merge(parent_a_title, parent_a_content, parent_b_title)

        result = self.llm.chat_json(
            system=(
                f"You are an active participant in this community. "
                f"{self._lang_instruction()}"
                "You are proposing a merge that synthesizes two competing approaches "
                "into one coherent solution. "
                "Return strict JSON with keys: title, content, merge_rationale. "
                "content must be HTML (<p>, <ul>, <li>, <strong>; no markdown). "
                "Optionally include a 'label' key (1-4 words, max 30 chars) if the merged "
                "idea represents a meaningfully new approach that deserves its own cluster. "
                "Omit the label key if the merge is just a refinement of the parents. "
                "Start from Solution A's structure (it is the base), then integrate "
                "the strongest elements from Solution B. Resolve any tensions. "
                "The result must be a coherent standalone proposal, written naturally. "
                "Give it a NEW title that reflects the synthesis — don't use 'Merged: X + Y'. "
                "merge_rationale: 1-2 sentences explaining how you bridged the two."
            ),
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Question: {question.get('title', 'Untitled')}\n"
                        f"Constraints: {json.dumps(question.get('constraints', []))}\n\n"
                        f"Solution A (base): \"{parent_a_title}\"\n"
                        f"Content A:\n{_excerpt(parent_a_content, 500)}\n\n"
                        f"Solution B (secondary): \"{parent_b_title}\"\n"
                        f"Content B:\n{_excerpt(parent_b_content, 500)}\n\n"
                        f"Your background: {agent_memory.summary_for_llm()}\n\n"
                        "Produce a merged solution that combines the best of both."
                    ),
                }
            ],
            fallback=fallback,
            max_tokens=400,
        )

        return {
            "title": str(result.get("title", fallback["title"])).strip()[:120],
            "content": _as_html(str(result.get("content", fallback["content"])).strip())[
                : self.max_content_len
            ],
            "merge_rationale": str(
                result.get("merge_rationale", fallback.get("merge_rationale", "Combined both approaches."))
            ).strip()[:300],
            "label": str(result.get("label", "")).strip()[:30] or None,
        }

    # ------------------------------------------------------------------ #
    # Deterministic fallbacks
    # ------------------------------------------------------------------ #

    def _fallback_root(self, memory: AgentMemory) -> dict[str, str]:
        if self.language == "de":
            methods = self._FALLBACK_ROOTS_DE
            persona_hash = hash(memory.user_id) % len(methods)
            picked = methods[persona_hash]
            return {"title": picked["title"][:120], "content": picked["body"], "label": picked["title"][:30]}

        methods = [
            {
                "title": "Fair Share by Usage Levels",
                "body": (
                    "<p>For each shared item, each person rates their usage as "
                    "<strong>none</strong>, <strong>light</strong>, <strong>medium</strong>, "
                    "or <strong>heavy</strong>. We divide each item's cost proportionally.</p>"
                    "<ul><li>Internet: Anna uses heavily, Ben lightly, Clara not at all → Anna pays more</li>"
                    "<li>We update levels once a month at a quick flat meeting</li></ul>"
                    "<p>Nobody pays for things they don't use, and equal use means equal pay.</p>"
                ),
            },
            {
                "title": "Base Fee Plus Usage Top-Up",
                "body": (
                    "<p>Split costs into two parts: a small <strong>base fee</strong> everyone "
                    "pays equally, and a <strong>usage top-up</strong> based on actual consumption.</p>"
                    "<ul><li>Base fee covers the 'we all live here' share</li>"
                    "<li>Remaining amount divided by usage</li></ul>"
                    "<p>Fair while recognizing that living together has a shared baseline cost.</p>"
                ),
            },
            {
                "title": "Monthly Flat Meeting Cost Review",
                "body": (
                    "<p>At the start of each month, we sit down for 15 minutes and go through "
                    "each shared expense together. For each item, we agree who used it and how much.</p>"
                    "<ul><li>If there's disagreement, we split that item equally</li>"
                    "<li>Everyone sees and agrees to every number</li></ul>"
                    "<p>The key is transparency: no complicated math, just honest conversation.</p>"
                ),
            },
            {
                "title": "App-Based Category Tracking",
                "body": (
                    "<p>We set up a shared spreadsheet or app where each person logs their "
                    "usage of shared items weekly. Categories: internet, cleaning, entertainment, "
                    "kitchen, electricity.</p>"
                    "<ul><li>Each category has its own splitting rule</li>"
                    "<li>App calculates monthly totals automatically</li></ul>"
                    "<p>Transparent, low-effort after initial setup, and auditable.</p>"
                ),
            },
            {
                "title": "Rotating Responsibility Model",
                "body": (
                    "<p>Each flatmate takes charge of one cost category for a month. "
                    "They buy what's needed and split the receipt equally among users.</p>"
                    "<ul><li>Rotates monthly so everyone shares the admin burden</li>"
                    "<li>Non-users simply opt out of that category</li></ul>"
                    "<p>Spreads responsibility and avoids one person being the permanent accountant.</p>"
                ),
            },
            {
                "title": "Presence-Weighted Cost Sharing",
                "body": (
                    "<p>Track how many days each person is actually at home per month. "
                    "Shared costs are weighted by presence: if you're away half the month, "
                    "you pay roughly half.</p>"
                    "<ul><li>Simple check-in/check-out on a shared calendar</li>"
                    "<li>Fair for people who travel frequently</li></ul>"
                    "<p>Usage correlates with presence, so this is a good proxy for fairness.</p>"
                ),
            },
            {
                "title": "Capped Maximum Per Person",
                "body": (
                    "<p>Set a maximum monthly contribution per person. Start by dividing "
                    "total costs equally, but cap anyone's share at an agreed maximum.</p>"
                    "<ul><li>Heavy users don't pay more than the cap</li>"
                    "<li>Remaining cost spread among others proportionally</li></ul>"
                    "<p>Protects everyone from unexpectedly high bills.</p>"
                ),
            },
            {
                "title": "Solidarity Fund Approach",
                "body": (
                    "<p>Everyone pays the same flat contribution into a shared fund each month. "
                    "The fund covers all common expenses. Any surplus rolls over.</p>"
                    "<ul><li>No tracking of individual usage needed</li>"
                    "<li>Simple, quick, zero administrative overhead</li></ul>"
                    "<p>Works best when usage is roughly equal. Trades precision for simplicity.</p>"
                ),
            },
            {
                "title": "Democratic Item-by-Item Voting",
                "body": (
                    "<p>For each shared expense, we vote on the splitting method: equal, "
                    "proportional, or opt-in only. Each item gets its own rule.</p>"
                    "<ul><li>Netflix: opt-in only (non-watchers don't pay)</li>"
                    "<li>Internet: equal split (everyone benefits)</li>"
                    "<li>Cleaning: proportional to room size or mess contribution</li></ul>"
                    "<p>Flexible and democratic, though it requires one initial discussion.</p>"
                ),
            },
            {
                "title": "Tiered Subscription Model",
                "body": (
                    "<p>Define three tiers: <strong>Basic</strong> (minimal usage), "
                    "<strong>Standard</strong> (average), and <strong>Premium</strong> "
                    "(heavy usage). Each person picks their tier per category.</p>"
                    "<ul><li>Predefined price ratios (e.g. 1:2:3)</li>"
                    "<li>Tier choice is voluntary and honest</li></ul>"
                    "<p>Less tracking than per-item measurement, but fairer than equal split.</p>"
                ),
            },
            {
                "title": "Usage Diary with Peer Review",
                "body": (
                    "<p>Each person keeps a brief weekly usage diary for shared resources. "
                    "At month end, diaries are shared and any obvious inconsistencies "
                    "get discussed together.</p>"
                    "<ul><li>Self-reported but socially validated</li>"
                    "<li>Builds awareness of consumption habits</li></ul>"
                    "<p>Encourages honesty through transparency, not surveillance.</p>"
                ),
            },
            {
                "title": "Income-Adjusted Percentage",
                "body": (
                    "<p>Each flatmate contributes a fixed percentage of their monthly income "
                    "to common costs. Higher earners pay more in absolute terms, but the "
                    "percentage burden is the same for everyone.</p>"
                    "<ul><li>Fair for mixed-income households</li>"
                    "<li>Percentages can be agreed anonymously via a trusted formula</li></ul>"
                    "<p>Addresses ability-to-pay, not just usage.</p>"
                ),
            },
            {
                "title": "Hybrid: Big Items Proportional, Small Equal",
                "body": (
                    "<p>For big recurring costs (internet, electricity), split proportionally "
                    "by measured or estimated usage. For small items (cleaning supplies, spices), "
                    "just split equally.</p>"
                    "<ul><li>Proportional tracking only where it matters financially</li>"
                    "<li>Small items aren't worth the tracking effort</li></ul>"
                    "<p>Pragmatic balance between fairness and effort.</p>"
                ),
            },
            {
                "title": "Trial Month with Adjustment Clause",
                "body": (
                    "<p>Start with a simple equal split for one month. At the end, everyone "
                    "reports whether they felt the split was fair. If not, we adjust specific "
                    "items for the next month.</p>"
                    "<ul><li>Learn by doing rather than over-planning</li>"
                    "<li>Monthly retrospective to fine-tune the system</li></ul>"
                    "<p>Iterative: we'll converge on something fair within 2-3 months.</p>"
                ),
            },
            {
                "title": "Points-Based Contribution System",
                "body": (
                    "<p>Assign point values to shared items based on cost. Each flatmate "
                    "earns points by contributing (buying supplies, cleaning, maintenance) "
                    "and spends points by consuming shared resources.</p>"
                    "<ul><li>Non-monetary contributions count (e.g., DIY repairs)</li>"
                    "<li>Monthly settlement of point balances</li></ul>"
                    "<p>Recognizes that contribution isn't only about money.</p>"
                ),
            },
            {
                "title": "Smart Meter Sharing Formula",
                "body": (
                    "<p>For electricity, use individual smart plugs or sub-meters in each room. "
                    "For other items, use a simple shared log. Total cost is split using "
                    "measured data where available, estimates where not.</p>"
                    "<ul><li>Data-driven for the biggest costs</li>"
                    "<li>Low-tech estimates for smaller items</li></ul>"
                    "<p>Objective measurement removes arguments about who uses what.</p>"
                ),
            },
            {
                "title": "Expense Pool with Opt-Out Rights",
                "body": (
                    "<p>All shared costs go into one pool, divided equally by default. "
                    "But anyone can opt out of specific items they genuinely don't use. "
                    "Opted-out items are re-divided among remaining users.</p>"
                    "<ul><li>Default is equal (simple), exceptions are explicit</li>"
                    "<li>Opt-out requires brief justification</li></ul>"
                    "<p>Minimal tracking with a fairness valve for non-users.</p>"
                ),
            },
            {
                "title": "Weekly Micro-Settlements",
                "body": (
                    "<p>Instead of a big monthly reckoning, settle shared costs weekly. "
                    "Each week, one person tallies the receipts and splits them via "
                    "a payment app. Quick, small amounts, fewer surprises.</p>"
                    "<ul><li>Reduces the cognitive load of tracking a whole month</li>"
                    "<li>Disputes are caught early when memory is fresh</li></ul>"
                    "<p>Frequent small settlements prevent big arguments later.</p>"
                ),
            },
        ]
        # Persona-based selection: different personas tend toward different proposals
        persona_hash = hash(memory.user_id) % len(methods)
        picked = methods[persona_hash]
        return {"title": picked["title"][:120], "content": picked["body"], "label": picked["title"][:30]}

    _FALLBACK_ROOTS_DE = [
        {
            "title": "Fairer Anteil nach Nutzungsstufen",
            "body": (
                "<p>Für jeden gemeinsamen Posten schätzt jede Person ihre Nutzung als "
                "<strong>keine</strong>, <strong>gering</strong>, <strong>mittel</strong> "
                "oder <strong>hoch</strong> ein. Die Kosten werden proportional aufgeteilt.</p>"
                "<ul><li>Internet: Anna nutzt es viel, Ben wenig, Clara gar nicht → Anna zahlt mehr</li>"
                "<li>Wir aktualisieren die Stufen einmal im Monat bei einem kurzen WG-Treffen</li></ul>"
                "<p>Niemand zahlt für Dinge, die er oder sie nicht nutzt, und gleiche Nutzung bedeutet gleicher Anteil.</p>"
            ),
        },
        {
            "title": "Grundgebühr plus Nutzungszuschlag",
            "body": (
                "<p>Kosten werden in zwei Teile aufgeteilt: eine kleine <strong>Grundgebühr</strong>, "
                "die alle gleichmässig zahlen, und einen <strong>Nutzungszuschlag</strong> basierend auf "
                "tatsächlichem Verbrauch.</p>"
                "<ul><li>Die Grundgebühr deckt den Anteil ‹Wir wohnen alle hier›</li>"
                "<li>Der restliche Betrag wird nach Nutzung aufgeteilt</li></ul>"
                "<p>Fair, und gleichzeitig wird anerkannt, dass Zusammenleben eine gemeinsame Basiskostenlast hat.</p>"
            ),
        },
        {
            "title": "Monatliches WG-Kostenmeeting",
            "body": (
                "<p>Am Anfang jedes Monats setzen wir uns 15 Minuten zusammen und gehen "
                "jede gemeinsame Ausgabe durch. Für jeden Posten einigen wir uns, wer ihn wie stark genutzt hat.</p>"
                "<ul><li>Bei Uneinigkeit wird der Posten gleichmässig aufgeteilt</li>"
                "<li>Alle sehen und akzeptieren jede Zahl</li></ul>"
                "<p>Der Schlüssel ist Transparenz: keine komplizierte Mathematik, nur ehrliches Gespräch.</p>"
            ),
        },
        {
            "title": "App-basierte Kategorien-Erfassung",
            "body": (
                "<p>Wir richten eine gemeinsame Tabelle oder App ein, in der jede Person "
                "wöchentlich ihre Nutzung gemeinsamer Dinge erfasst. Kategorien: Internet, Putzmittel, "
                "Unterhaltung, Küche, Strom.</p>"
                "<ul><li>Jede Kategorie hat ihre eigene Aufteilungsregel</li>"
                "<li>Die App berechnet monatliche Gesamtbeträge automatisch</li></ul>"
                "<p>Transparent, nach der Ersteinrichtung wenig Aufwand und jederzeit überprüfbar.</p>"
            ),
        },
        {
            "title": "Rotierendes Verantwortungsmodell",
            "body": (
                "<p>Jede:r Mitbewohner:in übernimmt für einen Monat die Verantwortung für eine Kostenkategorie. "
                "Er oder sie kauft das Nötige und teilt den Beleg gleichmässig unter den Nutzern:innen auf.</p>"
                "<ul><li>Monatliche Rotation, damit alle den Verwaltungsaufwand teilen</li>"
                "<li>Nicht-Nutzer:innen melden sich einfach von dieser Kategorie ab</li></ul>"
                "<p>Verteilt die Verantwortung und verhindert, dass eine Person dauerhaft Buchhalter:in ist.</p>"
            ),
        },
        {
            "title": "Anwesenheitsgewichtete Kostenteilung",
            "body": (
                "<p>Wir erfassen, wie viele Tage jede Person tatsächlich pro Monat zu Hause ist. "
                "Gemeinsame Kosten werden nach Anwesenheit gewichtet: wer den halben Monat weg ist, "
                "zahlt ungefähr die Hälfte.</p>"
                "<ul><li>Einfaches Ein-/Auschecken über einen gemeinsamen Kalender</li>"
                "<li>Fair für Leute, die oft reisen</li></ul>"
                "<p>Nutzung korreliert mit Anwesenheit – ein guter Näherungswert für Fairness.</p>"
            ),
        },
        {
            "title": "Gedeckelter Maximalbetrag pro Person",
            "body": (
                "<p>Wir setzen einen maximalen monatlichen Beitrag pro Person fest. Zuerst werden die "
                "Gesamtkosten gleichmässig aufgeteilt, aber niemand zahlt mehr als das vereinbarte Maximum.</p>"
                "<ul><li>Vielnutzer:innen zahlen nicht mehr als den Deckel</li>"
                "<li>Verbleibende Kosten werden proportional unter den anderen verteilt</li></ul>"
                "<p>Schützt alle vor unerwartet hohen Rechnungen.</p>"
            ),
        },
        {
            "title": "Solidaritätsfonds-Ansatz",
            "body": (
                "<p>Alle zahlen den gleichen festen Beitrag in einen gemeinsamen Fonds pro Monat. "
                "Der Fonds deckt alle Gemeinschaftsausgaben. Ein Überschuss wird übertragen.</p>"
                "<ul><li>Kein Tracking individueller Nutzung nötig</li>"
                "<li>Einfach, schnell, null Verwaltungsaufwand</li></ul>"
                "<p>Funktioniert am besten, wenn die Nutzung ungefähr gleich ist. Tauscht Präzision gegen Einfachheit.</p>"
            ),
        },
        {
            "title": "Demokratische Abstimmung pro Posten",
            "body": (
                "<p>Für jede gemeinsame Ausgabe stimmen wir über die Aufteilungsmethode ab: gleich, "
                "proportional oder nur für Nutzer:innen. Jeder Posten bekommt seine eigene Regel.</p>"
                "<ul><li>Netflix: nur Nutzer:innen zahlen (Nicht-Nutzer:innen zahlen nichts)</li>"
                "<li>Internet: gleichmässige Aufteilung (alle profitieren)</li>"
                "<li>Putzen: proportional zur Zimmergrösse oder Unordnungsbeitrag</li></ul>"
                "<p>Flexibel und demokratisch, erfordert aber eine einmalige Diskussion.</p>"
            ),
        },
        {
            "title": "Stufenmodell nach Abo-Prinzip",
            "body": (
                "<p>Wir definieren drei Stufen: <strong>Basis</strong> (minimale Nutzung), "
                "<strong>Standard</strong> (durchschnittlich) und <strong>Premium</strong> "
                "(intensive Nutzung). Jede Person wählt pro Kategorie ihre Stufe.</p>"
                "<ul><li>Festgelegte Preisverhältnisse (z.B. 1:2:3)</li>"
                "<li>Stufenwahl ist freiwillig und ehrlich</li></ul>"
                "<p>Weniger Tracking als Einzelmessung, aber fairer als gleichmässige Aufteilung.</p>"
            ),
        },
        {
            "title": "Nutzungstagebuch mit Peer-Review",
            "body": (
                "<p>Jede Person führt ein kurzes wöchentliches Nutzungstagebuch für gemeinsame Ressourcen. "
                "Am Monatsende werden die Tagebücher geteilt und offensichtliche Unstimmigkeiten "
                "gemeinsam besprochen.</p>"
                "<ul><li>Selbst gemeldet, aber sozial validiert</li>"
                "<li>Fördert Bewusstsein für Konsumgewohnheiten</li></ul>"
                "<p>Fördert Ehrlichkeit durch Transparenz, nicht durch Überwachung.</p>"
            ),
        },
        {
            "title": "Einkommensabhängiger Prozentsatz",
            "body": (
                "<p>Jede:r Mitbewohner:in trägt einen festen Prozentsatz des monatlichen Einkommens "
                "zu den Gemeinschaftskosten bei. Besserverdienende zahlen absolut mehr, aber die "
                "prozentuale Belastung ist für alle gleich.</p>"
                "<ul><li>Fair bei gemischten Einkommensverhältnissen</li>"
                "<li>Prozentsätze können anonym über eine vertrauenswürdige Formel vereinbart werden</li></ul>"
                "<p>Berücksichtigt die Zahlungsfähigkeit, nicht nur die Nutzung.</p>"
            ),
        },
        {
            "title": "Hybrid: Grosse Posten proportional, kleine gleich",
            "body": (
                "<p>Für grosse wiederkehrende Kosten (Internet, Strom) proportional nach gemessener "
                "oder geschätzter Nutzung aufteilen. Für kleine Posten (Putzmittel, Gewürze) "
                "einfach gleichmässig teilen.</p>"
                "<ul><li>Proportionales Tracking nur dort, wo es finanziell relevant ist</li>"
                "<li>Kleine Posten sind den Tracking-Aufwand nicht wert</li></ul>"
                "<p>Pragmatische Balance zwischen Fairness und Aufwand.</p>"
            ),
        },
        {
            "title": "Testmonat mit Anpassungsklausel",
            "body": (
                "<p>Wir starten mit einer einfachen gleichmässigen Aufteilung für einen Monat. Am Ende "
                "meldet jede:r, ob die Aufteilung fair war. Falls nicht, passen wir einzelne "
                "Posten für den nächsten Monat an.</p>"
                "<ul><li>Lernen durch Ausprobieren statt Überplanung</li>"
                "<li>Monatliche Retrospektive zur Feinjustierung</li></ul>"
                "<p>Iterativ: Wir nähern uns innerhalb von 2-3 Monaten einer fairen Lösung an.</p>"
            ),
        },
        {
            "title": "Punktebasiertes Beitragssystem",
            "body": (
                "<p>Gemeinsamen Posten werden Punktwerte basierend auf Kosten zugewiesen. Jede:r "
                "Mitbewohner:in sammelt Punkte durch Beiträge (Einkaufen, Putzen, Reparaturen) "
                "und gibt Punkte aus durch Nutzung gemeinsamer Ressourcen.</p>"
                "<ul><li>Nicht-monetäre Beiträge zählen (z.B. Eigenreparaturen)</li>"
                "<li>Monatliche Abrechnung der Punktebilanzen</li></ul>"
                "<p>Anerkennt, dass Beitrag nicht nur Geld bedeutet.</p>"
            ),
        },
        {
            "title": "Smarte-Messung-Aufteilungsformel",
            "body": (
                "<p>Für Strom individuelle Zwischenzähler oder Smart Plugs in jedem Zimmer nutzen. "
                "Für andere Posten ein einfaches gemeinsames Protokoll. Gesamtkosten werden mit "
                "gemessenen Daten aufgeteilt, wo verfügbar, sonst mit Schätzungen.</p>"
                "<ul><li>Datenbasiert für die grössten Kosten</li>"
                "<li>Low-Tech-Schätzungen für kleinere Posten</li></ul>"
                "<p>Objektive Messung beseitigt Streit darüber, wer was nutzt.</p>"
            ),
        },
        {
            "title": "Kostentopf mit Ausstiegsrecht",
            "body": (
                "<p>Alle gemeinsamen Kosten fliessen in einen Topf, der standardmässig gleichmässig "
                "aufgeteilt wird. Aber jede:r kann sich von bestimmten Posten abmelden, die sie "
                "nachweislich nicht nutzen. Abgemeldete Posten werden unter den verbleibenden Nutzern:innen aufgeteilt.</p>"
                "<ul><li>Standard ist gleich (einfach), Ausnahmen sind explizit</li>"
                "<li>Abmeldung erfordert eine kurze Begründung</li></ul>"
                "<p>Minimales Tracking mit einem Fairness-Ventil für Nicht-Nutzer:innen.</p>"
            ),
        },
        {
            "title": "Wöchentliche Mini-Abrechnungen",
            "body": (
                "<p>Statt einer grossen monatlichen Abrechnung rechnen wir wöchentlich ab. "
                "Jede Woche sammelt eine Person die Belege und teilt sie per Bezahl-App auf. "
                "Schnell, kleine Beträge, weniger Überraschungen.</p>"
                "<ul><li>Reduziert die kognitive Last, einen ganzen Monat zu tracken</li>"
                "<li>Streitigkeiten werden früh erkannt, wenn die Erinnerung noch frisch ist</li></ul>"
                "<p>Häufige kleine Abrechnungen verhindern grosse Streitigkeiten später.</p>"
            ),
        },
    ]

    def _fallback_remix(self, parent_content: str) -> dict[str, str]:
        base = _strip_html(parent_content).strip()[:800] if parent_content else (
            "Lass uns unseren gemeinsamen Plan verfeinern." if self.language == "de"
            else "Let's refine our shared plan."
        )
        if self.language == "de":
            edits = [
                "Regel für Abwesenheiten hinzugefügt",
                "Vereinfacht, wie wir Nutzungsstufen kategorisieren",
            ]
        else:
            edits = [
                "Included a rule for handling absences",
                "Simplified how we categorise usage levels",
            ]
        edit = self.rng.choice(edits)
        if self.language == "de":
            content = (
                f"{_as_html(base)}"
                f"<p><strong>Was ich geändert habe:</strong> {html.escape(edit, quote=False)}. "
                f"Alles andere bleibt wie im ursprünglichen Vorschlag.</p>"
            )
        else:
            content = (
                f"{_as_html(base)}"
                f"<p><strong>What I changed:</strong> {html.escape(edit, quote=False)}. "
                f"Everything else stays the same as the original proposal.</p>"
            )
        return {
            "content": content[:2400],
            "change_rationale": edit[:100],
        }

    def _fallback_merge(
        self,
        parent_a_title: str,
        parent_a_content: str,
        parent_b_title: str,
    ) -> dict[str, str]:
        base_excerpt = _strip_html(parent_a_content).strip()[:600]
        if self.language == "de":
            title_options = [
                "Kombinierter Ansatz zur fairen Kostenaufteilung",
                "Das Beste aus beiden Welten: Ein gemeinsamer Vorschlag",
                "Praktischer Kompromiss für unsere WG",
                "Ausgewogener Kostenaufteilungsplan",
                "Zusammengeführtes Konzept für faire Anteile",
                "Integriertes Modell für gerechte Aufteilung",
                "Gemischtes Kostenteilungssystem",
                "Einheitliche Ausgabenvereinbarung",
                "Harmonisierter Beitragsplan",
                "Gemeinsamer Vorschlag für geteilte Kosten",
                "Zusammengeführter Fair-Split-Ansatz",
                "Kooperative Ausgabenformel",
            ]
        else:
            title_options = [
                "Combined Approach to Fair Cost Sharing",
                "Best of Both Worlds: A Unified Proposal",
                "Practical Compromise for Our Flat",
                "Balanced Cost Sharing Plan",
                "Synthesized Flat Cost Framework",
                "Integrated Fair Sharing Model",
                "Blended Cost Splitting System",
                "Unified Expense Agreement",
                "Harmonized Contribution Plan",
                "Joint Proposal for Shared Costs",
                "Converged Fair-Split Approach",
                "Cooperative Expense Formula",
            ]
        title = self.rng.choice(title_options)
        if self.language == "de":
            content = (
                f"<p>Dieser Vorschlag vereint die besten Ideen von "
                f"<strong>{html.escape(parent_a_title)}</strong> und "
                f"<strong>{html.escape(parent_b_title)}</strong>.</p>"
                f"<p>Ausgehend vom ersten Ansatz: {html.escape(base_excerpt[:300])}</p>"
                f"<p>Ich habe die wichtigsten Stärken beider Vorschläge zusammengeführt:</p>"
                f"<ul>"
                f"<li>Die praktische Erfassungsmethode des ersten Ansatzes</li>"
                f"<li>Die Fairness-Sicherungen des zweiten Ansatzes</li>"
                f"<li>Ein einfacherer monatlicher Prozess, der beide Ideen kombiniert</li>"
                f"</ul>"
                f"<p>Ich denke, das gibt uns das Beste aus beiden Welten und bleibt "
                f"für alle handhabbar.</p>"
            )
            rationale = (
                f"Praktische Struktur von '{parent_a_title[:40]}' übernommen und "
                f"Fairness-Prüfungen von '{parent_b_title[:40]}' ergänzt."
            )
        else:
            content = (
                f"<p>This proposal brings together the best ideas from "
                f"<strong>{html.escape(parent_a_title)}</strong> and "
                f"<strong>{html.escape(parent_b_title)}</strong>.</p>"
                f"<p>Starting from the first approach: {html.escape(base_excerpt[:300])}</p>"
                f"<p>I've integrated the key strengths of both proposals:</p>"
                f"<ul>"
                f"<li>The practical tracking method from the first approach</li>"
                f"<li>The fairness safeguards from the second approach</li>"
                f"<li>A simpler monthly process that combines both ideas</li>"
                f"</ul>"
                f"<p>I think this gives us the best of both worlds while keeping things "
                f"manageable for everyone.</p>"
            )
            rationale = (
                f"Took the practical structure of '{parent_a_title[:40]}' and added "
                f"the fairness checks from '{parent_b_title[:40]}'."
            )
        return {
            "title": title[:120],
            "content": content[:2400],
            "merge_rationale": rationale,
            "label": title[:30],
        }

