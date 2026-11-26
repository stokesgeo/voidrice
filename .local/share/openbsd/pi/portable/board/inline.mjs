// Ordinary-Pi integration. Explicit instance options, never process.env writes.
import { readFileSync, lstatSync, mkdirSync } from "node:fs";
import { assertCompatibility } from "./compatibility.mjs";
import { join, parse } from "node:path";

const instance = JSON.parse(readFileSync(new URL('./instance.json', import.meta.url), 'utf8'));
export function privateRoot(home, selectedRoot = instance.boardRoot) {
	if (!home.startsWith("/") || /[\r\n]/.test(home) || home.split("/").includes("..")) throw Error("Invalid Board home");
	const root = selectedRoot;
	if (!root.startsWith("/") || /[\r\n]/.test(root) || root.split("/").includes("..")) throw Error("Invalid Board root");
	let current = parse(root).root;
	const parts = root.slice(current.length).split("/").filter(Boolean);
	for (let i = 0; i < parts.length; i++) {
		current = join(current, parts[i]);
		let st;
		try { st = lstatSync(current); }
		catch (error) {
			if (error.code !== "ENOENT") throw error;
			mkdirSync(current, { mode: 0o700 });
			st = lstatSync(current);
		}
		if (!st.isDirectory() || st.isSymbolicLink()) throw Error(`Board root: not a real directory: ${current}`);
		if (i === parts.length - 1) {
			if (st.uid !== process.getuid() || (st.mode & 0o7777) !== 0o700) throw Error(`Board root must be owned by you with mode 0700: ${current}`);
		} else if ((st.uid !== 0 && st.uid !== process.getuid()) || ((st.mode & 0o022) && !(st.uid === 0 && (st.mode & 0o1000)))) {
			throw Error(`Board root: unsafe parent: ${current}`);
		}
	}
	return root;
}

export function inlineOptions(home, inherited = process.env, hostPackage, hostEntry = process.argv[1], options = instance) {
	// The bridge supplies the host-mapped public getPackageDir(), not Board's SDK copy.
	if (!hostPackage) throw Error("Board inline requires loaded Pi package identity");
	const { cli } = assertCompatibility(home, { hostPackage, hostEntry, runtimeRoot: options.runtimeRoot });
	const root = privateRoot(home, options.boardRoot);
	const env = { ...inherited };
	// Do not propagate the standalone trial's discovery suppression or fallback knobs.
	for (const key of Object.keys(env)) if (key.startsWith("AGENT_BOARD_") || key.startsWith("AGENT_VIEW_")) delete env[key];
	Object.assign(env, {
		PI_CODING_AGENT_DIR: options.agentDir, PI_CODING_AGENT_SESSION_DIR: options.sessionDir,
		VERTRICE_WORK_DIR: options.workDir, PI_CA_RUNTIME: options.runtimeRoot,
		AGENT_BOARD_ROOT: root, AGENT_BOARD_COMPACT: "1", AGENT_BOARD_REQUIRE_PTY: "1",
		AGENT_BOARD_DISABLE_ADOPTION: "1", AGENT_BOARD_ATTACH_INPUT_ONLY: "1", AGENT_BOARD_SCREEN_LOG: "off",
		AGENT_BOARD_AUTO_STATE: "off", AGENT_BOARD_AUTO_STATE_MODEL: "off",
		AGENT_BOARD_SUMMARY_MODEL: "off", AGENT_BOARD_TITLE_MODEL: "off",
	});
	return { root, env, inline: true, persistentPeers: true, invocation: {
		piCommand: options.launcher,
		// Normal discovery deliberately retained: children are interactive peer Pi sessions,
		// not the restricted native subagent role. No second -e Board registration.
		piArgsPrefix: [],
	} };
}
