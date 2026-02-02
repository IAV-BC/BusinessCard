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
            // normalize path: absolute if needed
            const src = (/^https?:\/\//i.test(p.image) || p.image.startsWith('/')) ? p.image : `/${p.image}`;
            const img = new Image();
            img.src = src;
            img.onload = () => console.debug('Preloaded image', src);
            img.onerror = () => console.warn('Failed to preload image', src);
        });
    }
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
                        p ? `<li><a href="#${availableProfiles[idx]}">${p.name} - ${p.title}</a></li>` : ''
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
                        p ? `<li><a href="#${availableProfiles[idx]}">${p.name} - ${p.title}</a></li>` : ''
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
    const imgSrc = profile.image ? (
        (/^https?:\/\//i.test(profile.image) || profile.image.startsWith('/')) ? profile.image : `/${profile.image}`
    ) : null;
    
    container.innerHTML = `
        <div class="card-simple">
            <!-- Logo & Header -->
            <div class="header-simple text-center">
                <img src="logo.png" alt="IAV Logo" class="logo-simple">
                <h3 class="institute-title">Hassan II Institute of Agronomy and Veterinary Medicine</h3>
                <p class="institute-title-ar">معهد الحسن الثاني للزراعة و البيطرة</p>
            </div>

            <!-- Profile Image & Name -->
            <div class="profile-simple text-center">
                ${imgSrc ? `
                    <img src="${imgSrc}" alt="${profile.name}" class="profile-pic">
                ` : ''}
                <h1 class="profile-name">${profile.name}</h1>
                ${profile.nameAr ? `<p class="profile-name-ar">${profile.nameAr}</p>` : ''}
                <p class="profile-title">${profile.title}</p>
                ${profile.titleAr ? `<p class="profile-title-ar">${profile.titleAr}</p>` : ''}
            </div>

            <!-- Contact Information -->
            <div class="contacts-simple">
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

    let profileId = getProfileFromURL();
    
    // If we got a path but it's not a direct profile ID, try to map it
    if (profileId && !availableProfiles.includes(profileId)) {
        profileId = await getProfileIdFromPath(profileId);
    }
    
    await renderCard(profileId);
});

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
