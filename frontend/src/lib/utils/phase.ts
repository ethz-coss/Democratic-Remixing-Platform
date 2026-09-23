/**
 * Checks whether the adding of remixes (editing/improving/combining) is allowed
 * for the current question phase.
 * Remixing is only enabled during the 'AnswerSearch' phase.
 *
 * @param phaseName The current phase name of the question
 * @returns boolean true if remixing is allowed, false otherwise
 */
export function isRemixingEnabled(phaseName: string): boolean {
	return phaseName === 'AnswerSearch';
}
