<script lang="ts">
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { localizePath } from '$lib/utils/i18n-path.js';
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';

	let locale = $derived(getLocale());

	const content = {
		en: {
			title: 'Study Survey',
			description: 'Thank you for testing our platform! Your feedback is extremely valuable.',
			reminder:
				'Note: Please fill this out once you feel you have explored the platform sufficiently. You do not need to fill it out immediately upon entering the app.',
			susTitle: 'System Usability Scale',
			susText: 'Scale: 1 = Strongly Disagree to 5 = Strongly Agree',
			sus: [
				'I think that I would like to use this system frequently.',
				'I found the system unnecessarily complex.',
				'I thought the system was easy to use.',
				'I think that I would need the support of a technical person to be able to use this system.',
				'I found the various functions in this system were well integrated.',
				'I thought there was too much inconsistency in this system.',
				'I would imagine that most people would learn to use this system very quickly.',
				'I found the system very cumbersome to use.',
				'I felt very confident using the system.',
				'I needed to learn a lot of things before I could get going with this system.'
			],
			qualTitle: 'Qualitative Feedback',
			qual: [
				{
					id: 'building_on_ideas',
					label: '1. Building on Ideas',
					desc: 'Did the platform make it easy for you to build upon ("remix") other people’s proposals? Please explain your experience.'
				},
				{
					id: 'convergence_process',
					label: '2. Convergence Process',
					desc: 'How did your group move from many proposals to one final idea? Which platform features or interaction steps helped (or hindered) convergence?'
				},
				{
					id: 'finding_quality',
					label: '3. Finding Quality',
					desc: 'How did you decide your ranking, selection, or point distribution when choosing "high quality" ideas? Did the system make this easy?'
				},
				{
					id: 'fairness_legitimacy',
					label: '4. Fairness & Legitimacy',
					desc: 'Do you feel the final solutions fairly represent the group’s input? Why or why not?'
				},
				{
					id: 'improvements',
					label: '5. Improvements',
					desc: 'What features do you wish the platform had? How would you improve the tool?'
				}
			],
			submit: 'Submit Survey',
			submitting: 'Submitting...'
		},
		de: {
			title: 'Studienumfrage',
			description:
				'Vielen Dank, dass Sie unsere Plattform getestet haben! Ihr Feedback ist sehr wertvoll.',
			reminder:
				'Hinweis: Bitte füllen Sie dies aus, sobald Sie das Gefühl haben, die Plattform ausreichend erkundet zu haben. Sie müssen die Umfrage nicht sofort beim ersten Öffnen der App ausfüllen.',
			susTitle: 'System Usability Scale',
			susText: 'Skala: 1 = Stimme überhaupt nicht zu bis 5 = Stimme voll zu',
			sus: [
				'Ich denke, dass ich das System gerne häufig benutzen würde.',
				'Ich fand das System unnötig komplex.',
				'Ich fand das System einfach zu bedienen.',
				'Ich glaube, ich würde die Hilfe einer technisch versierten Person benötigen, um das System bedienen zu können.',
				'Ich fand, die verschiedenen Funktionen in diesem System waren gut integriert.',
				'Ich denke, das System enthielt zu viele Inkonsistenzen.',
				'Ich kann mir vorstellen, dass die meisten Menschen den Umgang mit diesem System sehr schnell lernen.',
				'Ich fand das System sehr umständlich zu bedienen.',
				'Ich fühlte mich bei der Benutzung des Systems sehr sicher.',
				'Ich musste eine Menge Dinge lernen, bevor ich anfangen konnte, das System zu bedienen.'
			],
			qualTitle: 'Qualitatives Feedback',
			qual: [
				{
					id: 'building_on_ideas',
					label: '1. Auf Ideen aufbauen',
					desc: 'Hat es die Plattform Ihnen leicht gemacht, auf den Vorschlägen anderer aufzubauen ("remixen")? Bitte erklären Sie Ihre Erfahrung.'
				},
				{
					id: 'convergence_process',
					label: '2. Konvergenzprozess',
					desc: 'Wie ist Ihre Gruppe von vielen Vorschlägen zu einer finalen Idee gelangt? Welche Plattformfunktionen oder Interaktionsschritte haben die Konvergenz unterstützt (oder behindert)?'
				},
				{
					id: 'finding_quality',
					label: '3. Qualität finden',
					desc: 'Wie haben Sie Ihre Rangfolge, Auswahl oder Punkteverteilung entschieden, als Sie "hochwertige" Ideen ausgewählt haben? Hat das System dies erleichtert?'
				},
				{
					id: 'fairness_legitimacy',
					label: '4. Fairness & Legitimität',
					desc: 'Haben Sie das Gefühl, dass die finale Lösung den Input der Gruppe fair repräsentieren? Warum oder warum nicht?'
				},
				{
					id: 'improvements',
					label: '5. Verbesserungen',
					desc: 'Welche Funktionen wünschen Sie sich für die Plattform? Wie würden Sie das Tool verbessern?'
				}
			],
			submit: 'Umfrage absenden',
			submitting: 'Wird gesendet...'
		}
	};

	let t = $derived(content[locale as 'en' | 'de'] || content.en);

	let { form } = $props();

	let loading = $state(false);
	let formData = $state<Record<string, any>>({});

	$effect(() => {
		if (browser) {
			const saved = localStorage.getItem('post_study_survey');
			if (saved) {
				try {
					formData = JSON.parse(saved);
				} catch (e) {
					console.error('Failed to parse survey data from localStorage', e);
				}
			}
		}
	});

	$effect(() => {
		if (browser) {
			localStorage.setItem('post_study_survey', JSON.stringify(formData));
		}
	});

	$effect(() => {
		if (browser && form?.success) {
			localStorage.removeItem('post_study_survey');
			formData = {};
		}
	});
</script>

<div class="survey-page">
	<div class="survey-container">
		<h1>{t.title}</h1>
		<p class="description">{t.description}</p>
		{#if form?.success}
			<div class="success-message">
				<h3>Thank you / Vielen Dank!</h3>
				<p>Your responses have been saved.</p>
				<a href={localizePath('/discourse')} class="back-link">Return to Home</a>
			</div>
		{:else}
			<p class="reminder">{t.reminder}</p>
			<form
				method="POST"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						await update();
						loading = false;
					};
				}}
			>
				<div class="section">
					<h2>{t.susTitle}</h2>
					<p class="help-text">{t.susText}</p>
					<div class="sus-questions">
						{#each t.sus as question, i}
							<div class="sus-item">
								<p class="sus-q-text">{i + 1}. {question}</p>
								<div class="sus-options">
									{#each [1, 2, 3, 4, 5] as val}
										<label class="sus-option">
											<input
												type="radio"
												name="sus_{i + 1}"
												value={val}
												required
												bind:group={formData[`sus_${i + 1}`]}
											/>
											<span>{val}</span>
										</label>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>

				<div class="section">
					<h2>{t.qualTitle}</h2>
					{#each t.qual as q}
						<div class="form-group">
							<label for={q.id}>{q.label}</label>
							<p class="help-text">{q.desc}</p>
							<textarea id={q.id} name={q.id} rows="4" bind:value={formData[q.id]}></textarea>
						</div>
					{/each}
				</div>

				{#if form?.error}
					<div class="error">{form.error}</div>
				{/if}

				<div class="actions">
					<button type="submit" disabled={loading} class="submit-btn">
						{loading ? t.submitting : t.submit}
					</button>
				</div>
			</form>
		{/if}
	</div>
</div>

<style>
	.survey-page {
		padding: 2rem 1rem;
		max-width: 800px;
		margin: 0 auto;
	}
	.survey-container {
		background: var(--paper, #fff);
		padding: 2rem;
		border-radius: 8px;
		border: 1px solid var(--line, #ddd);
	}
	h1 {
		margin-top: 0;
	}
	.description {
		color: var(--muted, #666);
		margin-bottom: 1rem;
	}
	.reminder {
		font-size: 0.9rem;
		font-weight: 500;
		color: #eab308;
		margin-bottom: 2rem;
		padding: 0.75rem;
		background: #fefce8;
		border-left: 4px solid #eab308;
		border-radius: 4px;
	}
	.section {
		margin-top: 2.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--line, #ddd);
	}
	.help-text {
		color: var(--muted, #666);
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}
	.sus-item {
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 6px;
	}
	.sus-q-text {
		font-weight: 500;
		margin-bottom: 0.5rem;
	}
	.sus-options {
		display: flex;
		gap: 1rem;
	}
	.sus-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		cursor: pointer;
	}
	.form-group {
		margin-bottom: 1.5rem;
	}
	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}
	textarea {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 6px;
		resize: vertical;
	}
	.submit-btn {
		background: var(--ink, #111);
		color: #fff;
		border: none;
		padding: 0.75rem 2rem;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
	}
	.submit-btn:disabled {
		opacity: 0.7;
	}
	.error {
		color: #ef4444;
		margin-bottom: 1rem;
	}
	.success-message {
		text-align: center;
		padding: 3rem 0;
	}
	.back-link {
		display: inline-block;
		margin-top: 1rem;
		color: #0284c7;
		text-decoration: none;
	}
</style>
