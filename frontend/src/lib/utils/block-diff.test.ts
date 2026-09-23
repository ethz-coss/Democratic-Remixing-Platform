import { describe, it, expect } from 'vitest';
import { computeBlockDiff, blockDiff, inlineDiff, structuredInlineDiff } from './block-diff';

describe('computeBlockDiff', () => {
	it('returns empty array when both inputs are empty', () => {
		const result = computeBlockDiff('', '');
		expect(result.blocks).toHaveLength(0);
	});

	it('identifies unchanged blocks', () => {
		const html = '<p>Hello world</p><p>Second paragraph</p>';
		const result = computeBlockDiff(html, html);
		expect(result.blocks).toHaveLength(2);
		expect(result.blocks[0].type).toBe('unchanged');
		expect(result.blocks[1].type).toBe('unchanged');
		expect(result.stats.modified).toBe(0);
	});

	it('identifies added blocks', () => {
		const parent = '<p>Existing paragraph</p>';
		const child = '<p>Existing paragraph</p><p>Brand new paragraph added by remix</p>';
		const result = computeBlockDiff(parent, child);
		expect(result.blocks).toHaveLength(2);
		expect(result.blocks[0].type).toBe('unchanged');
		expect(result.blocks[1].type).toBe('added');
		expect(result.stats.added).toBe(1);
	});

	it('identifies deleted blocks', () => {
		const parent = '<p>Paragraph 1</p><p>Paragraph 2</p>';
		const child = '<p>Paragraph 1</p>';
		const result = computeBlockDiff(parent, child);
		expect(result.blocks).toHaveLength(2);
		expect(result.blocks[0].type).toBe('unchanged');
		expect(result.blocks[1].type).toBe('deleted');
		expect(result.blocks[1].html).toBe('<p>Paragraph 2</p>');
		expect(result.stats.deleted).toBe(1);
	});

	it('identifies modified blocks', () => {
		const parent = '<p>The quick brown fox jumps over the lazy dog</p>';
		const child = '<p>The quick brown cat jumps over the lazy dog</p>';
		const result = computeBlockDiff(parent, child);
		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0].type).toBe('modified');
		expect(result.blocks[0].diffHtml).toContain('fox');
		expect(result.blocks[0].diffHtml).toContain('cat');
		expect(result.stats.modified).toBe(1);
	});

	it('identifies moved blocks', () => {
		const parent = '<p>First paragraph</p><p>Second paragraph</p>';
		const child = '<p>Second paragraph</p><p>First paragraph</p>';
		const result = computeBlockDiff(parent, child);
		expect(result.blocks).toHaveLength(2);
		expect(result.blocks[0].type).toBe('unchanged');
		expect(result.blocks[0].html).toBe('<p>Second paragraph</p>');
		expect(result.blocks[1].type).toBe('moved');
		expect(result.blocks[1].html).toBe('<p>First paragraph</p>');
		expect(result.stats.moved).toBe(1);
	});

	it('preserves HTML formatting in diffHtml', () => {
		const parent = '<p>This is <strong>important</strong> text</p>';
		const child = '<p>This is very <strong>important</strong> text</p>';
		const result = computeBlockDiff(parent, child);
		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0].type).toBe('modified');
		// HTML diff should not break the strong tag
		expect(result.blocks[0].diffHtml).toContain('<strong>important</strong>');
		expect(result.blocks[0].diffHtml).toContain('<ins');
		expect(result.blocks[0].diffHtml).toContain('very');
	});
});

describe('legacy wrappers', () => {
	it('blockDiff marks added blocks', () => {
		const parent = '<p>Existing paragraph</p>';
		const child = '<p>Existing paragraph</p><p>Brand new paragraph</p>';
		const result = blockDiff(parent, child);
		expect(result).toContain('is-modified');
		expect(result).toContain('Existing paragraph');
	});

	it('inlineDiff produces ins/del tags', () => {
		const parent = '<p>The quick brown fox</p>';
		const child = '<p>The quick brown cat</p>';
		const result = inlineDiff(parent, child);
		expect(result).toContain('is-modified');
	});

	it('structuredInlineDiff returns correct totalBlocks', () => {
		const parent = '<p>Same paragraph</p><p>The original second paragraph here</p>';
		const child = '<p>Same paragraph</p><p>A completely different and rewritten replacement</p>';
		const result = structuredInlineDiff(parent, child);
		expect(result.totalBlocks).toBe(2);
		expect(result.firstChangeIndex).toBe(1);
	});
});
