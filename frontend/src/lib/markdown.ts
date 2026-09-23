export function stripRichText(content: string): string {
	return content
		.replaceAll(/```[\s\S]*?```/g, ' ')
		.replaceAll(/`([^`]+)`/g, '$1')
		.replaceAll(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replaceAll(/(^|\s)[#>*_~-]{1,3}(?=\s|$)/gm, ' ')
		.replaceAll(/<[^>]+>/g, ' ')
		.replaceAll(/&nbsp;/g, ' ')
		.replaceAll(/&amp;/g, '&')
		.replaceAll(/&lt;/g, '<')
		.replaceAll(/&gt;/g, '>')
		.replaceAll(/&quot;/g, '"')
		.replaceAll(/&#39;/g, "'")
		.replaceAll(/\s+/g, ' ')
		.trim();
}
