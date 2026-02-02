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

// Map custom path to profile ID
async function getProfileIdFromPath(customPath) {
    // If path already matches a profile ID, return it
    if (availableProfiles.includes(customPath)) {
        return customPath;
    }
    
    // Otherwise, search profiles for matching path
    for (const id of availableProfiles) {
        const profile = await loadProfile(id);
        if (profile && profile.path === '/' + customPath) {
            return id;
        }
    }
    
    return null;
}

// Load profile from JSON file
async function loadProfile(profileId) {
    // Check cache first
    if (profilesCache[profileId]) {
        return profilesCache[profileId];
    }
    
    try {
        const response = await fetch(`profiles/${profileId}.json`);
        if (!response.ok) {
            throw new Error('Profile not found');
        }
        const profile = await response.json();
        profilesCache[profileId] = profile;
        return profile;
    } catch (error) {
        console.error(`Error loading profile ${profileId}:`, error);
        return null;
    }
}

// Generate vCard content
function generateVCard(profile) {
    const emails = Array.isArray(profile.email) ? profile.email : [profile.email];
    const emailLines = emails.map((email, idx) => 
        `EMAIL;TYPE=${idx === 0 ? 'WORK,PREF' : 'HOME'}:${email}`
    ).join('\n');
    
    const phones = Array.isArray(profile.phone) ? profile.phone : [profile.phone];
    const phoneLines = phones.map((phone, idx) => 
        `TEL;TYPE=${idx === 0 ? 'WORK,PREF' : 'CELL'}:${phone}`
    ).join('\n');
    
    return `BEGIN:VCARD
VERSION:3.0
FN:${profile.name}
TITLE:${profile.title}
ORG:Hassan II Institute of Agronomy and Veterinary Medicine
${phoneLines}
${emailLines}
URL:https://${profile.website}
ADR:;;${profile.location}
END:VCARD`;
}

// Download vCard
function downloadVCard(profile) {
    const vcard = generateVCard(profile);
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/vcard;charset=utf-8,' + encodeURIComponent(vcard));
    element.setAttribute('download', `${profile.name.replace(/\s+/g, '_')}.vcf`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
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
                        p ? `<li><a href="${p.path || '#' + availableProfiles[idx]}">${p.name} - ${p.title}</a></li>` : ''
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
                        p ? `<li><a href="${p.path || '#' + availableProfiles[idx]}">${p.name} - ${p.title}</a></li>` : ''
                    ).join('')}
                </ul>
            </div>
        `;
        return;
    }

    // Render the business card
    const emails = Array.isArray(profile.email) ? profile.email : [profile.email];
    const phones = Array.isArray(profile.phone) ? profile.phone : [profile.phone];
    
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
                <img src="${profile.image}" alt="${profile.name}" class="profile-pic">
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
                        ${phones.map((phone, idx) => `
                            <a href="tel:${phone.replace(/\s/g, '')}" class="contact-text contact-link">${phone}</a>${idx < phones.length - 1 ? ' &nbsp; - &nbsp; ' : ''}
                        `).join('')}
                    </div>
                </div>
                ` : ''}

                <!-- Email -->
                ${emails.length > 0 ? `
                <div class="contact-line">
                    <i class="fas fa-envelope"></i>
                    <div>
                        ${emails.map((email, idx) => `
                            <a href="mailto:${email}" class="contact-text contact-link">${email}</a>${idx < emails.length - 1 ? ' &nbsp; - &nbsp; ' : ''}
                        `).join('')}
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
                <button class="btn-add-contact" onclick="window.downloadCurrentVCard()">
                    <i class="fas fa-download"></i> Download vCard (.vcf)
                </button>
            </div>
        </div>
    `;

    // Update page title
    document.title = `${profile.name} - IAV Hassan II`;
    
    // Make download function available globally
    window.downloadCurrentVCard = () => downloadVCard(profile);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    let profileId = getProfileFromURL();
    
    // If we got a path but it's not a direct profile ID, try to map it
    if (profileId && !availableProfiles.includes(profileId)) {
        profileId = await getProfileIdFromPath(profileId);
    }
    
    await renderCard(profileId);
});

// Handle browser navigation (back/forward)
window.addEventListener('popstate', async () => {
    let profileId = getProfileFromURL();
    
    // If we got a path but it's not a direct profile ID, try to map it
    if (profileId && !availableProfiles.includes(profileId)) {
        profileId = await getProfileIdFromPath(profileId);
    }
    
    await renderCard(profileId);
});
