/**
 * Returns true if `s` looks like a PocketBase auto-generated record ID.
 * PocketBase v0.39 IDs are exactly 15 lowercase-alphanumeric characters.
 * We use this to distinguish existing label IDs from new label text strings
 * so that label text that happens to be 15 chars long is not misidentified.
 */
function _looksLikePbId(s: string): boolean {
	return /^[a-z0-9]{15}$/.test(s);
}

export interface LabelActionInput {
	parentCount: number;
	labelStr: string;
	title: string;
	parentLabels: string[][];
	parentPrimaryLabels: string[];
}

export interface LabelActionResult {
	shouldCreateLabel: boolean;
	newLabelShortName: string | null;
	resolvedLabels: (newLabelId?: string) => string[];
	resolvedPrimaryLabel: (newLabelId?: string) => string | null;
}

export function enforceLabelRules(input: LabelActionInput): LabelActionResult {
	const trimmedLabel = input.labelStr.trim();
	const trimmedTitle = input.title.trim();
	
	const allInheritedLabels = new Set<string>();
	input.parentLabels.forEach(labels => {
		labels.forEach(l => {
			if (l) allInheritedLabels.add(l);
		});
	});

	if (input.parentCount === 0) {
		let newLabelName = trimmedLabel;
		if (!newLabelName) {
			newLabelName = trimmedTitle.substring(0, 40);
		}

		const isExistingId = _looksLikePbId(newLabelName);

		return {
			shouldCreateLabel: !isExistingId,
			newLabelShortName: !isExistingId ? newLabelName : null,
			resolvedLabels: (newLabelId) => {
				const result = newLabelId ? [newLabelId] : (isExistingId ? [newLabelName] : []);
				if (result.length === 0) throw new Error("Validation Error: Every proposal must have at least one label.");
				return result;
			},
			resolvedPrimaryLabel: (newLabelId) => newLabelId || (isExistingId ? newLabelName : null)
		};
	}



	const isExistingId = trimmedLabel.length > 0 && _looksLikePbId(trimmedLabel);
	const shouldCreate = trimmedLabel.length > 0 && !isExistingId;
	
	return {
		shouldCreateLabel: shouldCreate,
		newLabelShortName: shouldCreate ? trimmedLabel : null,
		resolvedLabels: (newLabelId) => {
			const finalLabels = new Set(allInheritedLabels);
			if (shouldCreate && newLabelId) {
				finalLabels.add(newLabelId);
			} else if (isExistingId) {
                finalLabels.add(trimmedLabel);
            }
			
			const result = Array.from(finalLabels);
			if (result.length === 0) {
				throw new Error("Validation Error: Every proposal must have at least one label.");
			}
			return result;
		},
		resolvedPrimaryLabel: (newLabelId) => {
			if (shouldCreate && newLabelId) {
				return newLabelId;
			} else if (isExistingId) {
                return trimmedLabel;
            }
			return input.parentPrimaryLabels[0] || null;
		}
	};
}
