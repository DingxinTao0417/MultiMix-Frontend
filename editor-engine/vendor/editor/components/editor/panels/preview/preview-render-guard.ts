export async function settlePreviewRender(
	render: Promise<unknown>,
	release: () => void,
	reportFailure: (error: unknown) => void,
): Promise<void> {
	try {
		await render;
	} catch (error) {
		reportFailure(error);
	} finally {
		release();
	}
}
