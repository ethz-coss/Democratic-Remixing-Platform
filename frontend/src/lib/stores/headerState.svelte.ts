/**
 * Shared header state store.
 *
 * Child layouts (proposals workspace, question detail page) write into this store
 * on mount/unmount. The root layout reads it to render the correct topbar content.
 */

export type HeaderMode = 'default' | 'question';

interface HeaderState {
	mode: HeaderMode;
	questionTitle: string;
	/** true = burger/menu, false = back-arrow */
	isTabPage: boolean;
	notificationCount: number;
	// Callbacks set by the child layout that owns these panels
	onToggleDrawer: (() => void) | null;
	onToggleNotificationPanel: (() => void) | null;
	onToggleQuestionPanel: (() => void) | null;
	// Whether the question context button should be shown (only in proposals workspace)
	showQuestionPanel: boolean;
	// Whether the compare pool button should be shown (only in proposals workspace)
	showComparePool: boolean;
	// Optional custom back button callback (overrides history.back)
	onBack: (() => void) | null;
	// Whether compare mode is active (hides bell/pool icons and shows close button)
	compareModeActive: boolean;
	onCloseCompare: (() => void) | null;
}

function createHeaderState(): HeaderState {
	let mode = $state<HeaderMode>('default');
	let questionTitle = $state('');
	let isTabPage = $state(true);
	let notificationCount = $state(0);
	let onToggleDrawer = $state<(() => void) | null>(null);
	let onToggleNotificationPanel = $state<(() => void) | null>(null);
	let onToggleQuestionPanel = $state<(() => void) | null>(null);
	let showQuestionPanel = $state(false);
	let showComparePool = $state(false);
	let onBack = $state<(() => void) | null>(null);
	let compareModeActive = $state(false);
	let onCloseCompare = $state<(() => void) | null>(null);

	return {
		get mode() {
			return mode;
		},
		set mode(v) {
			mode = v;
		},
		get questionTitle() {
			return questionTitle;
		},
		set questionTitle(v) {
			questionTitle = v;
		},
		get isTabPage() {
			return isTabPage;
		},
		set isTabPage(v) {
			isTabPage = v;
		},
		get notificationCount() {
			return notificationCount;
		},
		set notificationCount(v) {
			notificationCount = v;
		},
		get onToggleDrawer() {
			return onToggleDrawer;
		},
		set onToggleDrawer(v) {
			onToggleDrawer = v;
		},
		get onToggleNotificationPanel() {
			return onToggleNotificationPanel;
		},
		set onToggleNotificationPanel(v) {
			onToggleNotificationPanel = v;
		},
		get onToggleQuestionPanel() {
			return onToggleQuestionPanel;
		},
		set onToggleQuestionPanel(v) {
			onToggleQuestionPanel = v;
		},
		get showQuestionPanel() {
			return showQuestionPanel;
		},
		set showQuestionPanel(v) {
			showQuestionPanel = v;
		},
		get showComparePool() {
			return showComparePool;
		},
		set showComparePool(v) {
			showComparePool = v;
		},
		get onBack() {
			return onBack;
		},
		set onBack(v) {
			onBack = v;
		},
		get compareModeActive() {
			return compareModeActive;
		},
		set compareModeActive(v) {
			compareModeActive = v;
		},
		get onCloseCompare() {
			return onCloseCompare;
		},
		set onCloseCompare(v) {
			onCloseCompare = v;
		}
	};
}

export const headerState = createHeaderState();
