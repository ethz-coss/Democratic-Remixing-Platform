import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const parentData = await parent();
	const question = parentData.question;
	let groupName: string | undefined;

	if (question.group) {
		try {
			const groupRecord = await locals.pb.collection('groups').getOne(question.group, {
				fields: 'name'
			});
			groupName = groupRecord.name;
		} catch (e) {
			// ignore error if group not found or inaccessible
		}
	}

	return { groupName };
};
