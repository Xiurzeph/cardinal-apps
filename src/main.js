/**
 * Cardinal Address Lookup - Core Logic
 * Focus: PRIN Priority, Candidate Filtering, and System Sharing
 */

import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, deleteDoc, serverTimestamp } from "firebase/firestore";

import './style.css'; 

// --- Firebase Configuration ---
const myFirebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(myFirebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'cardinal-lookup';

// --- State Management ---
let currentUser = null;
let currentBatchId = null; 
let currentBatchSource = 'private'; // 'private' or 'public'
let pendingAction = null; 
let groupedBatch = []; 
let currentTab = 'formatter';
let currentDbSubTab = 'private'; // Sub-navigation inside history tab
let activeShareText = ''; // Temporarily stores text generated for active sharing instance
let activeShareGroupIndex = null; // Tracks index of the active group being shared

// --- Runtime In-Session Memory Caching ---
const addressCache = new Map();

// --- Address Status Management ---
const addressStatuses = new Map(); // Maps address key to status
let addressStatusSaveHandle = null;
let addressStatusSaveTimeout = null;
const ADDRESS_STATUS_SAVE_IDLE_MS = 2000;
const ADDRESS_STATUS_SAVE_FALLBACK_MS = 1000;
// Track last-synced statuses to send only deltas
const lastSyncedStatuses = new Map();
let addressStatusSyncInProgress = false;

const ADDRESS_STATUSES = [
    'home',
    'letter',
    'busy',
    'visited',
    'not home 1',
    'not home 2',
    'not home 3',
    'no soliciting',
    'not trespassing',
    'do not call'
];

function getAddressKey(address, city, zip) {
    return `${address}|${city}|${zip}`;
}

function getStatusStyle(status) {
    switch (status) {
        case 'home':
            return { textColor: 'text-gray-900', bgColor: 'bg-white', strikethrough: false, indicator: '' };
        case 'letter':
            return { textColor: 'text-orange-600', bgColor: 'bg-orange-50', strikethrough: false, indicator: '✉️ Letter' };
        case 'busy':
            return { textColor: 'text-sky-700', bgColor: 'bg-sky-50', strikethrough: false, indicator: '⏳ Busy' };
        case 'visited':
            return { textColor: 'text-teal-700', bgColor: 'bg-teal-50', strikethrough: true, indicator: '👣 Visited' };
        case 'not home 1':
            return { textColor: 'text-gray-900', bgColor: 'bg-yellow-50', strikethrough: false, indicator: '🚪 Not Home 1' };
        case 'not home 2':
            return { textColor: 'text-gray-900', bgColor: 'bg-yellow-100', strikethrough: false, indicator: '🚪 Not Home 2' };
        case 'not home 3':
            return { textColor: 'text-gray-900', bgColor: 'bg-white', strikethrough: false, indicator: '🚪 Not Home 3' };
        case 'no soliciting':
            return { textColor: 'text-orange-600', bgColor: 'bg-orange-50', strikethrough: false, indicator: '⛔ No Soliciting' };
        case 'not trespassing':
            return { textColor: 'text-white', bgColor: 'bg-red-500', strikethrough: true, indicator: '⚠️ Not Trespassing' };
        case 'do not call':
            return { textColor: 'text-white', bgColor: 'bg-red-500', strikethrough: true, indicator: '📞 Do Not Call' };
        default:
            return { textColor: 'text-gray-900', bgColor: 'bg-white', strikethrough: false, indicator: '' };
    }
}

function scheduleAddressStatusSync() {
    if (!currentBatchId) return;

    if (addressStatusSaveHandle) {
        if ('cancelIdleCallback' in window) {
            cancelIdleCallback(addressStatusSaveHandle);
        }
        addressStatusSaveHandle = null;
    }
    if (addressStatusSaveTimeout) {
        clearTimeout(addressStatusSaveTimeout);
        addressStatusSaveTimeout = null;
    }

    const saveFn = async () => {
        addressStatusSaveHandle = null;
        addressStatusSaveTimeout = null;

        if (addressStatusSyncInProgress) return;
        addressStatusSyncInProgress = true;

        try {
            // Compute delta between current statuses and lastSyncedStatuses
            const delta = {};
            for (const [key, val] of addressStatuses.entries()) {
                const last = lastSyncedStatuses.get(key);
                if (last !== val) {
                    // Use dot path to update only this map entry on the document
                    const fieldPath = `addressStatuses.${key}`;
                    delta[fieldPath] = val;
                }
            }

            if (Object.keys(delta).length === 0) {
                addressStatusSyncInProgress = false;
                return;
            }

            // add a timestamp for visibility
            delta['meta.lastStatusSync'] = serverTimestamp();

            const batchRef = doc(getCollectionRef(currentBatchSource), currentBatchId);
            await updateDoc(batchRef, delta);

            // update lastSyncedStatuses
            for (const k of Object.keys(delta)) {
                if (k.startsWith('addressStatuses.')) {
                    const keyName = k.replace('addressStatuses.', '');
                    lastSyncedStatuses.set(keyName, delta[k]);
                }
            }

            showToast('Batch status synced', 'success');
        } catch (err) {
            console.error('Address status sync failed', err);
            showToast('Status sync failed', 'error');
        } finally {
            addressStatusSyncInProgress = false;
        }
    };

    if ('requestIdleCallback' in window) {
        addressStatusSaveHandle = requestIdleCallback(saveFn, { timeout: ADDRESS_STATUS_SAVE_IDLE_MS });
    } else {
        addressStatusSaveTimeout = setTimeout(saveFn, ADDRESS_STATUS_SAVE_FALLBACK_MS);
    }
}

window.cycleAddressStatus = function(full_address, city, zip, event) {
    event.stopPropagation();
    const key = getAddressKey(full_address, city, zip);
    const currentStatus = addressStatuses.get(key) || 'home';
    const currentIndex = ADDRESS_STATUSES.indexOf(currentStatus);
    const nextIndex = (currentIndex + 1) % ADDRESS_STATUSES.length;
    const newStatus = ADDRESS_STATUSES[nextIndex];
    
    addressStatuses.set(key, newStatus);
    
    // Re-render the results to show updated status
    renderResults(groupedBatch);
    
    // Schedule an async sync call to update the saved batch without overwhelming Firestore
    scheduleAddressStatusSync();
    
    // Show toast notification
    showToast(`${full_address} → ${newStatus}`);
};

// --- API Constants ---
const MD_GEODATA_URL = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query";
// Reverted back to the working MultiroleLocator since CompositeLocator is 404 on the new server
const MD_LOCATOR_URL = "https://mdgeodata.md.gov/imap/rest/services/GeocodeServices/MD_MultiroleLocator/GeocodeServer/findAddressCandidates";

// --- Auth State Listener ---
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-content').classList.remove('hidden');
        document.getElementById('user-display').innerText = user.isAnonymous ? "Guest Session" : (user.displayName || "Logged In");
        
        const historyBtn = document.getElementById('btn-tab-database');
        const saveBtn = document.getElementById('btn-save-container');
        
        if (user.isAnonymous) {
            if (historyBtn) historyBtn.classList.add('hidden');
            if (saveBtn) saveBtn.classList.add('hidden');
            if (currentTab === 'database') window.switchTab('formatter');
        } else {
            if (historyBtn) historyBtn.classList.remove('hidden');
        }

        if (currentTab === 'database' && !user.isAnonymous) loadHistory();
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('app-content').classList.add('hidden');
    }
});

/**
 * Utility to chunk array into groups of 5
 */
function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push({
            id: i / size,
            completed: false,
            items: array.slice(i, i + size)
        });
    }
    return result;
}

/**
 * Main execution function with high-performance geocoder in-session caching
 */
async function runLookupAndFormat() {
    const input = document.getElementById('csvInput').value;
    const ownerOccupiedOnly = document.getElementById('chkOwnerOccupied').checked;
    
    if (!input.trim()) return showToast("Please enter at least one address.", "error");
    
    const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const validAddresses = [];
    
    for (let line of lines) {
        if (line.toLowerCase().includes("do not call")) continue;
        let cleanAddr = line.split(/Default|Never visited|\d{2}\/\d{2}\/\d{4}|R-\d+/i)[0].trim();
        cleanAddr = cleanAddr.replace(/^(\d+)([a-zA-Z])/, '$1 $2');
        if (cleanAddr) validAddresses.push({ original: line, cleaned: cleanAddr });
    }

    if (validAddresses.length === 0) return showToast("No valid addresses found.", "error");

    startProgressModal(validAddresses.length);
    const results = [];
    currentBatchId = null;
    addressStatuses.clear(); // Clear previous status mappings for new lookup
    let cachedHits = 0;
    
    for (let i = 0; i < validAddresses.length; i++) {
        const item = validAddresses[i];
        const cacheKey = item.cleaned.toUpperCase().trim();
        updateProgress(i + 1, validAddresses.length, item.cleaned);
        
        try {
            let result = null;
            // Check session runtime cache first to safeguard API quotas
            if (addressCache.has(cacheKey)) {
                result = addressCache.get(cacheKey);
                cachedHits++;
            } else {
                result = await fetchPropertyData(item.cleaned);
                if (result) {
                    addressCache.set(cacheKey, result);
                }
            }

            if (result) {
                const isOwnerOcc = result.raw_ooi && result.raw_ooi.includes("H");
                if (!ownerOccupiedOnly || (ownerOccupiedOnly && isOwnerOcc)) {
                    results.push({
                        full_address: result.address_full,
                        city: result.city,
                        zip: result.zip,
                        occupancy: isOwnerOcc ? "Owner" : "Rental/Other",
                        sdat_url: result.sdat_url
                    });
                }
            }
        } catch (err) { console.error(err); }
    }

    groupedBatch = chunkArray(results, 5);
    renderResults(groupedBatch);
    hideProgressModal();
    
    if (cachedHits > 0) {
        showToast(`Found ${results.length} properties in ${groupedBatch.length} groups (${cachedHits} served from speed cache).`);
    } else {
        showToast(`Found ${results.length} properties in ${groupedBatch.length} groups.`);
    }
}

/**
 * Queries Maryland iMAP
 * Improvements: Prioritizes PRIN candidates, applies strict JURSCODE filter,
 * and fixes the Tax ID masking issue. Always generates marylandgov.us lookup link.
 */
async function fetchPropertyData(addressStr) {
    try {
        // Step 1: Geocode with local bias
        const biasedSearch = `${addressStr}, Prince George's County, MD`;
        const geocodeParams = new URLSearchParams({ 
            SingleLine: biasedSearch, 
            f: 'json', 
            outSR: 102100,
            outFields: 'County' // Explicitly request the County attribute
        });

        const geoRes = await fetch(`${MD_LOCATOR_URL}?${geocodeParams}`);
        const geoData = await geoRes.json();
        
        // Default to the user's raw input if the geocoder fails us
        let standardizedBase = addressStr.toUpperCase();
        
        if (geoData.candidates && geoData.candidates.length > 0) {
            // PRIORITIZATION LOGIC: Look for PG County in the address string OR the County attribute
            let bestMatch = geoData.candidates.find(c => {
                const addrStr = c.address ? c.address.toUpperCase() : "";
                const countyStr = c.attributes && c.attributes.County ? c.attributes.County.toUpperCase() : "";
                return addrStr.includes("PRINCE GEORGE") || countyStr.includes("PRINCE GEORGE");
            });

            // Only use the geocoder string if we confirmed it belongs to PG County
            if (bestMatch) {
                let addressParts = bestMatch.address.split(',');
                let parsedBase = addressParts[0].trim().toUpperCase();
                
                // Skip 11-digit Tax ID if it appears first
                if (/^\d{10,}$/.test(parsedBase) && addressParts.length > 1) {
                    parsedBase = addressParts[1].trim().toUpperCase();
                }
                standardizedBase = parsedBase;
            }
        }
        
        const addrTokens = standardizedBase.split(/\s+/);
        const num = addrTokens[0];
        const street = addrTokens[1] || '';

        // Strict Wildcard Logic: Prevents "ELM" from bleeding into "ELMHURST"
        let exactWhere = `UPPER(ADDRESS) LIKE '${num}%' AND JURSCODE = 'PRIN'`;
        if (street) {
            exactWhere = `(UPPER(ADDRESS) LIKE '${num} %${street} %' OR UPPER(ADDRESS) LIKE '${num} %${street}') AND JURSCODE = 'PRIN'`;
        }

        // Step 2: Query Property DB with strict PRIN priority
        const queryParams = new URLSearchParams({
            where: exactWhere,
            outFields: 'ADDRESS,OOI,SDATWEBADR,CITY,ZIPCODE',
            f: 'json',
            resultRecordCount: 1
        });

        const propRes = await fetch(`${MD_GEODATA_URL}?${queryParams}`);
        const propData = await propRes.json();

        if (propData.features && propData.features.length > 0) {
            const attr = propData.features[0].attributes;
            return {
                address_full: attr.ADDRESS,
                city: attr.CITY || 'CLINTON', 
                zip: attr.ZIPCODE || '',
                raw_ooi: attr.OOI, 
                // Always construct the direct clickable URL pointing to the marylandgov.us portal
                sdat_url: `https://www.marylandgov.us/property?address=${encodeURIComponent(attr.ADDRESS)}`
            };
        }
    } catch (e) { 
        console.error("Lookup Error: ", e); 
    }
    return null;
}

function renderResults(groups) {
    const canvas = document.getElementById('outputCanvas');
    const saveContainer = document.getElementById('btn-save-container');

    if (groups.length === 0) {
        canvas.innerHTML = `<div class="p-12 text-center text-gray-400 font-medium">No properties found in Prince George's County.</div>`;
        if (saveContainer) saveContainer.classList.add('hidden');
        return;
    }

    let html = '';

    groups.forEach((group, gIdx) => {
        const isDone = group.completed;

        html += `
            <div class="mb-8 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden ${isDone ? 'opacity-50 grayscale' : ''}">
                <div class="bg-gray-50 px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4">
                    <div class="flex items-center gap-3">
                        <span class="bg-cardinal text-white text-[10px] font-black px-2 py-1 rounded uppercase tracking-tighter">Group ${gIdx + 1}</span>
                        <h3 class="text-sm font-bold text-gray-800 ${isDone ? 'line-through' : ''}">${group.items.length} Properties</h3>
                    </div>
                    
                    <div class="flex items-center gap-2">
                        <button onclick="shareGroup(${gIdx})" class="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-blue-100 transition-all ${isDone ? 'pointer-events-none opacity-20' : ''}">
                            Share Group
                        </button>
                        <button onclick="toggleGroupComplete(${gIdx})" class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${isDone ? 'bg-gray-800 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}">
                            ${isDone ? 'Undo' : 'Complete'}
                        </button>
                    </div>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <tbody class="divide-y divide-gray-100">
                            ${group.items.map(item => {
                                const key = getAddressKey(item.full_address, item.city, item.zip);
                                const status = addressStatuses.get(key) || 'home';
                                const styleInfo = getStatusStyle(status);
                                return `
                                    <tr class="${isDone ? 'line-through text-gray-400' : ''} cursor-pointer hover:opacity-80 transition-opacity" onclick="window.cycleAddressStatus('${item.full_address.replace(/'/g, "\\'")}'${', ' + "'" + item.city + "'" + ', ' + "'" + item.zip + "'"}, event)" title="Click to cycle status">
                                        <td class="p-4">
                                            <div class="p-3 rounded-lg ${isDone ? '' : styleInfo.bgColor} ${isDone ? '' : styleInfo.textColor} ${styleInfo.strikethrough ? 'line-through' : ''} transition-all">
                                                <div class="text-sm font-bold">${item.full_address}</div>
                                                <div class="text-[10px] uppercase ${isDone ? 'text-gray-400' : 'text-gray-600'} mt-1">${item.city}, MD ${item.zip}</div>
                                                ${status !== 'home' ? `<div class="text-[9px] font-bold uppercase mt-2 opacity-75">${styleInfo.indicator}</div>` : ''}
                                            </div>
                                        </td>
                                        <td class="p-4">
                                            <span class="px-2 py-0.5 rounded text-[9px] font-black uppercase ${item.occupancy === 'Owner' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}">
                                                ${item.occupancy}
                                            </span>
                                        </td>
                                        <td class="p-4 text-right">
                                            <a href="${item.sdat_url}" target="_blank" class="text-[10px] font-black text-cardinal hover:underline ${isDone ? 'pointer-events-none text-gray-300' : ''}" onclick="event.stopPropagation()">
                                                ProLookup LINK
                                            </a>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });

    canvas.innerHTML = html;
    
    if (saveContainer) {
        if (currentUser && !currentUser.isAnonymous) {
            saveContainer.classList.remove('hidden');
        } else {
            saveContainer.classList.add('hidden');
        }
    }
}

/**
 * Share Group triggers the brand new integrated Share Service Panel
 */
window.shareGroup = function(idx) {
    const group = groupedBatch[idx];
    activeShareGroupIndex = idx; // Save shared index context
    
    // Explicit format matching: correct "Addresses" spelling and "PropLookup:" service prefix
    activeShareText = `Addresses ${idx + 1}:\n` + 
        group.items.map(i => `- ${i.full_address}, ${i.city}, MD ${i.zip}\n  PropLookup: ${i.sdat_url}`).join('\n\n');

    const modal = document.getElementById('share-modal');
    const previewTextarea = document.getElementById('share-preview-text');
    const smsBtn = document.getElementById('share-sms-btn');
    const emailBtn = document.getElementById('share-email-btn');

    if (previewTextarea) {
        previewTextarea.value = activeShareText;
    }

    // Platform-specific SMS Scheme Builder (bulletproof parameters for iOS/Android)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    let smsUrl = '';
    
    if (isIOS) {
        // iOS requires semicolon parameter separation for prefilled body text
        smsUrl = `sms:;body=${encodeURIComponent(activeShareText)}`;
    } else {
        // Android requires standard question mark parameter separation
        smsUrl = `sms:?body=${encodeURIComponent(activeShareText)}`;
    }
    
    if (smsBtn) {
        smsBtn.href = smsUrl;
    }

    if (emailBtn) {
        emailBtn.href = `mailto:?subject=${encodeURIComponent(`Property Group ${idx + 1} Details`)}&body=${encodeURIComponent(activeShareText)}`;
    }

    if (modal) {
        modal.classList.remove('hidden');
    }
};

/**
 * High-reliability copy execution built to bypass iframe and security restrictions
 */
window.copyShareText = function() {
    const previewTextarea = document.getElementById('share-preview-text');
    
    if (!previewTextarea) {
        showToast("No element found to copy", "error");
        return;
    }

    // Explicitly focus and select contents of the preview textarea
    previewTextarea.focus();
    previewTextarea.select();
    previewTextarea.setSelectionRange(0, 99999); // Mobile compatibility select

    const textToCopy = previewTextarea.value || activeShareText;

    if (!textToCopy) {
        showToast("No text to copy", "error");
        return;
    }

    // Attempt modern clipboard writing first inside the secure window context
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                showToast("Group copied to clipboard!");
            })
            .catch(() => {
                fallbackCopyText(previewTextarea);
            });
    } else {
        fallbackCopyText(previewTextarea);
    }
};

/**
 * Invisible DOM Copy Fallback designed to guarantee focus in sandboxed spaces
 */
function fallbackCopyText(textareaElement) {
    try {
        textareaElement.focus();
        textareaElement.select();
        textareaElement.setSelectionRange(0, 99999);
        
        const successful = document.execCommand('copy');
        if (successful) {
            showToast("Group copied to clipboard!");
        } else {
            showToast("Clipboard restricted. Please tap message to copy manually.", "error");
        }
    } catch (err) {
        showToast("Clipboard restricted. Please tap message to copy manually.", "error");
    }
}

/**
 * Complete group state and close share modal helper
 */
window.completeAndCloseShare = async function() {
    if (activeShareGroupIndex !== null && activeShareGroupIndex !== undefined) {
        // Set state to true only if not already completed
        if (groupedBatch[activeShareGroupIndex] && !groupedBatch[activeShareGroupIndex].completed) {
            await window.toggleGroupComplete(activeShareGroupIndex);
        }
    }
    window.closeShareModal();
};

window.closeShareModal = function() {
    const modal = document.getElementById('share-modal');
    if (modal) modal.classList.add('hidden');
    activeShareGroupIndex = null;
};

window.toggleGroupComplete = async function(idx) {
    groupedBatch[idx].completed = !groupedBatch[idx].completed;
    renderResults(groupedBatch);

    if (currentBatchId) {
        try {
            const batchRef = doc(getCollectionRef(currentBatchSource), currentBatchId);
            // Only update addressStatuses (avoid resending full batch.data)
            const payload = {
                addressStatuses: Object.fromEntries(addressStatuses),
                'meta.lastStatusSync': serverTimestamp()
            };
            await updateDoc(batchRef, payload);
            // after successful update, mark lastSyncedStatuses accordingly
            lastSyncedStatuses.clear();
            for (const [k, v] of Object.entries(payload.addressStatuses || {})) {
                lastSyncedStatuses.set(k, v);
            }
            showToast("Status synced", "success");
        } catch (e) {
            showToast("Failed to sync", "error");
        }
    }
};

// --- Firebase Operations ---

/**
 * Generates appropriate document paths based on Rule 1 (Strict Paths)
 * @param {string} source - 'private' or 'public'
 */
function getCollectionRef(source = 'private') {
    if (source === 'public') {
        // Rule 1: Strict public data paths
        return collection(db, 'artifacts', appId, 'public', 'data', 'batches');
    } else {
        // Rule 1: Strict user-specific private data paths
        return collection(db, 'artifacts', appId, 'users', currentUser.uid, 'batches');
    }
}

window.saveOrUpdateBatch = function() {
    if (!currentUser || currentUser.isAnonymous) return showToast("Guests cannot save", "error");
    if (groupedBatch.length === 0) return showToast("No data to save", "error");

    const modal = document.getElementById('save-batch-modal');
    const input = document.getElementById('batch-name-input');
    const chkPublic = document.getElementById('chkSavePublic');
    
    if (modal && input) {
        input.value = `Batch ${new Date().toLocaleDateString()}`;
        if (chkPublic) chkPublic.checked = false; // default to private
        modal.classList.remove('hidden');
    }
};

window.confirmSave = async function() {
    const batchName = document.getElementById('batch-name-input').value.trim();
    if (!batchName) return showToast("Enter a name", "error");

    const isPublic = document.getElementById('chkSavePublic').checked;
    const targetSource = isPublic ? 'public' : 'private';

    try {
        const payload = {
            name: batchName,
            data: groupedBatch,
            addressStatuses: Object.fromEntries(addressStatuses),
            timestamp: Date.now(),
            isPublic: isPublic,
            createdBy: currentUser.displayName || currentUser.email || 'Team Member'
        };

        const docRef = await addDoc(getCollectionRef(targetSource), payload);
        currentBatchId = docRef.id; 
        currentBatchSource = targetSource;
        
        // initialize lastSyncedStatuses to match what was saved
        lastSyncedStatuses.clear();
        for (const [k, v] of Object.entries(payload.addressStatuses || {})) {
            lastSyncedStatuses.set(k, v);
        }

        showToast(`Batch saved to ${isPublic ? 'Team Shared' : 'Private'} history!`, "success");
        window.closeSaveModal();
    } catch (error) {
        console.error("Confirm Save Error: ", error);
        showToast("Save failed", "error");
    }
};

async function loadHistory() {
    if (!currentUser || currentUser.isAnonymous) return;
    const tableBody = document.getElementById("db-table-body");
    tableBody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">Loading history...</td></tr>';

    try {
        // Rule 2: Fetch only simple collections without orderBy filters, then sort in JS memory
        const querySnapshot = await getDocs(getCollectionRef(currentDbSubTab));
        let batches = [];
        querySnapshot.forEach((doc) => batches.push({ id: doc.id, ...doc.data() }));
        batches.sort((a, b) => b.timestamp - a.timestamp);

        if (batches.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-gray-500">No ${currentDbSubTab} batches found.</td></tr>`;
            return;
        }

        tableBody.innerHTML = "";
        batches.forEach(batch => {
            const tr = document.createElement("tr");
            const creatorLine = currentDbSubTab === 'public' 
                ? `<div class="text-[10px] text-gray-400 font-bold uppercase mt-1">Shared by: ${batch.createdBy || 'Unknown'}</div>` 
                : '';
                
            tr.innerHTML = `
                <td class="px-6 py-4">
                    <div class="font-bold text-gray-800">${batch.name}</div>
                    <div class="text-[10px] text-gray-400">${new Date(batch.timestamp).toLocaleString()}</div>
                </td>
                <td class="px-6 py-4">
                    <div class="text-xs text-gray-600">${batch.data.length} Groups</div>
                    ${creatorLine}
                </td>
                <td class="px-6 py-4 text-right">
                    <div class="flex justify-end gap-3 items-center">
                        <button onclick="window.viewBatch('${batch.id}', '${currentDbSubTab}')" class="text-cardinal font-black hover:underline text-[10px] uppercase">View</button>
                        <button onclick="window.requestDeleteBatch('${batch.id}', '${currentDbSubTab}')" class="text-gray-300 hover:text-red-600 transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                </td>
            `;
            window[`batchData_${batch.id}`] = { data: batch.data, addressStatuses: batch.addressStatuses || {}, id: batch.id, source: currentDbSubTab };
            tableBody.appendChild(tr);
        });
    } catch (error) {
        console.error("Load History Error: ", error);
        tableBody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-500">Error loading history</td></tr>';
    }
}

window.viewBatch = function(batchId, source = 'private') {
    const entry = window[`batchData_${batchId}`];
    if (entry) {
        groupedBatch = entry.data;
        currentBatchId = entry.id;
        currentBatchSource = source || entry.source || 'private';
        
        // Restore address statuses if they exist in the batch
        addressStatuses.clear();
        if (entry.addressStatuses) {
            for (const [key, status] of Object.entries(entry.addressStatuses)) {
                addressStatuses.set(key, status);
            }
        }
        // Initialize lastSyncedStatuses to avoid immediate delta-sync
        lastSyncedStatuses.clear();
        if (entry.addressStatuses) {
            for (const [key, status] of Object.entries(entry.addressStatuses)) {
                lastSyncedStatuses.set(key, status);
            }
        }
        
        renderResults(groupedBatch);
        window.switchTab('formatter');
        showToast(`Loaded ${currentBatchSource === 'public' ? 'Team Shared' : 'Private'} batch`);
    }
};

window.requestDeleteBatch = function(id, source = 'private') {
    const targetSource = source || 'private';
    openConfirmModal("Delete this batch?", "This action cannot be undone.", async () => {
        try {
            await deleteDoc(doc(getCollectionRef(targetSource), id));
            showToast("Batch deleted");
            loadHistory();
        } catch (e) { showToast("Delete failed", "error"); }
    });
};

window.requestClearAllHistory = function() {
    openConfirmModal("Clear All History?", "This will permanently delete everything in your current tab view.", async () => {
        try {
            const querySnapshot = await getDocs(getCollectionRef(currentDbSubTab));
            const deletes = [];
            querySnapshot.forEach(d => deletes.push(deleteDoc(d.ref)));
            await Promise.all(deletes);
            showToast("History cleared");
            loadHistory();
        } catch (e) { showToast("Clear failed", "error"); }
    });
};

function openConfirmModal(title, msg, callback) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-title').innerText = title;
    document.getElementById('confirm-modal-msg').innerText = msg;
    pendingAction = callback;
    modal.classList.remove('hidden');
}

window.closeConfirmModal = function() {
    document.getElementById('confirm-modal').classList.add('hidden');
    pendingAction = null;
};

window.executeConfirmedAction = async function() {
    if (pendingAction) await pendingAction();
    window.closeConfirmModal();
};

window.closeSaveModal = function() {
    document.getElementById('save-batch-modal').classList.add('hidden');
};

window.googleLogin = async function() {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        showToast("Logged in");
    } catch (error) { showToast("Login failed", "error"); }
};

window.guestLogin = async function() {
    try {
        await signInAnonymously(auth);
        showToast("Guest session started");
    } catch (error) { showToast("Guest login failed", "error"); }
};

window.logout = async function() {
    await signOut(auth);
    location.reload();
};

window.switchTab = function(tab) {
    if (currentUser?.isAnonymous && tab === 'database') {
        showToast("Guest users cannot access history", "error");
        return;
    }
    currentTab = tab;
    document.getElementById("tab-formatter").classList.toggle("hidden", tab !== "formatter");
    document.getElementById("tab-database").classList.toggle("hidden", tab !== "database");
    
    const fmtBtn = document.getElementById("btn-tab-formatter");
    const dbBtn = document.getElementById("btn-tab-database");
    
    if (tab === "formatter") {
        fmtBtn.classList.add("tab-active");
        dbBtn.classList.remove("tab-active");
    } else {
        dbBtn.classList.add("tab-active");
        fmtBtn.classList.remove("tab-active");
        loadHistory();
    }
};

window.switchDbSubTab = function(subtab) {
    currentDbSubTab = subtab;
    const privateBtn = document.getElementById("btn-subtab-private");
    const publicBtn = document.getElementById("btn-subtab-public");
    
    if (subtab === 'private') {
        privateBtn.className = "font-bold text-sm pb-2 border-b-2 border-cardinal text-cardinal transition-all";
        publicBtn.className = "font-bold text-sm pb-2 border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-all";
    } else {
        publicBtn.className = "font-bold text-sm pb-2 border-b-2 border-cardinal text-cardinal transition-all";
        privateBtn.className = "font-bold text-sm pb-2 border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-all";
    }
    loadHistory();
};

function startProgressModal(total) {
    const modal = document.getElementById('search-modal');
    if (modal) modal.classList.remove('hidden');
}

function updateProgress(current, total, addr) {
    const pct = Math.round((current / total) * 100);
    const bar = document.getElementById('modal-progress-bar');
    const text = document.getElementById('modal-progress-text');
    const display = document.getElementById('current-search-address');
    if (bar) bar.style.width = `${pct}%`;
    if (text) text.innerText = `${pct}% (${current}/${total})`;
    if (display) display.innerText = addr;
}

function hideProgressModal() {
    const modal = document.getElementById('search-modal');
    if (modal) modal.classList.add('hidden');
}

function showToast(msg, type = "success") {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `mb-3 px-6 py-3 rounded-lg shadow-lg text-white font-bold transform transition-all duration-300 translate-y-10 opacity-0 ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-10', 'opacity-0'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

window.runLookupAndFormat = runLookupAndFormat;