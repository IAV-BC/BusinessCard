// Available profiles will be discovered automatically. Start empty and populate
// at runtime so adding a new file into /profiles is sufficient (when the
// server allows directory listings) or when an index file is provided.
let availableProfiles = [];

// Cache for loaded profiles
const profilesCache = {};

// Try to auto-discover profile JSON files. First attempt to load
// /profiles/index.json (which can be committed for servers that disable
// directory listing). If that fails, fetch the /profiles/ directory and
// parse the returned HTML for .json links (works with python's http.server
// and many simple servers).
async function loadAvailableProfiles() {
	try {
		// 1) Try explicit index file
		const idx = await fetch('profiles/index.json');
		if (idx.ok) {
			const list = await idx.json();
			if (Array.isArray(list)) {
				availableProfiles = list;
				return availableProfiles;
			}
		}

		// 2) Try directory listing parsing
		const dir = await fetch('profiles/');
		if (!dir.ok) return availableProfiles;
		const html = await dir.text();
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, 'text/html');
		const anchors = Array.from(doc.querySelectorAll('a'));
		const jsonFiles = anchors.map(a => a.getAttribute('href')).filter(h => h && h.toLowerCase().endsWith('.json'));
		// Normalize to the file basename without extension (e.g. 'john.json' -> 'john')
		availableProfiles = jsonFiles.map(f => {
			const parts = String(f).split('/').filter(Boolean);
			const basename = parts.pop();
			return basename.replace(/\.json$/i, '');
		});
		return availableProfiles;
	} catch (err) {
		console.warn('Failed to auto-detect profiles:', err);
		return availableProfiles;
	}
}

// Ensure profiles are loaded (idempotent)
async function ensureProfilesLoaded() {
	if (availableProfiles.length) return availableProfiles;
	return await loadAvailableProfiles();
}
