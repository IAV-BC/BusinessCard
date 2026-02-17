// Get profile ID from URL hash or path
function getProfileFromURL() {
    // Check for hash first (#director)
    const hash = window.location.hash.substring(1);
    if (hash) return hash;
    
    // Check for path (/director)
    const path = window.location.pathname;
    // Remove trailing slash and get the last segment
    const cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
    const lastSegment = cleanPath.split('/').pop();
    
    // Only return if it's not empty, not index.html, and not a common file
    if (lastSegment && lastSegment !== 'index.html' && !lastSegment.includes('.')) {
        return lastSegment;
    }
    
    return null;
}

// Load a profile JSON by id (with simple in-memory cache). Returns null on error.
async function loadProfile(id) {
    // profilesCache is defined in profiles.js
    if (typeof profilesCache !== 'undefined' && profilesCache[id]) return profilesCache[id];

    try {
        const res = await fetch(`profiles/${id}.json`);
        if (!res.ok) {
            console.warn('Failed to fetch profile', id, res.status);
            return null;
        }
        const data = await res.json();
        if (typeof profilesCache !== 'undefined') profilesCache[id] = data;
        return data;
    } catch (err) {
        console.warn('Error loading profile', id, err);
        return null;
    }
}

// Map a custom path segment (e.g. 'director' or '/director') to a profile ID from
// `availableProfiles`. This will load each profile and compare the stored `path`
// or a normalized version of the name if needed. Returns the matching profile ID
// or null when no match is found.
async function getProfileIdFromPath(segment) {
    if (!segment) return null;
    const normalized = segment.replace(/^\/+/, '').replace(/\.(html|htm)$/i, '');

    // Direct id match
    if (typeof availableProfiles !== 'undefined' && availableProfiles.includes(normalized)) {
        return normalized;
    }

    if (typeof availableProfiles === 'undefined') return null;

    // Try to find by the profile's declared `path` or by a slugified name
    for (const id of availableProfiles) {
        const p = await loadProfile(id);
        if (!p) continue;

        // compare declared path (remove leading slash)
        if (p.path) {
            const pPath = String(p.path).replace(/^\/+/, '').replace(/\/(?:index\.html)?$/, '');
            if (pPath === normalized) return id;
            // also support matching with or without the leading slash
            if (`/${pPath}` === normalized || pPath === `/${normalized}`) return id;
        }

        // fallback: compare a slug of the name
        if (p.name) {
            const slug = String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            if (slug === normalized.toLowerCase()) return id;
        }
    }

    return null;
}

// Preload profile images for all discovered profiles to make profile open faster.
// This launches loads in parallel but does not block rendering.
async function preloadProfileImages() {
    if (!Array.isArray(availableProfiles) || availableProfiles.length === 0) return;

    // Load profiles in parallel but limit to reasonable concurrency to avoid
    // overwhelming the network. We'll batch them in chunks of 8.
    const chunkSize = 8;
    for (let i = 0; i < availableProfiles.length; i += chunkSize) {
        const chunk = availableProfiles.slice(i, i + chunkSize);
        const promises = chunk.map(id => loadProfile(id).catch(() => null));
        const profiles = await Promise.all(promises);

        profiles.forEach(p => {
            if (!p || !p.image) return;
            // Build asset URL using site base so it works on GitHub Pages and local server
            const src = getAssetUrl(p.image);

            // Add a <link rel="preload" as="image"> to hint the browser to prioritize
            try {
                const selector = `link[rel="preload"][href="${src}"]`;
                if (!document.querySelector(selector)) {
                    const link = document.createElement('link');
                    link.rel = 'preload';
                    link.as = 'image';
                    link.href = src;
                    document.head.appendChild(link);
                }
            } catch (err) {
                // ignore and continue
            }

            const img = new Image();
            img.src = src;
            img.onload = () => console.debug('✓ Preloaded image:', src);
            img.onerror = () => {
                console.error(
                    '%c✗ Image Load Error', 'color: red; font-weight: bold',
                    '\nFailed to load image at:\n' + src +
                    '\n\nPossible causes:\n' +
                    '• Image path in JSON uses leading slash (/persons/...)\n' +
                    '• File does not exist in persons/ folder\n' +
                    '• GitHub Pages base path incorrect\n\n' +
                    'Fix: Ensure JSON files use relative paths like "persons/profile.png"\n' +
                    'Current base path detected:', getBasePath()
                );
            };
        });
    }
}

// Compute the site's base path (pathname without filename) with leading and trailing slash.
function getBasePath() {
    // 1) Use <base href="..."> if present
    try {
        const baseEl = document.querySelector('base[href]');
        if (baseEl) {
            const href = baseEl.getAttribute('href') || '/';
            const url = new URL(href, window.location.href);
            let path = url.pathname;
            if (!path.endsWith('/')) path += '/';
            console.debug('[getBasePath] Using <base href>:', path);
            return path;
        }
    } catch (e) {
        console.debug('[getBasePath] <base> detection failed:', e.message);
    }

    // 2) Try to infer the base from the current script URL (app.js)
    try {
        const scripts = Array.from(document.getElementsByTagName('script'));
        for (const s of scripts) {
            const src = s.getAttribute('src') || '';
            if (src && (src.includes('app.js') || src.includes('profiles.js'))) {
                const url = new URL(src, window.location.href);
                let path = url.pathname;
                // remove filename portion
                if (path.lastIndexOf('/') >= 0) {
                    path = path.substring(0, path.lastIndexOf('/') + 1);
                }
                if (!path.endsWith('/')) path += '/';
                console.debug('[getBasePath] From script src:', src, '→', path);
                return path;
            }
        }
    } catch (e) {
        console.debug('[getBasePath] Script detection failed:', e.message);
    }

    // 3) GitHub Pages detection: if hostname is .github.io, extract repo from pathname
    try {
        const pathname = window.location.pathname || '/';
        const hostname = window.location.hostname || '';
        if (hostname.includes('.github.io')) {
            const parts = pathname.split('/').filter(Boolean);
            if (parts.length > 0) {
                const basePath = '/' + parts[0] + '/';
                console.debug('[getBasePath] GitHub Pages detected. Pathname:', pathname, '→ basePath:', basePath);
                return basePath;
            }
        }
    } catch (e) {
        console.debug('[getBasePath] GitHub Pages detection failed:', e.message);
    }

    // 4) Fallback to pathname behavior
    let basePath = window.location.pathname || '/';
    if (basePath.indexOf('.') !== -1) {
        basePath = basePath.substring(0, basePath.lastIndexOf('/') + 1);
    }
    if (!basePath.startsWith('/')) basePath = '/' + basePath;
    if (!basePath.endsWith('/')) basePath += '/';
    console.debug('[getBasePath] Fallback pathname:', basePath);
    return basePath;
}

// Build an absolute URL for site assets (images etc.) that works on GitHub Pages
// and local servers. If the path is already absolute (http(s)), return it.
function getAssetUrl(assetPath) {
    if (!assetPath) return assetPath;
    if (/^https?:\/\//i.test(assetPath)) return assetPath;
    // If assetPath already starts with the base path, return origin + assetPath
    const basePath = getBasePath();
    if (assetPath.startsWith(basePath)) return window.location.origin + assetPath;
    // Strip any leading slash and join with basePath
    const clean = assetPath.replace(/^\/+/, '');
    return window.location.origin + basePath + clean;
}

// Escape HTML for safe attribute/text usage
function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return map[char] || char;
    });
}

// Deterministic hash to pick a fallback avatar variation
function hashString(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

const FALLBACK_PREFIXES = [
    'pr', 'pr.', 'prof', 'prof.', 'professeur', 'professor',
    'dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.'
];

const FALLBACK_PALETTES = [
    { bg: '#f3f7ff', accent: '#1a5d3a' },
    { bg: '#fff5f6', accent: '#c41e3a' },
    { bg: '#f4f8f2', accent: '#2f7a4d' },
    { bg: '#f7f5ff', accent: '#4c4fb0' }
];

function getInitials(name) {
    const raw = String(name || '').trim();
    if (!raw) return '??';
    const parts = raw.split(/\s+/).filter(Boolean);

    // Drop known prefixes (e.g., Pr., Prof., Dr.) from the front
    while (parts.length && FALLBACK_PREFIXES.includes(parts[0].toLowerCase())) {
        parts.shift();
    }

    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();

    const first = parts[0].charAt(0).toUpperCase();
    const last = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${first}.${last}`;
}

function getFallbackAvatarHtml(profileId, profileName) {
    const seed = String(profileId || profileName || 'profile');
    const hash = hashString(seed);
    const palette = FALLBACK_PALETTES[hash % FALLBACK_PALETTES.length];
    const label = escapeHtml(profileName || 'Profile');
    const initials = escapeHtml(getInitials(profileName));

    return `
        <div class="profile-fallback" style="--fallback-bg:${palette.bg}; --fallback-accent:${palette.accent};" role="img" aria-label="${label}">
            <div class="profile-fallback-inner">
                <span class="profile-fallback-text">${initials}</span>
            </div>
        </div>
    `;
}

// Generate basic vCard content (CRLF-separated), no photo
function generateVCard(profile) {
    const CRLF = '\r\n';
    const emails = Array.isArray(profile.email) ? profile.email : [profile.email];
    const emailLines = emails.map((email, idx) =>
        `EMAIL;TYPE=${idx === 0 ? 'WORK,PREF' : 'HOME'}:${email}`
    ).join(CRLF);

    const phones = Array.isArray(profile.phone) ? profile.phone : [profile.phone];
    const phoneLines = phones.map((phone, idx) =>
        `TEL;TYPE=${idx === 0 ? 'WORK,PREF' : 'CELL'}:${phone}`
    ).join(CRLF);

    // N: family;given;additional;prefix;suffix - try to split name reasonably
    let nField = '';
    if (profile.name) {
        const parts = profile.name.trim().split(/\s+/);
        const given = parts.shift() || '';
        const family = parts.length ? parts.pop() : '';
        const additional = parts.join(' ');
        nField = `N:${family};${given};${additional};;`;
    }

    const parts = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${profile.name || ''}`,
        nField,
        `TITLE:${profile.title || ''}`,
        'ORG:Hassan II Institute of Agronomy and Veterinary Medicine',
    ];

    if (phoneLines) parts.push(phoneLines);
    if (emailLines) parts.push(emailLines);
    parts.push(`URL:https://${profile.website || ''}`);
    parts.push(`ADR:;;${profile.location || ''}`);
    parts.push('END:VCARD');

    return parts.filter(Boolean).join(CRLF);
}



// Generate vCard data URL (sync, without photo)
function getVCardUrl(profile) {
    const vcard = generateVCard(profile);
    return 'data:text/vcard;charset=utf-8,' + encodeURIComponent(vcard);
}

// Create vCard Blob
function getVCardBlob(profile) {
    const vcard = generateVCard(profile);
    return new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
}

// Open vCard to add to contacts (best-effort across platforms)
async function openVCard(profile) {
    const blob = getVCardBlob(profile);
    const filename = `${profile.name.replace(/\s+/g, '_')}.vcf`;

    // IE / Edge (legacy) - prompts to open with associated app
    if (navigator.msSaveOrOpenBlob) {
        navigator.msSaveOrOpenBlob(blob, filename);
        return;
    }

    // Try Web Share API with files (supported on some desktop/mobile browsers)
    try {
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
            await navigator.share({ files: [file], title: `Add ${profile.name}`, text: `Import contact for ${profile.name}` });
            return;
        }
    } catch (e) {
        console.warn('Web Share failed or unavailable:', e);
    }

    // Try to open a blob URL in a new tab/window - some systems will hand off to the contacts app
    const url = URL.createObjectURL(blob);

    // Create a temporary anchor without download attribute so the browser may open it with the default app
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    // Note: we intentionally do NOT set a.download so the OS/browser can decide how to handle the .vcf
    try {
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        console.error('Opening vCard blob URL failed:', err);
        alert('Unable to open vCard automatically. Use the "download .vcf" link below to save and open it manually.');
    }

    // Revoke the object URL shortly after
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Render business card
async function renderCard(profileId) {
    const container = document.getElementById('card-container');
    // Build a base path for pretty URLs (origin + base path without filename)
    const origin = window.location.origin;
    let basePath = window.location.pathname || '/';
    if (basePath.indexOf('.') !== -1) {
        basePath = basePath.substring(0, basePath.lastIndexOf('/') + 1);
    }
    if (!basePath.endsWith('/')) basePath += '/';
    const shareBase = `${origin}${basePath}`;
    
    if (!profileId) {
        // Load all profiles to show names
        const profilePromises = availableProfiles.map(id => loadProfile(id));
        const loadedProfiles = await Promise.all(profilePromises);
        
        container.innerHTML = `
            <div class="error-message">
                <h2>Select a Profile</h2>
                <p>Available profiles:</p>
                <ul class="profile-list">
                    ${loadedProfiles.map((p, idx) => 
                        p ? `<li><div><a href="#${availableProfiles[idx]}">${p.name} - ${p.title}</a></div><div><button class="profile-copy-icon" data-id="${availableProfiles[idx]}" title="Copy profile link" onclick="copyProfileLink('${availableProfiles[idx]}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 14a3 3 0 0 1 0-4l4-4a3 3 0 0 1 4 4l-1 1" stroke="#1a5d3a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></li>` : ''
                    ).join('')}
                </ul>
            </div>
        `;
        return;
    }

    const profile = await loadProfile(profileId);

    if (!profile) {
        // Load all profiles to show names
        const profilePromises = availableProfiles.map(id => loadProfile(id));
        const loadedProfiles = await Promise.all(profilePromises);
        
        container.innerHTML = `
            <div class="error-message">
                <h2>Profile Not Found</h2>
                <p>The profile you're looking for doesn't exist.</p>
                <p>Available profiles:</p>
                <ul class="profile-list">
                    ${loadedProfiles.map((p, idx) => 
                        p ? `<li><div><a href="#${availableProfiles[idx]}">${p.name} - ${p.title}</a></div><div><button class="profile-copy-icon" data-id="${availableProfiles[idx]}" title="Copy profile link" onclick="copyProfileLink('${availableProfiles[idx]}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 14a3 3 0 0 1 0-4l4-4a3 3 0 0 1 4 4l-1 1" stroke="#1a5d3a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></li>` : ''
                    ).join('')}
                </ul>
            </div>
        `;
        return;
    }

    // Render the business card
    const emails = Array.isArray(profile.email) ? profile.email : (profile.email ? [profile.email] : []);
    const phones = Array.isArray(profile.phone) ? profile.phone : (profile.phone ? [profile.phone] : []);

    // Debug: show loaded contact arrays
    console.debug('renderCard:', profileId, { phones, emails });

    // Build consistent HTML for lists of contacts (joined with a separator)
    const emailHtml = emails.map((email) => `
                        <a href="mailto:${email}" class="contact-text contact-link">${email}</a>
                    `).join(' &nbsp; - &nbsp; ');

    const phoneHtml = phones.map((phone) => `
                        <a href="tel:${phone.replace(/\s/g, '')}" class="contact-text contact-link">${phone}</a>
                    `).join(' &nbsp; - &nbsp; ');
    // Normalize image path so it works whether using hash routing (#id) or
    // direct path routes (/profile). If the configured path is relative (no
    // leading slash), make it absolute from site root.
    const imgSrc = profile.image ? getAssetUrl(profile.image) : null;
    const avatarHtml = imgSrc
        ? `<img src="${imgSrc}" alt="${escapeHtml(profile.name)}" class="profile-pic">`
        : getFallbackAvatarHtml(profileId, profile.name);
    
    // Use iavTitle and iavTitleAr from JSON for the IAV header, fallback to defaults if not present
    const iavTitle = profile.iavTitle || 'Hassan II Institute of Agronomy and Veterinary Medicine';
    const iavTitleAr = profile.iavTitleAr || 'معهد الحسن الثاني للزراعة و البيطرة';
    const iavTitleHtml = `
        <h3 class=\"institute-title\">${iavTitle}</h3>
        <p class=\"institute-title-ar\">${iavTitleAr}</p>
    `;
    container.innerHTML = `
        <div class=\"card-simple\">\n            <!-- Logo & Header -->\n            <div class=\"header-simple text-center\">\n                <img src=\"logo.png\" alt=\"IAV Logo\" class=\"logo-simple\">\n                ${iavTitleHtml}\n            </div>
            <!-- ...existing code... -->

            <!-- Profile Image & Name -->
            <div class="profile-simple text-center">
                <div class="profile-avatar">
                    ${avatarHtml}
                </div>
                <h1 class="profile-name">${profile.name}</h1>
                ${profile.nameAr ? `<p class="profile-name-ar">${profile.nameAr}</p>` : ''}
                <p class="profile-title">${profile.title}</p>
                ${profile.titleAr ? `<p class="profile-title-ar">${profile.titleAr}</p>` : ''}
            </div>

            <!-- Contact Information -->
            <div class="contacts-simple">
                
                <!-- Phone -->
                ${phones.length > 0 ? `
                <div class="contact-line">
                    <i class="fas fa-phone"></i>
                    <div>
                        ${phoneHtml}
                    </div>
                </div>
                ` : ''}

                <!-- Email -->
                ${emails.length > 0 ? `
                <div class="contact-line">
                    <i class="fas fa-envelope"></i>
                    <div>
                        ${emailHtml}
                    </div>
                </div>
                ` : ''}

                

                <!-- Website -->
                ${profile.website ? `
                <div class="contact-line">
                    <i class="fas fa-globe"></i>
                    <a href="https://${profile.website}" target="_blank" rel="noopener" class="contact-text contact-link">${profile.website}</a>
                </div>
                ` : ''}
                <!-- Address -->
                ${profile.location ? `
                <div class="contact-line">
                    <i class="fas fa-map-pin"></i>
                    <div>
                        <p class="contact-text">${profile.location}</p>
                        ${profile.locationAr ? `<p class="contact-text-ar">${profile.locationAr}</p>` : ''}
                    </div>
                </div>
                ` : ''}

            </div>

            <!-- Add to Contacts Button -->
            <div class="text-center mt-3 mb-2">
                <button class="btn-add-contact btn-add-contact--red" onclick="window.openCurrentVCard()" aria-label="Add to Contacts">
                    <!-- Simple outlined plus icon (white) -->
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="btn-add-text">Add to Contacts</span>
                </button>
               
            </div>
        </div>
    `;

    // Update page title
    document.title = `${profile.name} - IAV Hassan II`;

    // If image fails to load, swap in a clean fallback avatar
    const img = container.querySelector('.profile-pic');
    if (img) {
        img.addEventListener('error', () => {
            const avatar = container.querySelector('.profile-avatar');
            if (avatar) {
                avatar.innerHTML = getFallbackAvatarHtml(profileId, profile.name);
            }
        }, { once: true });
    }
    
    // Make open function available globally
    window.openCurrentVCard = () => openVCard(profile);
    // Make download fallback available globally
    window.downloadCurrentVCard = () => {
        try {
            const vcard = generateVCard(profile);
            console.log('vCard content:\n', vcard);
            const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
            const filename = `${profile.name.replace(/\s+/g, '_')}.vcf`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (err) {
            console.error('Download fallback failed', err);
            alert('Failed to prepare vCard for download. See console for details.');
        }
    };
}



// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Ensure the list of available profiles is loaded (auto-discovery)
    if (typeof ensureProfilesLoaded === 'function') await ensureProfilesLoaded();

    // Start preloading profile images in background (non-blocking)
    if (typeof preloadProfileImages === 'function') preloadProfileImages();

    let profileId = getProfileFromURL();
    
    // If we got a path but it's not a direct profile ID, try to map it
    if (profileId && !availableProfiles.includes(profileId)) {
        profileId = await getProfileIdFromPath(profileId);
    }
    
    await renderCard(profileId);
});

// Copy profile hash URL (#id) to clipboard and show a toast message
async function copyProfileLink(id) {
    try {
        const origin = window.location.origin;
        const base = getBasePath();
        const url = `${origin}${base}#${id}`;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
        } else {
            const ta = document.createElement('textarea');
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }

        showToast('Link copied to clipboard');
    } catch (err) {
        console.error('Copy failed', err);
        showToast('Failed to copy link');
    }
}

// Simple toast utility
function showToast(message, duration = 1800) {
    let toast = document.querySelector('.site-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'site-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// Handle browser navigation (back/forward)
window.addEventListener('popstate', async () => {
    if (typeof ensureProfilesLoaded === 'function') await ensureProfilesLoaded();
    let profileId = getProfileFromURL();
    
    // If we got a path but it's not a direct profile ID, try to map it
    if (profileId && !availableProfiles.includes(profileId)) {
        profileId = await getProfileIdFromPath(profileId);
    }
    
    await renderCard(profileId);
});
