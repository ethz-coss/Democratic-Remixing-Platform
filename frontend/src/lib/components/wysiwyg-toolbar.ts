import type { Editor } from '@tiptap/core';
import * as m from '$lib/paraglide/messages.js';

export interface ToolbarButtonConfig {
	label: string;
	title: string;
	action: () => void;
	isActive: () => boolean;
}

export function createToolbarButtons(getEditor: () => Editor | null): ToolbarButtonConfig[] {
	return [
		{
			label: 'B',
			title: m.editor_toolbar_bold(),
			action: () => getEditor()?.chain().focus().toggleBold().run(),
			isActive: () => getEditor()?.isActive('bold') ?? false
		},
		{
			label: 'I',
			title: m.editor_toolbar_italic(),
			action: () => getEditor()?.chain().focus().toggleItalic().run(),
			isActive: () => getEditor()?.isActive('italic') ?? false
		},
		{
			label: 'H1',
			title: m.editor_toolbar_h1(),
			action: () => getEditor()?.chain().focus().toggleHeading({ level: 1 }).run(),
			isActive: () => getEditor()?.isActive('heading', { level: 1 }) ?? false
		},
		{
			label: 'H2',
			title: m.editor_toolbar_h2(),
			action: () => getEditor()?.chain().focus().toggleHeading({ level: 2 }).run(),
			isActive: () => getEditor()?.isActive('heading', { level: 2 }) ?? false
		},
		{
			label: '\u2022 List',
			title: m.editor_toolbar_bullet_list(),
			action: () => getEditor()?.chain().focus().toggleBulletList().run(),
			isActive: () => getEditor()?.isActive('bulletList') ?? false
		},
		{
			label: '1. List',
			title: m.editor_toolbar_ordered_list(),
			action: () => getEditor()?.chain().focus().toggleOrderedList().run(),
			isActive: () => getEditor()?.isActive('orderedList') ?? false
		},
		{
			label: '</>',
			title: m.editor_toolbar_code_block(),
			action: () => getEditor()?.chain().focus().toggleCodeBlock().run(),
			isActive: () => getEditor()?.isActive('codeBlock') ?? false
		},
		{
			label: '"',
			title: m.editor_toolbar_blockquote(),
			action: () => getEditor()?.chain().focus().toggleBlockquote().run(),
			isActive: () => getEditor()?.isActive('blockquote') ?? false
		}
	];
}
