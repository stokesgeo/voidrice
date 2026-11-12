// PROPOSAL: seed absent native settings; never merge, read, or replace existing choices.
import { constants, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function seedSettings(seed, destination) {
	// mode applies only to newly created directories; do not chmod existing paths.
	mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
	try {
		// Exclusive copy also preserves existing symlinks and a concurrent writer.
		copyFileSync(seed, destination, constants.COPYFILE_EXCL);
		return "seeded";
	} catch (error) {
		if (error.code === "EEXIST") return "preserved";
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const home = homedir();
	const result = seedSettings(join(home, ".local/share/openbsd/pi/settings.json"),
		join(home, ".pi/agent/settings.json"));
	console.log(`Pi native settings: ${result}.`);
}
