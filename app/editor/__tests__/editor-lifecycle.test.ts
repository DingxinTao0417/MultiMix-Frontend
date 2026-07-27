import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

function readProjectFile(path: string) {
	return readFileSync(join(root, path), "utf8");
}

describe("embedded editor lifecycle", () => {
	test("releases the editor when its iframe browsing context leaves", () => {
		const view = readProjectFile("app/editor/EditorView.tsx");
		const bootstrap = readProjectFile("editor-engine/vendor/bootstrap.ts");
		const core = readProjectFile("editor-engine/vendor/editor/core/index.ts");

		expect(view).toMatch(
			/window\.addEventListener\("pagehide",\s*disposeEditor\)/,
		);
		expect(view).toMatch(
			/window\.removeEventListener\("pagehide",\s*disposeEditor\)/,
		);
		expect(bootstrap).toContain("export function disposeEditor()");
		expect(bootstrap).toContain("EditorCore.reset()");
		expect(bootstrap).toMatch(/delete\s+\w+\.__editor/);
		expect(core).toContain("disposeEditorResources(instance)");
		expect(core).toMatch(
			/disposeEditorResources\(instance\)[\s\S]*EditorCore\.instance = null/,
		);
	});
});
