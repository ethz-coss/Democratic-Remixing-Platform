import type PocketBase from 'pocketbase';
import { createServerPocketBase } from '$lib/server/pb.server';
import {
	PRIVATE_PB_SUPERUSER_EMAIL,
	PRIVATE_PB_SUPERUSER_PASSWORD,
	PRIVATE_SIM_USER_PASSWORD
} from '$lib/server/env';
import { requestJsonDecision } from '$lib/server/simulator/llm';
import { escapeFilter } from '$lib/server/questions';

export interface SimActionResult {
	action: string;
	ok: boolean;
	details: string;
	recordIds: string[];
	refs: Array<{ collection: string; id: string }>;
	usedFallback: boolean;
	meta?: Record<string, unknown>;
}

interface SimUserRecord {
	id: string;
	email: string;
	username: string;
	name?: string;
}

interface AuthRepairContext {
	privilegedPb: PocketBase | null;
}

type GroupActionType = 'branchProposals' | 'mergeProposals' | 'voteProgress' | 'comments';

type SimUserHint = SimUserRecord;

interface ProposalLight {
	id: string;
	title: string;
	content: string;
	state: App.ProposalRecord['state'];
	author: string;
	occurredAt: string;
}

const PROPOSAL_TITLE_MAX = 110;
const PROPOSAL_REASON_MAX = 100;

function isMarkedSimulationUser(record: Record<string, unknown>): boolean {
	const simulation = record.simulation;
	if (simulation === true || simulation === 'true' || simulation === 1 || simulation === '1') {
		return true;
	}
	const email = String(record.email ?? '').toLowerCase();
	const username = String(record.username ?? '').toLowerCase();
	return email.endsWith('@sim.local') || username.startsWith('sim_');
}

function pocketbaseErrorDetails(error: unknown): string {
	if (!error) {
		return 'unknown error';
	}
	const err = error as {
		message?: unknown;
		response?: {
			status?: unknown;
			message?: unknown;
			data?: unknown;
		};
	};
	const message = typeof err.message === 'string' ? err.message : String(error);
	const status = err.response?.status !== undefined ? ` status=${String(err.response.status)}` : '';
	const responseMessage =
		typeof err.response?.message === 'string' ? ` responseMessage=${err.response.message}` : '';
	let responseData = '';
	try {
		if (err.response?.data !== undefined) {
			responseData = ` responseData=${JSON.stringify(err.response.data)}`;
		}
	} catch {
		responseData = ' responseData=[unserializable]';
	}
	return `${message}${status}${responseMessage}${responseData}`;
}

async function createPrivilegedPocketBase(): Promise<PocketBase> {
	const pb = createServerPocketBase();
	if (!PRIVATE_PB_SUPERUSER_EMAIL || !PRIVATE_PB_SUPERUSER_PASSWORD) {
		console.warn('createPrivilegedPocketBase: Missing superuser credentials in environment.');
		return pb;
	}

	try {
		// Try modern PocketBase _superusers collection first
		await pb
			.collection('_superusers')
			.authWithPassword(PRIVATE_PB_SUPERUSER_EMAIL, PRIVATE_PB_SUPERUSER_PASSWORD);
	} catch (err) {
		try {
			// Fallback to legacy _admins collection
			await pb
				.collection('_admins')
				.authWithPassword(PRIVATE_PB_SUPERUSER_EMAIL, PRIVATE_PB_SUPERUSER_PASSWORD);
		} catch (fallbackErr) {
			console.error(
				'createPrivilegedPocketBase: Authentication failed for both _superusers and _admins.'
			);
		}
	}

	if (!pb.authStore.isValid) {
		console.error('createPrivilegedPocketBase: Resulting client is NOT authenticated.');
	}

	return pb;
}

async function resolvePrivilegedPb(context: AuthRepairContext): Promise<PocketBase> {
	if (context.privilegedPb) {
		return context.privilegedPb;
	}
	context.privilegedPb = await createPrivilegedPocketBase();
	return context.privilegedPb;
}

function pickRandom<T>(values: T[]): T | null {
	if (values.length === 0) {
		return null;
	}
	return values[Math.floor(Math.random() * values.length)] ?? null;
}

function parseOccurredAt(raw: string | null): string {
	if (!raw) {
		return new Date().toISOString();
	}

	const parsed = Date.parse(raw);
	if (!Number.isFinite(parsed)) {
		return new Date().toISOString();
	}

	return new Date(parsed).toISOString();
}

function parseCount(raw: string | null, fallback: number, max: number): number {
	const parsed = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.max(1, Math.min(max, parsed));
}

function parseDurationMinutes(raw: string | null, fallback = 60): number {
	const parsed = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.max(1, Math.min(24 * 60, parsed));
}

function parseSpreadMinutes(raw: string | null): number {
	const parsed = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(parsed)) {
		return 0;
	}
	const clampedDays = Math.max(0, Math.min(365, parsed));
	return clampedDays * 24 * 60;
}

function pocketbaseErrorMessage(error: unknown): string {
	if (!error) {
		return 'unknown error';
	}
	if (error instanceof Error) {
		return error.message || 'unknown error';
	}
	if (typeof error === 'object') {
		const responseMessage = (error as { response?: { message?: unknown } }).response?.message;
		if (typeof responseMessage === 'string' && responseMessage.trim()) {
			return responseMessage.trim();
		}
	}
	return String(error);
}

function noSimulationUsersDetails(userIds?: string[]): string {
	if (userIds && userIds.length > 0) {
		return `No simulation users are available for this run (linked users: ${userIds.length}).`;
	}
	return 'No simulation users exist. Create simulation users first.';
}

function filterUsersForRun(users: SimUserRecord[], userIds?: string[]): SimUserRecord[] {
	if (!userIds || userIds.length === 0) {
		return users;
	}
	const allowed = new Set(userIds.filter(Boolean));
	return users.filter((user) => allowed.has(user.id));
}

function shuffled<T>(items: T[]): T[] {
	const next = [...items];
	for (let index = next.length - 1; index > 0; index -= 1) {
		const pick = Math.floor(Math.random() * (index + 1));
		const current = next[index];
		next[index] = next[pick] as T;
		next[pick] = current as T;
	}
	return next;
}

function sampleWithoutReplacement<T>(items: T[], count: number): T[] {
	if (count >= items.length) {
		return [...items];
	}
	return shuffled(items).slice(0, Math.max(0, count));
}

function spreadOccurredAt(
	baseIso: string,
	durationMinutes: number,
	index: number,
	total: number
): string {
	const baseMs = Date.parse(baseIso);
	if (!Number.isFinite(baseMs)) {
		return new Date().toISOString();
	}
	if (durationMinutes <= 0 || total <= 1) {
		return new Date(baseMs).toISOString();
	}
	const spreadMs = durationMinutes * 60 * 1000;
	const offset = Math.floor(Math.random() * (spreadMs + 1));
	return new Date(baseMs + offset).toISOString();
}

function safeTimestamp(raw: string): number {
	const ts = Date.parse(raw);
	return Number.isFinite(ts) ? ts : 0;
}

function ensureAfterParents(
	candidateIso: string,
	parentOccurredAts: Array<string | null | undefined>
): string {
	const candidateMs = safeTimestamp(candidateIso);
	const parentMax = parentOccurredAts.reduce((max, raw) => {
		const next = safeTimestamp(String(raw ?? ''));
		return next > max ? next : max;
	}, 0);
	if (parentMax <= 0) {
		return candidateIso;
	}
	const minAllowed = parentMax + 1000;
	if (candidateMs >= minAllowed) {
		return candidateIso;
	}
	return new Date(minAllowed).toISOString();
}

// ── Rich persona pool ──────────────────────────────────────────────────────────

const RICH_PERSONA_POOL = [
	'A pragmatic operations lead who has spent years managing large-scale deployments. ' +
		'Values clear rollback plans, measurable checkpoints, and minimal disruption. ' +
		'Tends to push back on ambitious timelines unless risk mitigations are explicit.',

	'A systems architect who thinks in feedback loops and long-term tradeoffs. ' +
		'Prefers modular proposals that can evolve independently. ' +
		'Often asks "what happens in 2 years?" before endorsing any approach.',

	'A user experience advocate who champions accessibility and adoption barriers. ' +
		'Believes the best technical proposal fails if real users cannot navigate it. ' +
		'Prioritizes inclusive design, clear language, and gradual onboarding.',

	'A risk manager who specializes in regulatory compliance and safety-critical systems. ' +
		'Skeptical of rapid iteration without proper observability. ' +
		'Always asks about audit trails, data integrity guarantees, and failure modes.',

	'A product strategist focused on measurable outcomes and market fit. ' +
		'Cares about adoption metrics, user retention, and cost-per-impact ratios. ' +
		'Pushes teams to define success criteria before starting implementation.',

	'A community organizer experienced in participatory governance processes. ' +
		'Values transparent decision-making, stakeholder inclusion, and consensus building. ' +
		'Wary of top-down proposals that bypass the people they affect.',

	'A data scientist who insists on evidence-based decision making. ' +
		'Wants to see pilot results, statistical significance, and baseline comparisons. ' +
		'Distrusts intuition-driven proposals that lack quantitative support.',

	'A creative entrepreneur who thrives on disruptive ideas and fast experimentation. ' +
		'Willing to accept higher risk for potentially transformative outcomes. ' +
		'Finds incremental improvements uninspiring and pushes for bold alternatives.',

	'An environmental sustainability advocate who evaluates every proposal through a resource-efficiency lens. ' +
		'Prioritizes long-term ecological impact, circular economy principles, and equitable resource distribution. ' +
		'Questions growth-oriented metrics that ignore externalities.',

	'A social equity researcher who focuses on how policies affect marginalized communities. ' +
		'Evaluates proposals for distributional fairness, access barriers, and unintended exclusion. ' +
		'Advocates for participatory design that centers affected populations.'
];

function deterministicPersonaIndex(user: {
	id?: string;
	username?: string;
	name?: string;
}): number {
	const seedSource = `${String(user.id ?? '')}:${String(user.username ?? '')}:${String(user.name ?? '')}`;
	let hash = 0;
	for (let i = 0; i < seedSource.length; i += 1) {
		hash = (hash * 31 + seedSource.charCodeAt(i)) >>> 0;
	}
	return hash % RICH_PERSONA_POOL.length;
}

function userPersonaLabel(user: { id?: string; username?: string; name?: string }): string {
	return (
		RICH_PERSONA_POOL[deterministicPersonaIndex(user)] ??
		RICH_PERSONA_POOL[0] ??
		'pragmatic collaborator'
	);
}

async function generateActorPersona(args: {
	actorName: string;
	questionTitle: string;
	questionContext: string;
	variationSeed: number;
}): Promise<string> {
	const fallback =
		RICH_PERSONA_POOL[Math.abs(args.variationSeed) % RICH_PERSONA_POOL.length] ??
		RICH_PERSONA_POOL[0];

	const llm = await requestJsonDecision(
		[
			{
				role: 'system',
				content:
					'Return only JSON with key "persona" containing a 3-4 sentence character description for a simulation participant. ' +
					'Make them a "normal person" - a generic internet user, community member, or typical stakeholder. ' +
					'Avoid consultant-speak, overly technical jargon, and hyper-competent expert archetypes. ' +
					'Include what they care about in simple terms (e.g. "wants things to be easy to use", "worries about cost").'
			},
			{
				role: 'user',
				content: JSON.stringify({
					actorName: args.actorName,
					questionTitle: args.questionTitle,
					questionContext: (args.questionContext || '').slice(0, 500),
					requirements: [
						'3-4 sentences describing a normal, everyday person',
						'Write simply without using business or academic buzzwords',
						'Give them a relatable perspective, hobby, or practical concern related to the question',
						'The persona should inform how this person would vote, comment, and propose proposals'
					]
				})
			}
		],
		{ persona: fallback }
	);

	const persona = String(llm.payload.persona ?? fallback).trim();
	return persona || fallback;
}

// ── Actor action history ───────────────────────────────────────────────────────

const HISTORY_LIMIT_PER_TYPE = 5;

interface ActorActionHistory {
	authoredProposals: Array<{ title: string; snippet: string }>;
	comments: Array<{ proposalTitle: string; snippet: string }>;
	votedProposalTitles: string[];
}

async function loadActorHistory(
	pb: PocketBase,
	userId: string,
	questionId: string
): Promise<ActorActionHistory> {
	const history: ActorActionHistory = {
		authoredProposals: [],
		comments: [],
		votedProposalTitles: []
	};

	try {
		// Proposals authored by this user for this question
		const proposals = await pb
			.collection('proposals')
			.getList<Record<string, unknown>>(1, HISTORY_LIMIT_PER_TYPE, {
				filter: `question = "${escapeFilter(questionId)}" && author = "${escapeFilter(userId)}"`,
				sort: '-occurred_at',
				fields: 'id,title,content'
			});
		history.authoredProposals = proposals.items.map((s) => ({
			title: String(s.title ?? '').slice(0, 80),
			snippet: String(s.content ?? '')
				.replace(/<[^>]*>/g, '')
				.slice(0, 120)
		}));
	} catch {
		// Non-blocking
	}

	try {
		// Comments by this user on proposals in this question
		const comments = await pb
			.collection('proposal_comments')
			.getList<Record<string, unknown>>(1, HISTORY_LIMIT_PER_TYPE, {
				filter: `author = "${escapeFilter(userId)}" && proposal.question = "${escapeFilter(questionId)}"`,
				sort: '-created',
				fields: 'id,content,proposal',
				expand: 'proposal'
			});
		history.comments = comments.items.map((c) => {
			const expanded = c.expand as Record<string, unknown> | undefined;
			const sol = expanded?.proposal as Record<string, unknown> | undefined;
			return {
				proposalTitle: String(sol?.title ?? 'a proposal').slice(0, 80),
				snippet: String(c.content ?? '')
					.replace(/<[^>]*>/g, '')
					.slice(0, 120)
			};
		});
	} catch {
		// Non-blocking
	}

	try {
		// Votes by this user on proposals in this question
		const votes = await pb
			.collection('proposal_votes')
			.getList<Record<string, unknown>>(1, HISTORY_LIMIT_PER_TYPE, {
				filter: `user = "${escapeFilter(userId)}" && proposal.question = "${escapeFilter(questionId)}" && vote > 0`,
				sort: '-created',
				fields: 'id,proposal',
				expand: 'proposal'
			});
		history.votedProposalTitles = votes.items.map((v) => {
			const expanded = v.expand as Record<string, unknown> | undefined;
			const sol = expanded?.proposal as Record<string, unknown> | undefined;
			return String(sol?.title ?? 'a proposal').slice(0, 80);
		});
	} catch {
		// Non-blocking
	}

	return history;
}

function formatActorHistoryPrompt(history: ActorActionHistory): string {
	const parts: string[] = [];

	if (history.authoredProposals.length > 0) {
		parts.push(
			'Proposals you authored:\n' +
				history.authoredProposals.map((s) => `- "${s.title}": ${s.snippet}`).join('\n')
		);
	}

	if (history.comments.length > 0) {
		parts.push(
			'Comments you wrote:\n' +
				history.comments.map((c) => `- On "${c.proposalTitle}": "${c.snippet}"`).join('\n')
		);
	}

	if (history.votedProposalTitles.length > 0) {
		parts.push('Proposals you voted for: ' + history.votedProposalTitles.join(', '));
	}

	if (parts.length === 0) {
		return 'You have not taken any actions on this question yet. This is your first interaction.';
	}

	return parts.join('\n\n');
}

async function listSelectionEligibleUserIds(
	pb: PocketBase,
	questionId: string
): Promise<Set<string>> {
	void questionId;
	const users = await pb.collection('users').getFullList<Record<string, unknown>>();
	const eligible = new Set<string>();
	for (const user of users) {
		const id = String(user.id ?? '').trim();
		if (id) {
			eligible.add(id);
		}
	}
	return eligible;
}

export async function listSimulationUsers(pb: PocketBase): Promise<SimUserRecord[]> {
	const users = await pb.collection('users').getFullList<Record<string, unknown>>();

	return users
		.filter((user) => isMarkedSimulationUser(user))
		.map((user) => ({
			id: String(user.id ?? '').trim(),
			email: String(user.email ?? '').trim(),
			username: String(user.username ?? '').trim(),
			name: String(user.name ?? '').trim()
		}));
}

async function resolveSimulationUsers(
	pb: PocketBase,
	userIds?: string[],
	userHints?: SimUserHint[]
): Promise<SimUserRecord[]> {
	const globalSimulationUsers = await listSimulationUsers(pb);

	if (userHints && userHints.length > 0) {
		const byId = new Map<string, SimUserRecord>();
		for (const hint of userHints) {
			const id = String(hint.id ?? '').trim();
			if (!id) continue;
			byId.set(id, {
				id,
				email: String(hint.email ?? '').trim(),
				username: String(hint.username ?? '').trim(),
				name: String(hint.name ?? '').trim()
			});
		}

		if (byId.size > 0) {
			for (const [id, candidate] of byId.entries()) {
				if (candidate.email || candidate.username) {
					continue;
				}
				try {
					const user = await pb.collection('users').getOne<Record<string, unknown>>(id);
					candidate.email = String(user.email ?? '').trim();
					candidate.username = String(user.username ?? '').trim();
					candidate.name = String(user.name ?? '').trim();
				} catch {
					// Keep unresolved hint entry; it may still work if another hint has auth identity.
				}
				byId.set(id, candidate);
			}

			if (globalSimulationUsers.length > 0) {
				for (const candidate of byId.values()) {
					if (candidate.email && candidate.username) {
						continue;
					}
					const username = candidate.username.toLowerCase();
					const email = candidate.email.toLowerCase();
					const matched = globalSimulationUsers.find(
						(user) =>
							(username && user.username.toLowerCase() === username) ||
							(email && user.email.toLowerCase() === email)
					);
					if (matched) {
						candidate.id = matched.id;
						candidate.email = matched.email;
						candidate.username = matched.username;
						candidate.name = matched.name ?? candidate.name;
					}
				}
			}

			if (!userIds || userIds.length === 0) {
				return Array.from(byId.values()).filter((user) => Boolean(user.email || user.username));
			}
			const allowed = new Set(userIds.filter(Boolean));
			const filtered = Array.from(byId.values()).filter(
				(user) => allowed.has(user.id) && Boolean(user.email || user.username)
			);
			if (filtered.length > 0) {
				return filtered;
			}

			const withIdentity = Array.from(byId.values()).filter((user) =>
				Boolean(user.email || user.username)
			);
			if (withIdentity.length > 0) {
				return withIdentity;
			}
		}
	}

	if (!userIds || userIds.length === 0) {
		return globalSimulationUsers;
	}

	const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
	const resolved: SimUserRecord[] = [];
	for (const userId of uniqueIds) {
		try {
			const user = await pb.collection('users').getOne<Record<string, unknown>>(userId);
			const email = String(user.email ?? '').trim();
			const username = String(user.username ?? '').trim();
			if (!email && !username) {
				continue;
			}
			resolved.push({
				id: String(user.id ?? ''),
				email,
				username,
				name: String(user.name ?? '')
			});
		} catch {
			// Ignore missing/deleted users.
		}
	}

	if (resolved.length > 0) {
		return resolved;
	}

	const filteredGlobal = filterUsersForRun(globalSimulationUsers, uniqueIds);
	if (filteredGlobal.length > 0) {
		return filteredGlobal;
	}

	// Dev runs can keep stale user links when users were deleted/recreated.
	// Fall back to any available simulation users instead of hard-failing.
	return globalSimulationUsers;
}

function normalizeUsernameBase(raw: string): string {
	const normalized = raw
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 28);
	if (!normalized) {
		return 'sim_agent';
	}
	if (normalized.startsWith('sim_')) {
		return normalized;
	}
	return `sim_${normalized}`;
}

async function generateSimIdentitySeeds(count: number): Promise<string[]> {
	const firstNames = [
		'Avery',
		'Jordan',
		'Harper',
		'Emerson',
		'Parker',
		'Noah',
		'Elena',
		'Mina',
		'Ravi',
		'Sofia',
		'Liam',
		'Caleb',
		'Priya',
		'Aisha',
		'Ronan',
		'Theo',
		'Jules',
		'Anika',
		'Nikhil',
		'Marta',
		'Darius',
		'Nora',
		'Diego',
		'Leah',
		'Omar',
		'Iris',
		'Mateo',
		'Zara',
		'Jonah',
		'Amara',
		'Lucia',
		'Kenji',
		'Marco',
		'Yasmin',
		'Imani',
		'Felix',
		'Greta',
		'Samir',
		'Talia'
	];
	const lastNames = [
		'Khan',
		'Mercer',
		'Patel',
		'Reyes',
		'Tanaka',
		'Brooks',
		'Singh',
		'Moreno',
		'Walker',
		'Chen',
		'Alvarez',
		'Bennett',
		'Ibrahim',
		'Costa',
		'Hughes',
		'Nguyen',
		'Okafor',
		'Dubois',
		'Nowak',
		'Kowalski',
		'Petrov',
		'Santos',
		'Kim',
		'Park',
		'Garcia',
		'Romero',
		'Mahmoud',
		'Rahman',
		'Ali',
		'Baker',
		'Turner',
		'Davis',
		'Rivera',
		'Flores',
		'Ortega',
		'Larsson',
		'Nielsen',
		'Rossi',
		'Conti',
		'Moreau',
		'Leclerc',
		'Fischer',
		'Schmidt',
		'Yamada',
		'Suzuki',
		'Chowdhury',
		'Malik'
	];

	function toTitleCaseToken(value: string): string {
		const cleaned = value
			.replace(/[^A-Za-z]/g, '')
			.trim()
			.toLowerCase();
		if (!cleaned) {
			return '';
		}
		return `${cleaned[0]?.toUpperCase() ?? ''}${cleaned.slice(1)}`;
	}

	function splitNameParts(value: string): { first: string; last: string } | null {
		const tokens = value
			.trim()
			.split(/\s+/)
			.map((token) => toTitleCaseToken(token))
			.filter(Boolean);
		if (tokens.length < 2) {
			return null;
		}
		return {
			first: tokens[0],
			last: tokens[tokens.length - 1]
		};
	}

	function shuffled<T>(values: T[]): T[] {
		const clone = [...values];
		for (let index = clone.length - 1; index > 0; index -= 1) {
			const pick = Math.floor(Math.random() * (index + 1));
			const current = clone[index];
			clone[index] = clone[pick] as T;
			clone[pick] = current as T;
		}
		return clone;
	}

	const fallbackLastOrder = shuffled(lastNames);
	const fallbackFirstOrder = shuffled(firstNames);
	const fallback = {
		names: Array.from({ length: count }, (_, index) => {
			const first = fallbackFirstOrder[index % fallbackFirstOrder.length];
			const last = fallbackLastOrder[index % fallbackLastOrder.length];
			return `${first} ${last}`;
		})
	};

	const llm = await requestJsonDecision(
		[
			{
				role: 'system',
				content:
					'Return only JSON with key names containing an array of short human-like first+last names for simulation agents.'
			},
			{
				role: 'user',
				content: JSON.stringify({
					count,
					requirements: [
						'Output JSON object: {"names": string[]}',
						`Provide exactly ${count} names`,
						'Each name should be 2 words, title case, ASCII only, no punctuation'
					]
				})
			}
		],
		fallback
	);

	const rawNames = Array.isArray(llm.payload.names)
		? llm.payload.names
		: Array.isArray(llm.payload.users)
			? llm.payload.users
			: Array.isArray(llm.payload.data)
				? llm.payload.data
				: fallback.names;
	const cleaned = rawNames
		.map((value) => {
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				const maybeName =
					(value as { name?: unknown; fullName?: unknown; displayName?: unknown }).name ??
					(value as { name?: unknown; fullName?: unknown; displayName?: unknown }).fullName ??
					(value as { name?: unknown; fullName?: unknown; displayName?: unknown }).displayName;
				return String(maybeName ?? '').trim();
			}
			return String(value ?? '').trim();
		})
		.map((name) =>
			name
				.replace(/\s+/g, ' ')
				.replace(/[^A-Za-z\s'-]/g, '')
				.trim()
		)
		.filter(Boolean)
		.slice(0, count);

	const seeded: string[] = [];
	const usedFullNames = new Set<string>();
	const usedLastNames = new Set<string>();
	const maxUniqueLastNames = Math.min(count, fallbackLastOrder.length);

	for (let index = 0; index < count; index += 1) {
		const candidateRaw = cleaned[index] ?? fallback.names[index] ?? 'Avery Khan';
		const parsed =
			splitNameParts(candidateRaw) ?? splitNameParts(fallback.names[index] ?? 'Avery Khan');
		let first = parsed?.first ?? 'Avery';
		let last = parsed?.last ?? fallbackLastOrder[index % fallbackLastOrder.length] ?? 'Khan';

		if (usedLastNames.has(last) && usedLastNames.size < maxUniqueLastNames) {
			const uniqueLast = fallbackLastOrder.find((value) => !usedLastNames.has(value));
			if (uniqueLast) {
				last = uniqueLast;
			}
		}

		let fullName = `${first} ${last}`;
		if (usedFullNames.has(fullName)) {
			const altLast =
				fallbackLastOrder.find((value) => !usedLastNames.has(value)) ??
				fallbackLastOrder.find((value) => value !== last) ??
				last;
			last = altLast;
			fullName = `${first} ${last}`;
		}

		if (usedFullNames.has(fullName)) {
			const fallbackParsed = splitNameParts(fallback.names[index] ?? '') ?? {
				first: fallbackFirstOrder[index % fallbackFirstOrder.length] ?? 'Avery',
				last: fallbackLastOrder[index % fallbackLastOrder.length] ?? 'Khan'
			};
			first = fallbackParsed.first;
			last = fallbackParsed.last;
			fullName = `${first} ${last}`;
		}

		usedFullNames.add(fullName);
		usedLastNames.add(last);
		seeded.push(fullName);
	}

	return seeded;
}

function buildUniqueUsername(base: string, taken: Set<string>): string {
	if (!taken.has(base)) {
		taken.add(base);
		return base;
	}

	for (let attempt = 1; attempt <= 2000; attempt += 1) {
		const candidate = `${base}_${attempt}`.slice(0, 40);
		if (!taken.has(candidate)) {
			taken.add(candidate);
			return candidate;
		}
	}

	const fallback = `${base}_${Date.now().toString(36).slice(-5)}`.slice(0, 40);
	taken.add(fallback);
	return fallback;
}

export async function createSimulationUsers(
	pb: PocketBase,
	count: number,
	runId?: string
): Promise<SimActionResult> {
	const createdIds: string[] = [];
	const createdUsers: Array<{ id: string; username: string; email: string; name: string }> = [];
	const refs: Array<{ collection: string; id: string }> = [];
	const failures: string[] = [];
	const existing = await listSimulationUsers(pb);
	const takenUsernames = new Set(existing.map((user) => user.username.toLowerCase()));
	try {
		const allUsers = await pb.collection('users').getFullList<Record<string, unknown>>();
		for (const user of allUsers) {
			const username = String(user.username ?? '')
				.trim()
				.toLowerCase();
			if (username) {
				takenUsernames.add(username);
			}
		}
	} catch (error) {
		console.warn(
			`[dev-simulator] users list for collision check failed: ${pocketbaseErrorMessage(error)}`
		);
	}
	const nameSeeds = await generateSimIdentitySeeds(count);
	const anonymousPb = createServerPocketBase();
	void runId;
	console.info(`[dev-simulator] createSimUsers start count=${count}`);

	for (let index = 0; index < count; index += 1) {
		const displayName = nameSeeds[index] ?? `Sim Agent ${index + 1}`;
		const usernameBase = normalizeUsernameBase(displayName);
		let createdForSeed = false;
		let lastFailure = '';

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const username =
				attempt === 0
					? buildUniqueUsername(usernameBase, takenUsernames)
					: buildUniqueUsername(
							`${usernameBase}_${Math.floor(Math.random() * 999)}`,
							takenUsernames
						);
			const email = `${username}@sim.local`;
			const payload = {
				username,
				email,
				password: PRIVATE_SIM_USER_PASSWORD,
				passwordConfirm: PRIVATE_SIM_USER_PASSWORD,
				name: displayName,
				simulation: true
			};

			try {
				let created = null;
				try {
					created = await pb.collection('users').create(payload);
				} catch (authedError) {
					console.warn(
						`[dev-simulator] users.create authed failed username=${username}: ${pocketbaseErrorMessage(authedError)}`
					);
					created = await anonymousPb.collection('users').create(payload);
				}

				const createdId = String(created.id ?? '').trim();
				if (!createdId) {
					lastFailure = `users.create returned empty id for ${username}`;
					continue;
				}

				console.info(`[dev-simulator] users.create ok id=${createdId} username=${username}`);
				createdIds.push(createdId);
				createdUsers.push({
					id: createdId,
					username,
					email,
					name: displayName
				});
				refs.push({ collection: 'users', id: createdId });
				createdForSeed = true;
				break;
			} catch (error) {
				lastFailure = pocketbaseErrorMessage(error);
				console.error(
					`[dev-simulator] users.create failed username=${username} email=${email} attempt=${attempt + 1} message=${lastFailure}`
				);
			}
		}

		if (!createdForSeed) {
			failures.push(lastFailure || 'users.create failed after retries');
		}
	}

	const uniqueFailures = Array.from(new Set(failures.filter(Boolean))).slice(0, 2);
	const failureNote =
		uniqueFailures.length > 0 ? ` Failure reason: ${uniqueFailures.join(' | ')}` : '';
	if (createdIds.length === 0 && uniqueFailures.length === 0) {
		console.error(
			'[dev-simulator] createSimUsers ended with zero users and no explicit PocketBase errors'
		);
	}
	console.info(
		`[dev-simulator] createSimUsers done created=${createdIds.length} failures=${failures.length}`
	);

	return {
		action: 'createSimUsers',
		ok: createdIds.length > 0,
		details: `Added ${createdIds.length} simulated user(s) with human-style names.${failureNote}`,
		recordIds: createdIds,
		refs,
		usedFallback: createdIds.length === 0,
		meta: {
			createdUsers
		}
	};
}

async function authAsUser(user: SimUserRecord) {
	const pb = createServerPocketBase();
	const authIdentity = String(user.email ?? '').trim() || String(user.username ?? '').trim();
	if (!authIdentity) {
		throw new Error(`Simulation user ${user.id} has no email or username for auth.`);
	}
	await pb.collection('users').authWithPassword(authIdentity, PRIVATE_SIM_USER_PASSWORD);
	return pb;
}

function fallbackSimUsername(userId: string): string {
	const seed = String(userId || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
	const suffix = seed.slice(0, 16) || String(Date.now());
	return `sim_${suffix}`;
}

function fallbackSimEmail(username: string): string {
	const localPart =
		String(username || '')
			.trim()
			.toLowerCase() || `sim_${Date.now()}`;
	return `${localPart}@sim.local`;
}

async function loadUserAuthIdentity(
	userId: string,
	context: AuthRepairContext
): Promise<{ userRecord: Record<string, unknown> | null; identity: string }> {
	if (!userId) {
		return { userRecord: null, identity: '' };
	}

	const privilegedPb = await resolvePrivilegedPb(context);
	const userRecord = await privilegedPb
		.collection('users')
		.getOne<Record<string, unknown>>(userId)
		.catch(() => null);
	const identity =
		String(userRecord?.email ?? '').trim() || String(userRecord?.username ?? '').trim() || '';

	return {
		userRecord,
		identity
	};
}

async function authAsUserWithRepair(
	user: SimUserRecord,
	context: AuthRepairContext
): Promise<PocketBase> {
	let hydratedUser: SimUserRecord = { ...user };
	if (!hydratedUser.email && !hydratedUser.username && hydratedUser.id) {
		const loaded = await loadUserAuthIdentity(hydratedUser.id, context);
		if (loaded.userRecord) {
			hydratedUser = {
				...hydratedUser,
				email: String(loaded.userRecord.email ?? '').trim(),
				username: String(loaded.userRecord.username ?? '').trim()
			};
		}
	}

	try {
		return await authAsUser(hydratedUser);
	} catch (authError) {
		const loaded = await loadUserAuthIdentity(hydratedUser.id, context);
		const isSimulation =
			(loaded.userRecord && isMarkedSimulationUser(loaded.userRecord)) ||
			isMarkedSimulationUser(hydratedUser as unknown as Record<string, unknown>);
		if (!isSimulation) {
			throw authError;
		}

		const privilegedPb = await resolvePrivilegedPb(context);
		const recoveredIdentity = loaded.identity;
		if (recoveredIdentity && (!hydratedUser.email || !hydratedUser.username)) {
			hydratedUser = {
				...hydratedUser,
				email: String(loaded.userRecord?.email ?? '').trim(),
				username: String(loaded.userRecord?.username ?? '').trim()
			};
		}

		// Older simulation runs can contain users with blank identity fields.
		// Auto-heal those records with deterministic credentials so actor auth can proceed.
		if (!hydratedUser.email && !hydratedUser.username && hydratedUser.id) {
			const username = fallbackSimUsername(hydratedUser.id);
			const email = fallbackSimEmail(username);
			try {
				await privilegedPb.collection('users').update(hydratedUser.id, {
					username,
					email,
					password: PRIVATE_SIM_USER_PASSWORD,
					passwordConfirm: PRIVATE_SIM_USER_PASSWORD,
					simulation: true
				});
				hydratedUser = {
					...hydratedUser,
					email,
					username
				};
			} catch (identityRepairError) {
				throw new Error(
					`simulation identity repair failed for user ${hydratedUser.id}: ${pocketbaseErrorDetails(identityRepairError)}`
				);
			}
		}

		try {
			await privilegedPb.collection('users').update(hydratedUser.id, {
				password: PRIVATE_SIM_USER_PASSWORD,
				passwordConfirm: PRIVATE_SIM_USER_PASSWORD
			});
		} catch (repairError) {
			throw new Error(
				`simulation auth failed and repair failed for user ${hydratedUser.id}: ${pocketbaseErrorDetails(repairError)}`
			);
		}

		try {
			const refreshed = await loadUserAuthIdentity(hydratedUser.id, context);
			if (refreshed.userRecord) {
				hydratedUser = {
					...hydratedUser,
					email: String(refreshed.userRecord.email ?? '').trim(),
					username: String(refreshed.userRecord.username ?? '').trim()
				};
			}
			return await authAsUser(hydratedUser);
		} catch (retryError) {
			throw new Error(
				`simulation auth retry failed for user ${hydratedUser.id}: ${pocketbaseErrorDetails(retryError)}`
			);
		}
	}
}

/**
 * SimulationUserActor wraps a simulation user with:
 * - Hydrated identity (guaranteed email + username after construction)
 * - Lazy-cached authenticated PocketBase client
 * - Built-in auth repair via shared AuthRepairContext
 * - Rich persona profile (LLM-generated, cached per actor)
 * - Action history (lazy-loaded from PocketBase, cached per question)
 *
 * All simulation action functions should use actors instead of raw SimUserRecord + authAsUser.
 */
class SimulationUserActor {
	readonly user: SimUserRecord;
	private _pb: PocketBase | null = null;
	private readonly _authRepairCtx: AuthRepairContext;
	private _persona: string | null = null;
	private _history: ActorActionHistory | null = null;
	private _historyQuestionId: string | null = null;

	constructor(user: SimUserRecord, authRepairCtx: AuthRepairContext) {
		this.user = user;
		this._authRepairCtx = authRepairCtx;
	}

	get id(): string {
		return this.user.id;
	}

	get name(): string {
		return this.user.name ?? '';
	}

	get username(): string {
		return this.user.username;
	}

	get email(): string {
		return this.user.email;
	}

	/** Short deterministic persona label (for fallback / logging). */
	get persona(): string {
		return this._persona ?? userPersonaLabel(this.user);
	}

	/** Set persona directly (used during batch persona generation). */
	setPersona(persona: string): void {
		this._persona = persona;
	}

	/** Get an authenticated PocketBase client. Caches after first successful auth. */
	async pb(): Promise<PocketBase> {
		if (this._pb) {
			return this._pb;
		}
		this._pb = await authAsUserWithRepair(this.user, this._authRepairCtx);
		return this._pb;
	}

	/** Load and cache actor's action history for a question. */
	async getHistory(questionId: string): Promise<ActorActionHistory> {
		if (this._history && this._historyQuestionId === questionId) {
			return this._history;
		}
		try {
			const pb = await this.pb();
			this._history = await loadActorHistory(pb, this.id, questionId);
		} catch {
			this._history = { authoredProposals: [], comments: [], votedProposalTitles: [] };
		}
		this._historyQuestionId = questionId;
		return this._history;
	}

	/**
	 * Build a complete system prompt for LLM calls, including:
	 * - Actor persona
	 * - Action history on the current question
	 * - Task-specific instructions
	 */
	async buildSystemPrompt(args: {
		questionId: string;
		questionTitle: string;
		questionContext?: string;
		taskInstructions: string;
	}): Promise<string> {
		const history = await this.getHistory(args.questionId);
		const historyText = formatActorHistoryPrompt(history);

		return (
			`You are ${this.name || this.username || 'a participant'} ` +
			`in a collaborative question-solving platform.\n\n` +
			`QUESTION: "${args.questionTitle}"\n` +
			(args.questionContext ? `CONTEXT: ${args.questionContext.slice(0, 500)}\n\n` : '\n') +
			`YOUR BACKGROUND (use to guide your thinking, but NEVER quote or describe it in your output):\n${this.persona}\n\n` +
			`YOUR PREVIOUS ACTIONS ON THIS QUESTION:\n${historyText}\n\n` +
			`CRITICAL RULES:\n` +
			`- Write naturally as a real person would. Your output is content that gets posted directly.\n` +
			`- NEVER mention your persona, role description, background, or character traits in your output.\n` +
			`- NEVER prefix output with your name or "As [name]..." patterns.\n` +
			`- Let your perspective shape WHAT you write, not HOW you describe yourself.\n` +
			`- Reference the actual question content, existing proposals, and constraints — not abstract generalities.\n\n` +
			args.taskInstructions
		);
	}
}

/**
 * Resolves simulation users and returns hydrated SimulationUserActor instances.
 * Pre-hydrates identity fields and generates rich personas via LLM.
 */
async function resolveSimulationActors(
	pb: PocketBase,
	userIds?: string[],
	userHints?: SimUserHint[],
	personaContext?: { questionTitle: string; questionContext: string }
): Promise<SimulationUserActor[]> {
	const users = await resolveSimulationUsers(pb, userIds, userHints);
	if (users.length === 0) {
		return [];
	}

	const authRepairCtx: AuthRepairContext = { privilegedPb: null };

	// Pre-hydrate users missing identity fields in a single pass
	const needsHydration = users.filter((u) => !u.email && !u.username && u.id);
	if (needsHydration.length > 0) {
		try {
			const privilegedPb = await resolvePrivilegedPb(authRepairCtx);
			for (const user of needsHydration) {
				try {
					const record = await privilegedPb
						.collection('users')
						.getOne<Record<string, unknown>>(user.id);
					user.email = String(record.email ?? '').trim();
					user.username = String(record.username ?? '').trim();
					user.name = String(record.name ?? user.name ?? '').trim();
				} catch {
					// Skip users that can't be resolved; actor.pb() will attempt repair later
				}
			}
		} catch {
			// If privileged auth fails, actors will attempt individual repair on first pb() call
		}
	}

	const actors = users.map((user) => new SimulationUserActor(user, authRepairCtx));

	// Generate rich personas if question context is available
	if (personaContext) {
		const personaPromises = actors.map((actor, index) =>
			generateActorPersona({
				actorName: actor.name || actor.username,
				questionTitle: personaContext.questionTitle,
				questionContext: personaContext.questionContext,
				variationSeed: index
			})
				.then((persona) => actor.setPersona(persona))
				.catch(() => {
					// Fallback persona is already set via the getter
				})
		);
		await Promise.all(personaPromises);
	}

	return actors;
}

async function listQuestionProposals(pb: PocketBase, questionId: string): Promise<ProposalLight[]> {
	const proposals = await pb.collection('proposals').getFullList<Record<string, unknown>>({
		filter: `question = "${escapeFilter(questionId)}"`,
		sort: '-occurred_at'
	});

	return proposals.map((proposal) => ({
		id: String(proposal.id ?? ''),
		title: String(proposal.title ?? ''),
		content: String(proposal.content ?? ''),
		state: String(proposal.state ?? 'Proposed') as App.ProposalRecord['state'],
		author: String(proposal.author ?? ''),
		occurredAt: String(proposal.occurred_at ?? proposal.created ?? proposal.updated ?? '')
	}));
}

async function generateBranchPayload(args: {
	questionTitle: string;
	parentTitle: string;
	parentContent?: string;
	questionId: string;
	questionContext?: string;
	actorName?: string;
	actorUsername?: string;
	actorPersona?: string;
	variationSeed?: number;
	actorSystemPrompt?: string;
}): Promise<{
	title: string;
	content: string;
	reason: string;
	usedFallback: boolean;
	reasonNote: string;
}> {
	const actorLabel = (args.actorName || args.actorUsername || 'A simulation participant').trim();
	const parentContent = args.parentContent || '';

	// ── Fallback: copy parent content and splice in a modification ────
	const fallbackEdits = [
		'Added a few specific steps to make this easier to start.',
		'Simplified the idea so it is less confusing for new people.',
		'Included a small change to keep the costs down.',
		'Clarified the main point so everyone is on the same page.'
	];
	const editIdx =
		Math.abs(Math.round(Number(args.variationSeed ?? Date.now()))) % fallbackEdits.length;
	const editNote = fallbackEdits[editIdx] ?? fallbackEdits[0];

	// Build fallback content by appending a modification to the parent
	const fallbackContent = parentContent
		? parentContent + `\n<p><strong>Small tweak:</strong> ${editNote}</p>`
		: `<p>Building on "${args.parentTitle}", this idea ${editNote.toLowerCase()}</p>` +
			`<p>The core idea stays the same, but I just wanted to make it a bit more practical for everyday use.</p>`;

	const fallback = {
		title: `Refine: ${args.parentTitle || args.questionTitle}`.slice(0, PROPOSAL_TITLE_MAX),
		content: fallbackContent,
		reason: editNote.slice(0, PROPOSAL_REASON_MAX)
	};

	const systemContent = args.actorSystemPrompt
		? args.actorSystemPrompt +
			'\nReturn only JSON with keys: title, content, reason. ' +
			'Write the content as if you are the author — do NOT mention your persona, role description, or character name in the content. ' +
			'Write naturally as a real participant would.'
		: 'You generate concise JSON for collaborative proposal branching. Return only JSON with keys: title, content, reason. ' +
			'You MUST start from the parent content and make targeted edits — like a git diff. ' +
			'Preserve the majority of the parent text, modifying only the specific paragraphs that need improvement.';

	const llm = await requestJsonDecision(
		[
			{
				role: 'system',
				content: systemContent
			},
			{
				role: 'user',
				content: JSON.stringify({
					parentTitle: args.parentTitle,
					parentContent: parentContent,
					requirements: [
						'Title 8-110 chars, descriptive but written like a normal person, avoid generic phrasing',
						'Content MUST be formatted as prose with HTML tags (<p>, <ul>, etc.) for a WYSIWYG editor',
						'Content MUST be the parent content with targeted edits — copy the parent HTML and modify specific paragraphs/sentences',
						'Do NOT rewrite from scratch. Preserve the parent structure and most of the text.',
						'Change at most 1-3 paragraphs. You may add, remove, or reword paragraphs.',
						'Reason 1 sentence, <= 100 chars, describing what changed simply',
						'Write as a normal person would — use casual, simple language and DO NOT use mathy or technical jargon',
						'Do NOT include your persona description or role label in the text'
					]
				})
			}
		],
		fallback
	);

	const titleRaw = String(llm.payload.title ?? fallback.title).trim();
	const contentRaw = String(llm.payload.content ?? fallback.content).trim();
	const reasonRaw = String(llm.payload.reason ?? fallback.reason).trim();
	const reasonSafe = reasonRaw.slice(0, PROPOSAL_REASON_MAX).trim() || fallback.reason;

	return {
		title: (titleRaw || fallback.title).slice(0, PROPOSAL_TITLE_MAX),
		content: contentRaw || fallback.content,
		reason: reasonSafe,
		usedFallback: llm.usedFallback,
		reasonNote: llm.reason
	};
}

async function generateCommentPayload(args: {
	questionTitle: string;
	questionContext?: string;
	proposalTitle: string;
	proposalContent?: string;
	actorName?: string;
	actorUsername?: string;
	actorPersona?: string;
	actorSystemPrompt?: string;
}): Promise<{ content: string; usedFallback: boolean; reasonNote: string }> {
	const fallback = {
		content: `I think "${args.proposalTitle}" is pretty good, but it might be a bit complicated. Maybe we can simplify it so it's easier to actually do?`
	};

	const systemContent = args.actorSystemPrompt
		? args.actorSystemPrompt +
			'\nReturn only JSON with key "content" for a short constructive comment. ' +
			'Write the comment as yourself — do NOT mention your persona description, role, or character traits. ' +
			'Just write a natural, helpful comment on the proposal.'
		: 'Return only JSON with key content for a short constructive comment grounded in the question context and reviewer persona.';

	const llm = await requestJsonDecision(
		[
			{
				role: 'system',
				content: systemContent
			},
			{
				role: 'user',
				content: JSON.stringify({
					proposalTitle: args.proposalTitle,
					proposalContent: args.proposalContent || '',
					style:
						'Write 2-4 sentences as if you are posting a comment. Be casual, simple, and specific. Do NOT use mathy or technical jargon. Do NOT describe yourself or your role — just react to the proposal content directly.'
				})
			}
		],
		fallback
	);

	const content = String(llm.payload.content ?? fallback.content).trim();
	return {
		content: content || fallback.content,
		usedFallback: llm.usedFallback,
		reasonNote: llm.reason
	};
}

async function generateMergePayload(args: {
	questionTitle: string;
	questionContext?: string;
	firstTitle: string;
	firstContent?: string;
	secondTitle: string;
	secondContent?: string;
	actorName?: string;
	actorUsername?: string;
	actorPersona?: string;
	actorSystemPrompt?: string;
}): Promise<{
	title: string;
	content: string;
	reason: string;
	usedFallback: boolean;
	reasonNote: string;
}> {
	const firstContent = args.firstContent || '';
	const secondContent = args.secondContent || '';

	// ── Fallback: concatenate both parent contents with attribution ────
	const fallbackContent = [
		`<p>I liked parts of both "${args.firstTitle}" and "${args.secondTitle}", so I tried to combine them here.</p>`,
		firstContent ? `<p><em>From "${args.firstTitle}":</em></p>\n${firstContent}` : '',
		secondContent ? `<p><em>From "${args.secondTitle}":</em></p>\n${secondContent}` : '',
		'<p><strong>Why this works:</strong> It takes the best simple ideas from both and puts them together.</p>'
	]
		.filter(Boolean)
		.join('\n');

	const fallback = {
		title: `${args.firstTitle} + ${args.secondTitle}`.slice(0, PROPOSAL_TITLE_MAX),
		content: fallbackContent,
		reason: `Put two good ideas together into one simple plan.`
	};

	const systemContent = args.actorSystemPrompt
		? args.actorSystemPrompt +
			'\nReturn only JSON with keys: title, content, reason. ' +
			'Write the merged content as if you are the author — do NOT mention your persona, role description, or character name. ' +
			'Write naturally as a real participant would.'
		: 'Return only JSON with keys title, content, reason. You are merging two collaborative proposal drafts into one concise option. ' +
			'Copy paragraphs from both parent contents and interleave them into a coherent document. ' +
			'Preserve as much of the original text as possible — only edit for coherence.';

	const llm = await requestJsonDecision(
		[
			{
				role: 'system',
				content: systemContent
			},
			{
				role: 'user',
				content: JSON.stringify({
					firstTitle: args.firstTitle,
					firstContent: firstContent,
					secondTitle: args.secondTitle,
					secondContent: secondContent,
					requirements: [
						'Title 8-110 chars',
						'Content MUST be formatted as prose with HTML tags (<p>, <ul>, etc.) for a WYSIWYG editor',
						'Content MUST include actual paragraphs from BOTH parent documents, copied verbatim where possible',
						'Interleave and integrate the two parents — do NOT summarize or rewrite from scratch',
						'You may edit paragraphs for flow but preserve the original wording as much as possible',
						'Reason should be one concise sentence <= 100 chars',
						'Write as a normal person would — use casual, simple language and DO NOT use mathy or technical jargon'
					]
				})
			}
		],
		fallback
	);

	return {
		title: (String(llm.payload.title ?? fallback.title).trim() || fallback.title).slice(
			0,
			PROPOSAL_TITLE_MAX
		),
		content: String(llm.payload.content ?? fallback.content).trim() || fallback.content,
		reason:
			(String(llm.payload.reason ?? fallback.reason).trim() || fallback.reason)
				.slice(0, PROPOSAL_REASON_MAX)
				.trim() || fallback.reason,
		usedFallback: llm.usedFallback,
		reasonNote: llm.reason
	};
}

async function decidePrimaryTarget(args: {
	questionTitle: string;
	user: SimUserRecord;
	action: GroupActionType;
	proposals: ProposalLight[];
	actorSystemPrompt?: string;
}): Promise<{ primaryId: string; secondaryId?: string; usedFallback: boolean }> {
	const proposed = args.proposals.filter((proposal) => proposal.state === 'Proposed');
	if (proposed.length === 0) {
		return { primaryId: '', usedFallback: true };
	}

	const fallbackPrimary = pickRandom(proposed)?.id ?? '';
	const fallbackSecondary =
		args.action === 'mergeProposals'
			? (pickRandom(proposed.filter((proposal) => proposal.id !== fallbackPrimary))?.id ?? '')
			: '';

	const systemContent = args.actorSystemPrompt
		? args.actorSystemPrompt +
			'\nReturn only JSON. Choose the proposal target ids that align best with your persona and values. Use exact ids from the options.'
		: 'Return only JSON. Choose suitable proposal target ids for the requested action. Use exact ids from options.';

	const llm = await requestJsonDecision(
		[
			{
				role: 'system',
				content: systemContent
			},
			{
				role: 'user',
				content: JSON.stringify({
					action: args.action,
					options: proposed.map((proposal) => ({
						id: proposal.id,
						title: proposal.title
					})),
					format:
						args.action === 'mergeProposals'
							? '{"primaryId": "...", "secondaryId": "..."}'
							: '{"primaryId": "..."}'
				})
			}
		],
		{
			primaryId: fallbackPrimary,
			secondaryId: fallbackSecondary
		}
	);

	const allowed = new Set(proposed.map((proposal) => proposal.id));
	const primaryId = String(llm.payload.primaryId ?? fallbackPrimary).trim();
	const secondaryId = String(llm.payload.secondaryId ?? fallbackSecondary).trim();
	const validPrimary = allowed.has(primaryId) ? primaryId : fallbackPrimary;
	let validSecondary = '';
	if (args.action === 'mergeProposals') {
		validSecondary =
			allowed.has(secondaryId) && secondaryId !== validPrimary
				? secondaryId
				: fallbackSecondary && fallbackSecondary !== validPrimary
					? fallbackSecondary
					: (pickRandom(proposed.filter((proposal) => proposal.id !== validPrimary))?.id ?? '');
	}

	return {
		primaryId: validPrimary,
		secondaryId: validSecondary || undefined,
		usedFallback: llm.usedFallback
	};
}

// ── Batched LLM decision functions ─────────────────────────────────────────────

const DECISION_BATCH_SIZE = 5;

async function evaluateVotesBatch(args: {
	pairs: Array<{ actor: SimulationUserActor; target: ProposalLight }>;
	questionId: string;
	questionTitle: string;
	questionContext?: string;
}): Promise<Array<{ value: 'support' | 'neutral' | 'oppose'; usedFallback: boolean }>> {
	const results: Array<{ value: 'support' | 'neutral' | 'oppose'; usedFallback: boolean }> = [];

	for (let i = 0; i < args.pairs.length; i += DECISION_BATCH_SIZE) {
		const batch = args.pairs.slice(i, i + DECISION_BATCH_SIZE);
		const pairContexts = await Promise.all(
			batch.map(async (pair, index) => ({
				index,
				actorName: pair.actor.name || pair.actor.username,
				actorPersona: pair.actor.persona,
				actorHistory: formatActorHistoryPrompt(await pair.actor.getHistory(args.questionId)),
				targetIdeaTitle: pair.target.title,
				targetIdeaContent: pair.target.content
			}))
		);

		const fallbackDecisions = batch.map((_, index) => ({
			index,
			value: Math.random() > 0.3 ? 'support' : 'oppose'
		}));

		const llm = await requestJsonDecision(
			[
				{
					role: 'system',
					content:
						`You are simulating multiple participants voting on proposals for: "${args.questionTitle}"\n` +
						(args.questionContext ? `Context: ${args.questionContext.slice(0, 400)}\n\n` : '\n') +
						'For each actor and their assigned target idea, decide if they would "support", "neutral", or "oppose" it based on their persona and history.\n' +
						'Return only JSON: {"decisions": [{"index": 0, "value": "support"}, ...]}'
				},
				{
					role: 'user',
					content: JSON.stringify({
						evaluations: pairContexts
					})
				}
			],
			{ decisions: fallbackDecisions }
		);

		const decisions = Array.isArray(llm.payload.decisions)
			? llm.payload.decisions
			: fallbackDecisions;
		const batchResults = new Map<number, 'support' | 'neutral' | 'oppose'>();
		for (const decision of decisions) {
			const idx = Number((decision as Record<string, unknown>).index);
			const value = String((decision as Record<string, unknown>).value ?? '')
				.trim()
				.toLowerCase();
			if (!isNaN(idx) && (value === 'support' || value === 'neutral' || value === 'oppose')) {
				batchResults.set(idx, value as 'support' | 'neutral' | 'oppose');
			}
		}

		// Ensure all batch actors have a result (fallback for any missing)
		for (let j = 0; j < batch.length; j++) {
			const val = batchResults.get(j);
			if (val) {
				results.push({ value: val, usedFallback: llm.usedFallback });
			} else {
				results.push({
					value: fallbackDecisions[j].value as 'support' | 'oppose',
					usedFallback: true
				});
			}
		}
	}

	return results;
}

async function generateSpectrumPlacementsBatch(args: {
	actors: SimulationUserActor[];
	questionId: string;
	questionTitle: string;
	questionContext?: string;
	proposals: ProposalLight[];
}): Promise<
	Map<
		string,
		{ placements: Array<{ proposal_id: string; position: number }>; usedFallback: boolean }
	>
> {
	const results = new Map<
		string,
		{ placements: Array<{ proposal_id: string; position: number }>; usedFallback: boolean }
	>();

	for (let i = 0; i < args.actors.length; i += DECISION_BATCH_SIZE) {
		const batch = args.actors.slice(i, i + DECISION_BATCH_SIZE);
		const actorContexts = await Promise.all(
			batch.map(async (actor) => ({
				id: actor.id,
				name: actor.name || actor.username,
				persona: actor.persona,
				history: formatActorHistoryPrompt(await actor.getHistory(args.questionId))
			}))
		);

		const fallbackPlacements = batch.map((actor) => ({
			actorId: actor.id,
			placements: args.proposals.map((p) => ({
				proposal_id: p.id,
				position: Math.round((Math.random() * 20 - 10) * 10) / 10
			}))
		}));

		const llm = await requestJsonDecision(
			[
				{
					role: 'system',
					content:
						`You are simulating multiple participants placing proposals on a tension spectrum (-10 to 10) for: "${args.questionTitle}"\n` +
						(args.questionContext ? `Context: ${args.questionContext.slice(0, 400)}\n\n` : '\n') +
						'-10 = strongly disagree/oppose, 10 = strongly agree/support. 0 is neutral.\n' +
						'For each actor, assign positions that reflect their persona, values, and priorities.\n' +
						'Return only JSON: {"decisions": [{"actorId": "...", "placements": [{"proposal_id": "...", "position": 2.5}]}]}'
				},
				{
					role: 'user',
					content: JSON.stringify({
						actors: actorContexts,
						proposals: args.proposals.map((p) => ({ id: p.id, title: p.title }))
					})
				}
			],
			{ decisions: fallbackPlacements }
		);

		const decisions = Array.isArray(llm.payload.decisions)
			? llm.payload.decisions
			: fallbackPlacements;
		for (const decision of decisions) {
			const d = decision as Record<string, unknown>;
			const actorId = String(d.actorId ?? '').trim();
			const rawPlacements = Array.isArray(d.placements) ? d.placements : [];
			if (actorId && rawPlacements.length > 0) {
				const placements = rawPlacements
					.map((p) => {
						const pl = p as Record<string, unknown>;
						return {
							proposal_id: String(pl.proposal_id ?? '').trim(),
							position: Math.max(-10, Math.min(10, Number(pl.position ?? 0)))
						};
					})
					.filter((p) => p.proposal_id);
				if (placements.length > 0) {
					results.set(actorId, { placements, usedFallback: llm.usedFallback });
				}
			}
		}

		// Ensure all batch actors have a result
		for (const actor of batch) {
			if (!results.has(actor.id)) {
				results.set(actor.id, {
					placements: args.proposals.map((p) => ({
						proposal_id: p.id,
						position: Math.round(Math.random() * 100 * 100) / 100
					})),
					usedFallback: true
				});
			}
		}
	}

	return results;
}

async function generateBallotRankingsBatch(args: {
	actors: Array<{ actor: SimulationUserActor; proposalIds: string[] }>;
	questionId: string;
	questionTitle: string;
	questionContext?: string;
	proposalIndex: Map<string, { id: string; title: string }>;
}): Promise<Map<string, { ranked: string[]; usedFallback: boolean }>> {
	const results = new Map<string, { ranked: string[]; usedFallback: boolean }>();

	for (let i = 0; i < args.actors.length; i += DECISION_BATCH_SIZE) {
		const batch = args.actors.slice(i, i + DECISION_BATCH_SIZE);
		const actorContexts = await Promise.all(
			batch.map(async (entry) => ({
				id: entry.actor.id,
				name: entry.actor.name || entry.actor.username,
				persona: entry.actor.persona,
				history: formatActorHistoryPrompt(await entry.actor.getHistory(args.questionId)),
				proposals: entry.proposalIds
					.map((id) => args.proposalIndex.get(id))
					.filter(Boolean)
					.map((s) => ({ id: s!.id, title: s!.title }))
			}))
		);

		const fallbackRankings = batch.map((entry) => ({
			actorId: entry.actor.id,
			ranked: shuffled(entry.proposalIds)
		}));

		const llm = await requestJsonDecision(
			[
				{
					role: 'system',
					content:
						`You are simulating multiple participants ranking proposals by preference for: "${args.questionTitle}"\n` +
						(args.questionContext ? `Context: ${args.questionContext.slice(0, 400)}\n\n` : '\n') +
						'For each actor, rank their assigned proposals from most to least preferred based on their persona.\n' +
						'Return only JSON: {"decisions": [{"actorId": "...", "ranked": ["proposalId1", "proposalId2", ...]}]}'
				},
				{
					role: 'user',
					content: JSON.stringify({ actors: actorContexts })
				}
			],
			{ decisions: fallbackRankings }
		);

		const decisions = Array.isArray(llm.payload.decisions)
			? llm.payload.decisions
			: fallbackRankings;
		for (const decision of decisions) {
			const d = decision as Record<string, unknown>;
			const actorId = String(d.actorId ?? '').trim();
			const ranked = Array.isArray(d.ranked)
				? d.ranked.map((id) => String(id).trim()).filter(Boolean)
				: [];
			if (actorId && ranked.length > 0) {
				results.set(actorId, { ranked, usedFallback: llm.usedFallback });
			}
		}

		// Ensure all batch actors have a result
		for (const entry of batch) {
			if (!results.has(entry.actor.id)) {
				results.set(entry.actor.id, { ranked: shuffled(entry.proposalIds), usedFallback: true });
			}
		}
	}

	return results;
}

async function runLlmGroupAction(args: {
	pb: PocketBase;
	questionId: string;
	questionTitle: string;
	questionContext?: string;
	actionType: GroupActionType;
	occurredAtRaw: string | null;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const actors = await resolveSimulationActors(args.pb, args.userIds, args.userHints, {
		questionTitle: args.questionTitle,
		questionContext: args.questionContext || ''
	});
	if (actors.length === 0) {
		return {
			action: 'runLlmGroupAction',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const occurredAt = parseOccurredAt(args.occurredAtRaw);
	const refs: Array<{ collection: string; id: string }> = [];
	const recordIds: string[] = [];
	let successes = 0;
	let failures = 0;
	let fallbackCount = 0;

	for (let index = 0; index < actors.length; index += 1) {
		const actor = actors[index];
		let actorPb: PocketBase;
		try {
			actorPb = await actor.pb();
		} catch {
			failures += 1;
			continue;
		}

		const proposals = await listQuestionProposals(actorPb, args.questionId);
		const proposed = proposals.filter((proposal) => proposal.state === 'Proposed');
		if (proposed.length === 0) {
			failures += 1;
			continue;
		}

		// Build per-actor system prompt for this action
		let actorSystemPrompt: string | undefined;
		try {
			actorSystemPrompt = await actor.buildSystemPrompt({
				questionId: args.questionId,
				questionTitle: args.questionTitle,
				questionContext: args.questionContext,
				taskInstructions: `You are performing a ${args.actionType} action on the proposed proposals.`
			});
		} catch {
			// Fall back to generic prompts if system prompt building fails
		}

		const targetDecision = await decidePrimaryTarget({
			questionTitle: args.questionTitle,
			user: actor.user,
			action: args.actionType,
			proposals,
			actorSystemPrompt
		});
		if (targetDecision.usedFallback) {
			fallbackCount += 1;
		}

		const timestamp = new Date(Date.parse(occurredAt) + index * 30000).toISOString();

		try {
			if (args.actionType === 'branchProposals') {
				const parent =
					proposed.find((proposal) => proposal.id === targetDecision.primaryId) ?? proposed[0];
				const payload = await generateBranchPayload({
					questionTitle: args.questionTitle,
					parentTitle: parent?.title ?? args.questionTitle,
					parentContent: parent?.content ?? '',
					questionId: args.questionId,
					questionContext: args.questionContext,
					actorName: actor.name,
					actorUsername: actor.username,
					actorPersona: actor.persona,
					variationSeed: index,
					actorSystemPrompt
				});
				if (payload.usedFallback) {
					fallbackCount += 1;
				}
				const created = await actorPb.collection('proposals').create({
					question: args.questionId,
					title: payload.title,
					content: payload.content,
					reason_for_change: payload.reason,
					parent_proposals: parent ? [parent.id] : [],
					occurred_at: timestamp
				});
				const createdId = String(created.id ?? '').trim();
				if (createdId) {
					successes += 1;
					recordIds.push(createdId);
					refs.push({ collection: 'proposals', id: createdId });
					continue;
				}
			}

			if (args.actionType === 'mergeProposals') {
				const first =
					proposed.find((proposal) => proposal.id === targetDecision.primaryId) ??
					proposed[0] ??
					null;
				const second =
					proposed.find((proposal) => proposal.id === targetDecision.secondaryId) ??
					pickRandom(proposed.filter((proposal) => proposal.id !== first?.id));
				if (!first || !second) {
					failures += 1;
					continue;
				}
				const payload = await generateMergePayload({
					questionTitle: args.questionTitle,
					questionContext: args.questionContext,
					firstTitle: first.title,
					firstContent: first.content,
					secondTitle: second.title,
					secondContent: second.content,
					actorName: actor.name,
					actorUsername: actor.username,
					actorPersona: actor.persona,
					actorSystemPrompt
				});
				if (payload.usedFallback) {
					fallbackCount += 1;
				}
				const created = await actorPb.collection('proposals').create({
					question: args.questionId,
					title: payload.title,
					content: payload.content,
					reason_for_change: payload.reason,
					parent_proposals: [first.id, second.id],
					occurred_at: timestamp
				});
				const createdId = String(created.id ?? '').trim();
				if (createdId) {
					successes += 1;
					recordIds.push(createdId);
					refs.push({ collection: 'proposals', id: createdId });
					continue;
				}
			}

			if (args.actionType === 'voteProgress') {
				const target =
					proposed.find((proposal) => proposal.id === targetDecision.primaryId) ??
					pickRandom(proposed);
				if (!target) {
					failures += 1;
					continue;
				}

				try {
					const createdVote = await actorPb.collection('proposal_votes').create({
						user: actor.id,
						proposal: target.id,
						vote: 1,
						occurred_at: timestamp
					});
					const voteId = String(createdVote.id ?? '').trim();
					successes += 1;
					recordIds.push(target.id);
					if (voteId) {
						refs.push({ collection: 'proposal_votes', id: voteId });
					}
					continue;
				} catch {
					const existing = await actorPb
						.collection('proposal_votes')
						.getFirstListItem(
							`proposal = "${escapeFilter(target.id)}" && user = "${escapeFilter(actor.id)}"`
						);
					await actorPb
						.collection('proposal_votes')
						.update(existing.id, { vote: 1, occurred_at: timestamp });
					successes += 1;
					recordIds.push(target.id);
					refs.push({ collection: 'proposal_votes', id: String(existing.id ?? '') });
					continue;
				}
			}

			const target =
				proposed.find((proposal) => proposal.id === targetDecision.primaryId) ??
				pickRandom(proposed);
			if (!target) {
				failures += 1;
				continue;
			}

			const payload = await generateCommentPayload({
				questionTitle: args.questionTitle,
				questionContext: args.questionContext,
				proposalTitle: target.title,
				proposalContent: target.content,
				actorName: actor.name,
				actorUsername: actor.username,
				actorPersona: actor.persona,
				actorSystemPrompt
			});
			if (payload.usedFallback) {
				fallbackCount += 1;
			}
			const comment = await actorPb.collection('proposal_comments').create({
				proposal: target.id,
				content: payload.content,
				occurred_at: timestamp
			});
			const commentId = String(comment.id ?? '').trim();
			if (commentId) {
				successes += 1;
				recordIds.push(commentId);
				refs.push({ collection: 'proposal_comments', id: commentId });
				continue;
			}
		} catch {
			failures += 1;
			continue;
		}

		failures += 1;
	}

	return {
		action: 'runLlmGroupAction',
		ok: successes > 0,
		details: `LLM ${args.actionType} executed for ${successes}/${actors.length} linked user(s). Failed: ${failures}.`,
		recordIds,
		refs,
		usedFallback: fallbackCount > 0
	};
}

export async function simulateBranchProposals(args: {
	pb: PocketBase;
	questionId: string;
	questionTitle: string;
	questionContext?: string;
	countRaw: string | null;
	occurredAtRaw: string | null;
	spreadDaysRaw?: string | null;
	forceRoot?: boolean;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const count = parseCount(args.countRaw, 1, 10);
	const occurredAt = parseOccurredAt(args.occurredAtRaw);
	const spreadMinutes = parseSpreadMinutes(args.spreadDaysRaw ?? null);
	const actors = await resolveSimulationActors(args.pb, args.userIds, args.userHints);
	if (actors.length === 0) {
		return {
			action: 'simulateBranchProposals',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const createdIds: string[] = [];
	const refs: Array<{ collection: string; id: string }> = [];
	let fallbackCount = 0;
	const failures: string[] = [];

	for (let index = 0; index < count; index += 1) {
		try {
			const actor = pickRandom(actors);
			if (!actor) {
				break;
			}

			const actorPb = await actor.pb();
			const proposals = await listQuestionProposals(actorPb, args.questionId);
			const proposed = proposals.filter((proposal) => proposal.state === 'Proposed');
			const parent = args.forceRoot ? null : pickRandom(proposed);
			const payload = await generateBranchPayload({
				questionTitle: args.questionTitle,
				questionContext: args.questionContext,
				parentTitle: parent?.title ?? args.questionTitle,
				parentContent: parent?.content ?? '',
				questionId: args.questionId,
				actorName: actor.name,
				actorUsername: actor.username,
				actorPersona: actor.persona,
				variationSeed: index
			});
			if (payload.usedFallback) {
				fallbackCount += 1;
			}

			const proposedOccurredAt = spreadOccurredAt(occurredAt, spreadMinutes, index, count);
			const occurredAtSafe = ensureAfterParents(proposedOccurredAt, [parent?.occurredAt]);

			const created = await actorPb.collection('proposals').create({
				question: args.questionId,
				title: payload.title,
				content: payload.content,
				reason_for_change: payload.reason,
				parent_proposals: parent ? [parent.id] : [],
				occurred_at: occurredAtSafe
			});
			const createdId = String(created.id ?? '');
			if (!createdId) {
				continue;
			}
			createdIds.push(createdId);
			refs.push({ collection: 'proposals', id: createdId });
		} catch (error) {
			failures.push(pocketbaseErrorMessage(error));
		}
	}

	const uniqueFailures = Array.from(new Set(failures.filter(Boolean))).slice(0, 2);
	const failureText =
		uniqueFailures.length > 0 ? ` Failed sample: ${uniqueFailures.join(' | ')}` : '';

	return {
		action: 'simulateBranchProposals',
		ok: createdIds.length > 0,
		details: args.forceRoot
			? `Created ${createdIds.length} initial proposal(s).${failureText}`
			: `Created ${createdIds.length} branch proposal(s).${failureText}`,
		recordIds: createdIds,
		refs,
		usedFallback: fallbackCount > 0
	};
}

export async function simulateMergeProposals(args: {
	pb: PocketBase;
	questionId: string;
	questionTitle: string;
	questionContext?: string;
	countRaw: string | null;
	occurredAtRaw: string | null;
	spreadDaysRaw?: string | null;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const count = parseCount(args.countRaw, 1, 10);
	const occurredAt = parseOccurredAt(args.occurredAtRaw);
	const spreadMinutes = parseSpreadMinutes(args.spreadDaysRaw ?? null);
	const actors = await resolveSimulationActors(args.pb, args.userIds, args.userHints);
	if (actors.length === 0) {
		return {
			action: 'simulateMergeProposals',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const createdIds: string[] = [];
	const refs: Array<{ collection: string; id: string }> = [];
	let fallbackCount = 0;
	const failures: string[] = [];

	for (let index = 0; index < count; index += 1) {
		try {
			const actor = pickRandom(actors);
			if (!actor) {
				continue;
			}

			const actorPb = await actor.pb();
			const proposals = await listQuestionProposals(actorPb, args.questionId);
			const proposed = proposals.filter((proposal) => proposal.state === 'Proposed');
			if (proposed.length < 2) {
				continue;
			}

			const first = pickRandom(proposed);
			if (!first) {
				continue;
			}
			const second = pickRandom(proposed.filter((proposal) => proposal.id !== first.id));
			if (!second) {
				continue;
			}

			const payload = await generateMergePayload({
				questionTitle: args.questionTitle,
				questionContext: args.questionContext,
				firstTitle: first.title,
				firstContent: first.content,
				secondTitle: second.title,
				secondContent: second.content,
				actorName: actor.name,
				actorUsername: actor.username,
				actorPersona: actor.persona
			});
			if (payload.usedFallback) {
				fallbackCount += 1;
			}

			const proposedOccurredAt = spreadOccurredAt(occurredAt, spreadMinutes, index, count);
			const occurredAtSafe = ensureAfterParents(proposedOccurredAt, [
				first.occurredAt,
				second.occurredAt
			]);

			const created = await actorPb.collection('proposals').create({
				question: args.questionId,
				title: payload.title,
				content: payload.content,
				reason_for_change: payload.reason,
				parent_proposals: [first.id, second.id],
				occurred_at: occurredAtSafe
			});

			const createdId = String(created.id ?? '');
			if (!createdId) {
				continue;
			}
			createdIds.push(createdId);
			refs.push({ collection: 'proposals', id: createdId });
		} catch (error) {
			failures.push(pocketbaseErrorMessage(error));
		}
	}

	const uniqueFailures = Array.from(new Set(failures.filter(Boolean))).slice(0, 2);
	const failureText =
		uniqueFailures.length > 0 ? ` Failed sample: ${uniqueFailures.join(' | ')}` : '';

	return {
		action: 'simulateMergeProposals',
		ok: createdIds.length > 0,
		details: `Created ${createdIds.length} merged proposal(s).${failureText}`,
		recordIds: createdIds,
		refs,
		usedFallback: fallbackCount > 0
	};
}

export async function simulateVotesToProgress(args: {
	pb: PocketBase;
	questionId: string;
	questionTitle?: string;
	questionContext?: string;
	countRaw: string | null;
	occurredAtRaw: string | null;
	spreadDaysRaw?: string | null;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const count = parseCount(args.countRaw, 5, 100);
	const occurredAt = parseOccurredAt(args.occurredAtRaw);
	const spreadMinutes = parseSpreadMinutes(args.spreadDaysRaw ?? null);
	const actors = await resolveSimulationActors(
		args.pb,
		args.userIds,
		args.userHints,
		args.questionTitle
			? {
					questionTitle: args.questionTitle,
					questionContext: args.questionContext || ''
				}
			: undefined
	);
	if (actors.length === 0) {
		return {
			action: 'simulateVotesToProgress',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	// Fetch proposals to vote on
	const proposals = await listQuestionProposals(args.pb, args.questionId);
	// In the Fluid Workspace, agents can vote on any proposal (including Inactive) to dynamically resurrect them
	const votableProposals = proposals.filter((proposal) => proposal.state !== 'FinalWinner');
	if (votableProposals.length === 0) {
		return {
			action: 'simulateVotesToProgress',
			ok: false,
			details: 'No valid proposals to vote on.',
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	// Fetch all existing votes for the question to avoid re-voting on the same ideas
	const allVotes = await args.pb.collection('proposal_votes').getFullList({
		filter: `question = "${escapeFilter(args.questionId)}"`
	});
	const existingVotes = new Set<string>();
	for (const vote of allVotes) {
		existingVotes.add(`${vote.user}:${vote.proposal}`);
	}

	const validPairs: Array<{ actor: SimulationUserActor; target: ProposalLight }> = [];
	for (const actor of actors) {
		for (const target of votableProposals) {
			if (!existingVotes.has(`${actor.id}:${target.id}`)) {
				validPairs.push({ actor, target });
			}
		}
	}

	if (validPairs.length === 0) {
		return {
			action: 'simulateVotesToProgress',
			ok: false,
			details: 'No valid unvoted proposals found for the selected actors.',
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const pairs: Array<{ actor: SimulationUserActor; target: ProposalLight }> = [];
	const numToSample = Math.min(count, validPairs.length);

	for (let i = 0; i < numToSample; i++) {
		const randomIndex = Math.floor(Math.random() * validPairs.length);
		pairs.push(validPairs[randomIndex]);
		// Swap with last element and pop for O(1) removal to prevent duplicate pairs
		validPairs[randomIndex] = validPairs[validPairs.length - 1];
		validPairs.pop();
	}

	// Evaluate votes in batches via LLM
	const evaluatedVotes = await evaluateVotesBatch({
		pairs,
		questionId: args.questionId,
		questionTitle: args.questionTitle || '',
		questionContext: args.questionContext
	});

	const refs: Array<{ collection: string; id: string }> = [];
	let appliedVotes = 0;
	let fallbackCount = 0;

	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i];
		const evalVote = evaluatedVotes[i];

		if (evalVote.usedFallback) {
			fallbackCount += 1;
		}

		const proposedOccurredAt = spreadOccurredAt(occurredAt, spreadMinutes, i, pairs.length);
		const occurredAtSafe = ensureAfterParents(proposedOccurredAt, [pair.target.occurredAt]);

		let actorPb: PocketBase;
		try {
			actorPb = await pair.actor.pb();
		} catch {
			continue;
		}

		try {
			const existing = await actorPb
				.collection('proposal_votes')
				.getFirstListItem(
					`proposal = "${escapeFilter(pair.target.id)}" && user = "${escapeFilter(pair.actor.id)}"`
				)
				.catch(() => null);

			if (existing) {
				await actorPb.collection('proposal_votes').update(existing.id, {
					vote: evalVote.value === 'support' ? 1 : evalVote.value === 'oppose' ? -1 : 0,
					occurred_at: occurredAtSafe
				});
				refs.push({ collection: 'proposal_votes', id: String(existing.id ?? '') });
			} else {
				const createdVote = await actorPb.collection('proposal_votes').create({
					user: pair.actor.id,
					proposal: pair.target.id,
					question: args.questionId,
					vote: evalVote.value === 'support' ? 1 : evalVote.value === 'oppose' ? -1 : 0,
					occurred_at: occurredAtSafe
				});
				refs.push({ collection: 'proposal_votes', id: String(createdVote.id ?? '') });
			}
			appliedVotes += 1;
		} catch (error) {
			console.warn('[simulateVotesToProgress] Failed to apply vote', error);
		}
	}

	return {
		action: 'simulateVotesToProgress',
		ok: appliedVotes > 0,
		details: `Applied ${appliedVotes} vote(s) to proposed proposals.`,
		recordIds: Array.from(new Set(pairs.map((p) => p.target.id))),
		refs,
		usedFallback: fallbackCount > 0
	};
}

/**
 * Simulate users proposing merge proposals between two different proposal trees.
 * Uses the existing generateMergePayload LLM helper to produce realistic merge content.
 */
export async function simulateProposeMerges(args: {
	pb: PocketBase;
	questionId: string;
	questionTitle: string;
	questionContext?: string;
	countRaw: string | null;
	occurredAtRaw?: string | null;
	spreadDaysRaw?: string | null;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const count = parseCount(args.countRaw, 3, 50);
	const occurredAt = parseOccurredAt(args.occurredAtRaw ?? null);
	const spreadMinutes = parseSpreadMinutes(args.spreadDaysRaw ?? null);
	const actors = await resolveSimulationActors(args.pb, args.userIds, args.userHints);
	if (actors.length === 0) {
		return {
			action: 'simulateProposeMerges',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const proposals = await listQuestionProposals(args.pb, args.questionId);
	const proposed = proposals.filter((s) => s.state === 'Proposed');
	if (proposed.length < 2) {
		return {
			action: 'simulateProposeMerges',
			ok: false,
			details: 'Need at least 2 proposed proposals to propose merges.',
			recordIds: [],
			refs: [],
			usedFallback: false
		};
	}

	const refs: Array<{ collection: string; id: string }> = [];
	const recordIds: string[] = [];
	let created = 0;
	let fallbackCount = 0;

	for (let index = 0; index < count; index += 1) {
		const actor = pickRandom(actors);
		if (!actor) continue;

		let actorPb: PocketBase;
		try {
			actorPb = await actor.pb();
		} catch {
			continue;
		}

		// Pick two distinct proposals to merge
		const first = pickRandom(proposed);
		if (!first) continue;

		const second = pickRandom(proposed.filter((s) => s.id !== first.id));
		if (!second) continue;

		try {
			const payload = await generateMergePayload({
				questionTitle: args.questionTitle,
				questionContext: args.questionContext,
				firstTitle: first.title,
				firstContent: first.content,
				secondTitle: second.title,
				secondContent: second.content,
				actorName: actor.name,
				actorUsername: actor.username,
				actorPersona: actor.persona
			});
			if (payload.usedFallback) {
				fallbackCount += 1;
			}

			const proposedOccurredAt = spreadOccurredAt(occurredAt, spreadMinutes, index, count);
			const occurredAtSafe = ensureAfterParents(proposedOccurredAt, [
				first.occurredAt,
				second.occurredAt
			]);

			const mergedProposal = await actorPb.collection('proposals').create({
				question: args.questionId,
				title: payload.title,
				content: payload.content,
				reason_for_change: payload.reason,
				parent_proposals: [first.id, second.id],
				base_parent: first.id,
				occurred_at: occurredAtSafe
			});
			const mergedId = String(mergedProposal.id ?? '');
			if (mergedId) {
				refs.push({ collection: 'proposals', id: mergedId });
				recordIds.push(mergedId);
				created += 1;
			}
		} catch (err) {
			console.warn('[simulateProposeMerges] failed', err);
		}
	}

	return {
		action: 'simulateProposeMerges',
		ok: created > 0 || refs.length > 0,
		details: `Proposed ${created} merge proposal(s) across ${Math.min(count, actors.length)} actor(s).`,
		recordIds,
		refs,
		usedFallback: fallbackCount > 0
	};
}

export async function simulateComments(args: {
	pb: PocketBase;
	questionId: string;
	questionTitle: string;
	questionContext?: string;
	countRaw: string | null;
	occurredAtRaw: string | null;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const count = parseCount(args.countRaw, 3, 30);
	const occurredAt = parseOccurredAt(args.occurredAtRaw);
	const actors = await resolveSimulationActors(args.pb, args.userIds, args.userHints, {
		questionTitle: args.questionTitle,
		questionContext: args.questionContext || ''
	});
	if (actors.length === 0) {
		return {
			action: 'simulateComments',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const commentIds: string[] = [];
	const refs: Array<{ collection: string; id: string }> = [];
	let fallbackCount = 0;

	for (let index = 0; index < count; index += 1) {
		const actor = pickRandom(actors);
		if (!actor) {
			continue;
		}

		let actorPb: PocketBase;
		try {
			actorPb = await actor.pb();
		} catch {
			continue;
		}
		const proposals = await listQuestionProposals(actorPb, args.questionId);
		const proposed = proposals.filter((proposal) => proposal.state === 'Proposed');
		const target = pickRandom(proposed);
		if (!target) {
			continue;
		}

		// Build system prompt for this actor's comment
		let actorSystemPrompt: string | undefined;
		try {
			actorSystemPrompt = await actor.buildSystemPrompt({
				questionId: args.questionId,
				questionTitle: args.questionTitle,
				questionContext: args.questionContext,
				taskInstructions: 'You are writing a constructive comment on a proposed proposal.'
			});
		} catch {
			// Fall back to generic prompts
		}

		const payload = await generateCommentPayload({
			questionTitle: args.questionTitle,
			questionContext: args.questionContext,
			proposalTitle: target.title,
			proposalContent: target.content,
			actorName: actor.name,
			actorUsername: actor.username,
			actorPersona: actor.persona,
			actorSystemPrompt
		});
		if (payload.usedFallback) {
			fallbackCount += 1;
		}

		const comment = await actorPb.collection('proposal_comments').create({
			proposal: target.id,
			content: payload.content,
			occurred_at: new Date(Date.parse(occurredAt) + index * 45000).toISOString()
		});
		const commentId = String(comment.id ?? '');
		if (!commentId) {
			continue;
		}
		commentIds.push(commentId);
		refs.push({ collection: 'proposal_comments', id: commentId });
	}

	return {
		action: 'simulateComments',
		ok: commentIds.length > 0,
		details: `Created ${commentIds.length} comment(s).`,
		recordIds: commentIds,
		refs,
		usedFallback: fallbackCount > 0
	};
}

async function runPlayback(args: {
	pb: PocketBase;
	questionId: string;
	questionTitle: string;
	stepsRaw: string | null;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const steps = parseCount(args.stepsRaw, 6, 25);
	const actionIds: string[] = [];
	const refs: Array<{ collection: string; id: string }> = [];
	let fallbackUsed = false;

	for (let step = 0; step < steps; step += 1) {
		const mode = step % 4;
		if (mode === 0) {
			const result = await simulateBranchProposals({
				pb: args.pb,
				questionId: args.questionId,
				questionTitle: args.questionTitle,
				countRaw: '1',
				occurredAtRaw: new Date(Date.now() + step * 60000).toISOString(),
				userIds: args.userIds,
				userHints: args.userHints
			});
			actionIds.push(...result.recordIds);
			refs.push(...result.refs);
			fallbackUsed = fallbackUsed || result.usedFallback;
			continue;
		}

		if (mode === 1) {
			const result = await simulateMergeProposals({
				pb: args.pb,
				questionId: args.questionId,
				questionTitle: args.questionTitle,
				countRaw: '1',
				occurredAtRaw: new Date(Date.now() + step * 60000).toISOString(),
				userIds: args.userIds,
				userHints: args.userHints
			});
			actionIds.push(...result.recordIds);
			refs.push(...result.refs);
			fallbackUsed = fallbackUsed || result.usedFallback;
			continue;
		}

		if (mode === 2) {
			const result = await simulateVotesToProgress({
				pb: args.pb,
				questionId: args.questionId,
				countRaw: '4',
				occurredAtRaw: new Date(Date.now() + step * 60000).toISOString(),
				userIds: args.userIds,
				userHints: args.userHints
			});
			actionIds.push(...result.recordIds);
			refs.push(...result.refs);
			fallbackUsed = fallbackUsed || result.usedFallback;
			continue;
		}

		const result = await simulateComments({
			pb: args.pb,
			questionId: args.questionId,
			questionTitle: args.questionTitle,
			countRaw: '2',
			occurredAtRaw: new Date(Date.now() + step * 60000).toISOString(),
			userIds: args.userIds,
			userHints: args.userHints
		});
		actionIds.push(...result.recordIds);
		refs.push(...result.refs);
		fallbackUsed = fallbackUsed || result.usedFallback;
	}

	return {
		action: 'runPlayback',
		ok: actionIds.length > 0,
		details: `Playback executed ${steps} step(s).`,
		recordIds: actionIds,
		refs,
		usedFallback: fallbackUsed
	};
}

export async function simulateQuestionActivationVotes(args: {
	pb: PocketBase;
	questionId: string;
	countRaw: string | null;
	occurredAtRaw: string | null;
	spreadDaysRaw?: string | null;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const count = parseCount(args.countRaw, 1, 100);
	const occurredAt = parseOccurredAt(args.occurredAtRaw);
	const spreadMinutes = parseSpreadMinutes(args.spreadDaysRaw ?? null);
	const actors = await resolveSimulationActors(args.pb, args.userIds, args.userHints);
	if (actors.length === 0) {
		return {
			action: 'simulateQuestionActivationVotes',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const refs: Array<{ collection: string; id: string }> = [];
	let appliedVotes = 0;

	// Pick up to `count` random actors
	const selectedActors = [...actors].sort(() => 0.5 - Math.random()).slice(0, count);

	for (const actor of selectedActors) {
		let actorPb: PocketBase;
		try {
			actorPb = await actor.pb();
		} catch {
			continue;
		}

		try {
			const existing = await actorPb
				.collection('question_votes')
				.getFirstListItem(
					`question = "${escapeFilter(args.questionId)}" && user = "${escapeFilter(actor.id)}"`
				)
				.catch(() => null);

			const voteVal = Math.random() < 0.8 ? 1 : 0;
			const proposedOccurredAt = spreadOccurredAt(
				occurredAt,
				spreadMinutes,
				appliedVotes,
				selectedActors.length
			);
			const occurredAtSafe = ensureAfterParents(proposedOccurredAt, []);

			if (existing) {
				await actorPb.collection('question_votes').update(existing.id, {
					vote: voteVal,
					occurred_at: occurredAtSafe
				});
				refs.push({ collection: 'question_votes', id: String(existing.id ?? '') });
			} else {
				const createdVote = await actorPb.collection('question_votes').create({
					user: actor.id,
					question: args.questionId,
					vote: voteVal,
					occurred_at: occurredAtSafe
				});
				refs.push({ collection: 'question_votes', id: String(createdVote.id ?? '') });
			}
			appliedVotes += 1;
		} catch (error) {
			console.warn('[simulateQuestionActivationVotes] Failed to apply vote', error);
		}
	}

	return {
		action: 'simulateQuestionActivationVotes',
		ok: appliedVotes > 0,
		details: `Applied ${appliedVotes} vote(s) to the question.`,
		recordIds: [],
		refs,
		usedFallback: false
	};
}

export async function simulateFinalVotes(args: {
	pb: PocketBase;
	questionId: string;
	questionTitle?: string;
	questionContext?: string;
	countRaw: string | null;
	occurredAtRaw: string | null;
	spreadDaysRaw?: string | null;
	userIds?: string[];
	userHints?: SimUserHint[];
}): Promise<SimActionResult> {
	const count = parseCount(args.countRaw, 5, 300);
	const actors = await resolveSimulationActors(
		args.pb,
		args.userIds,
		args.userHints,
		args.questionTitle
			? {
					questionTitle: args.questionTitle,
					questionContext: args.questionContext || ''
				}
			: undefined
	);
	if (actors.length === 0) {
		return {
			action: 'simulateFinalVotes',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const proposals = await listQuestionProposals(args.pb, args.questionId);
	const votableProposals = proposals.filter((p) => p.state === 'FinalWinner');
	if (votableProposals.length === 0) {
		return {
			action: 'simulateFinalVotes',
			ok: false,
			details: 'No votable proposals found for final ballot.',
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const selectedActors = sampleWithoutReplacement(actors, count);

	const proposalIndex = new Map(
		votableProposals.map((p) => [
			String(p.id ?? ''),
			{ id: String(p.id ?? ''), title: String(p.title ?? '') }
		])
	);
	const proposalIds = votableProposals.map((p) => String(p.id ?? ''));

	const batchArgs = selectedActors.map((actor) => ({
		actor,
		proposalIds
	}));

	const llmResults = await generateBallotRankingsBatch({
		actors: batchArgs,
		questionId: args.questionId,
		questionTitle: args.questionTitle || 'Untitled',
		questionContext: args.questionContext,
		proposalIndex
	});

	let submittedCount = 0;
	let usedFallback = false;
	const recordIds: string[] = [];
	const refs: { collection: string; id: string }[] = [];

	const timestampIso = parseOccurredAt(args.occurredAtRaw);
	const spreadMinutes = parseSpreadMinutes(args.spreadDaysRaw ?? null);

	for (let i = 0; i < selectedActors.length; i++) {
		const actor = selectedActors[i];
		const res = llmResults.get(actor.id);
		const rankedIds = res?.ranked ?? shuffled(proposalIds);
		if (res?.usedFallback) usedFallback = true;

		const ranks = rankedIds.map((pid, idx) => ({ proposalId: pid, rank: idx + 1 }));

		let existingId: string | null = null;
		try {
			const existing = await args.pb
				.collection('ballot_responses')
				.getFirstListItem(
					`user = "${escapeFilter(actor.id)}" && question = "${escapeFilter(args.questionId)}"`
				);
			existingId = String(existing.id ?? '');
		} catch (e) {
			// Not found
		}

		const payload = { user: actor.id, question: args.questionId, ranks };
		try {
			if (existingId) {
				await args.pb.collection('ballot_responses').update(existingId, payload);
				recordIds.push(existingId);
				refs.push({ collection: 'ballot_responses', id: existingId });
			} else {
				const created = await args.pb.collection('ballot_responses').create(payload);
				recordIds.push(String(created.id ?? ''));
				refs.push({ collection: 'ballot_responses', id: String(created.id ?? '') });
			}

			const eventTimeIso = spreadOccurredAt(timestampIso, spreadMinutes, i, selectedActors.length);
			await args.pb.collection('action_logs').create({
				question: args.questionId,
				user: actor.id,
				action_type: 'ballot_submit',
				metadata_json: { ranks_count: ranks.length, is_update: !!existingId },
				occurred_at: eventTimeIso
			});

			submittedCount++;
		} catch (error) {
			console.warn('[simulateFinalVotes] Failed to submit ballot for actor', actor.id, error);
		}
	}

	return {
		action: 'simulateFinalVotes',
		ok: submittedCount > 0,
		details: `Simulated ${submittedCount} final ballots.`,
		recordIds,
		refs,
		usedFallback
	};
}

export async function simulateAbstentions(args: {
	pb: PocketBase;
	questionId: string;
	countRaw: string | null;
	occurredAtRaw: string | null;
	spreadDaysRaw?: string | null;
	userIds?: string[];
}): Promise<SimActionResult> {
	const count = parseCount(args.countRaw, 5, 300);
	const actors = await resolveSimulationActors(args.pb, args.userIds);
	if (actors.length === 0) {
		return {
			action: 'simulateAbstentions',
			ok: false,
			details: noSimulationUsersDetails(args.userIds),
			recordIds: [],
			refs: [],
			usedFallback: true
		};
	}

	const selectedActors = sampleWithoutReplacement(actors, count);

	let submittedCount = 0;
	const recordIds: string[] = [];
	const refs: { collection: string; id: string }[] = [];

	const timestampIso = parseOccurredAt(args.occurredAtRaw);
	const spreadMinutes = parseSpreadMinutes(args.spreadDaysRaw ?? null);

	for (let i = 0; i < selectedActors.length; i++) {
		const actor = selectedActors[i];
		const ranks = [{ proposalId: 'abstain', rank: 0 }];

		let existingId: string | null = null;
		try {
			const existing = await args.pb
				.collection('ballot_responses')
				.getFirstListItem(
					`user = "${escapeFilter(actor.id)}" && question = "${escapeFilter(args.questionId)}"`
				);
			existingId = String(existing.id ?? '');
		} catch (e) {
			// Not found
		}

		const payload = { user: actor.id, question: args.questionId, ranks };
		try {
			if (existingId) {
				await args.pb.collection('ballot_responses').update(existingId, payload);
				recordIds.push(existingId);
				refs.push({ collection: 'ballot_responses', id: existingId });
			} else {
				const created = await args.pb.collection('ballot_responses').create(payload);
				recordIds.push(String(created.id ?? ''));
				refs.push({ collection: 'ballot_responses', id: String(created.id ?? '') });
			}

			const eventTimeIso = spreadOccurredAt(timestampIso, spreadMinutes, i, selectedActors.length);
			await args.pb.collection('action_logs').create({
				question: args.questionId,
				user: actor.id,
				action_type: 'ballot_abstain',
				metadata_json: { ranks_count: ranks.length, is_update: !!existingId },
				occurred_at: eventTimeIso
			});

			submittedCount++;
		} catch (error) {
			console.warn('[simulateAbstentions] Failed to submit abstention for actor', actor.id, error);
		}
	}

	return {
		action: 'simulateAbstentions',
		ok: submittedCount > 0,
		details: `Simulated ${submittedCount} explicit abstentions.`,
		recordIds,
		refs,
		usedFallback: false
	};
}
