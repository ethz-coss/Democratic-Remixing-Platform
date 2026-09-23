/**
 * proposalCardData.ts
 *
 * Shared adapter that maps a raw ProposalRecord + render context into
 * ProposalCard props. Call this once in each parent component to ensure
 * consistent prop computation across all card contexts (feed, DAG, ballot,
 * ancestry trail, etc.).
 */

export interface ProposalCardContext {
	/** Map of proposalId → user's vote value (1 = supported, 0 = not voted) */
	userVotes?: Record<string, number>;
	/** Set of proposal IDs the current user has already viewed */
	seenProposalIds?: Set<string>;
	/** Map of proposalId → number of child improvements created since user's vote */
	unseenImprovements?: Record<string, number>;
	/** Total active participant count (for support % calculation) */
	totalUsers?: number;
	/** Map of primary_label → cluster metadata */
	clusters?: Map<string, { short_name: string; color: string }>;
	/** All label records for the current question */
	labels?: App.LabelRecord[];
	/** Current user's PocketBase ID */
	userId?: string;
	/** Whether new proposals can be created (controls compare button visibility) */
	creationEnabled?: boolean;
}

export interface ProposalCardBaseProps {
	proposal: App.ProposalRecord;
	isSeen: boolean;
	unseenImprovementCount: number;
	userVote: number;
	isAuthored: boolean;
	isChampion: boolean;
	isSynthesis: boolean;
	poolStatus: 'winner' | 'focus' | 'none';
	clusterColor: string | undefined;
	clusterTitle: string | undefined;
	/** For combined/synthesis nodes: colors of all parent clusters */
	crossClusterColors: string[] | undefined;
	/** All active labels for this proposal */
	activeLabels?: Array<{ id: string; short_name: string; color: string }>;
	subscriptionCount: number;
	/** 0–100 support percentage for progress bar */
	barPct: number;
	/** reason_for_change text — differentiator in ancestry trail */
	differentiator: string | undefined;
	creationEnabled: boolean;
}

export function toCardProps(
	proposal: App.ProposalRecord,
	context: ProposalCardContext
): ProposalCardBaseProps {
	const vote = context.userVotes?.[proposal.id] ?? 0;
	const cluster = context.clusters?.get(proposal.primary_label ?? '');

	// For synthesis/combined proposals, try to gather parent cluster colors
	const crossClusterColors =
		proposal.parent_proposals && proposal.parent_proposals.length > 1
			? proposal.parent_proposals
					.map((key: string) => context.clusters?.get(key)?.color)
					.filter((c: string | undefined): c is string => Boolean(c))
			: undefined;

	const poolStatus: 'winner' | 'focus' | 'none' =
		proposal.state === 'FinalWinner' ? 'winner' : proposal.in_focus ? 'focus' : 'none';

	const activeLabels = (proposal.labels || [])
		.map((id) => context.labels?.find((l) => l.id === id))
		.filter((l): l is App.LabelRecord => Boolean(l))
		.map((l) => ({ id: l.id, short_name: l.short_name, color: l.color }));

	return {
		proposal,
		isSeen: context.seenProposalIds?.has(proposal.id) ?? true,
		unseenImprovementCount: context.unseenImprovements?.[proposal.id] ?? 0,
		userVote: vote,
		isAuthored: proposal.author === context.userId,
		isChampion: proposal.is_champion,
		isSynthesis: proposal.parent_proposals && proposal.parent_proposals.length > 1,
		poolStatus,
		clusterColor: cluster?.color,
		clusterTitle: cluster?.short_name,
		crossClusterColors,
		activeLabels,
		subscriptionCount: proposal.subscription_count,
		barPct:
			context.totalUsers && context.totalUsers > 0
				? Math.min(100, Math.round((proposal.subscription_count / context.totalUsers) * 100))
				: 0,
		differentiator: proposal.reason_for_change || undefined,
		creationEnabled: context.creationEnabled ?? true
	};
}
