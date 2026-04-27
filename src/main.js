/**
 * Cardinal Address Lookup - Core Logic
 * Focus: PRIN Priority, Candidate Filtering, and System Sharing
 */

import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, deleteDoc } from "firebase/firestore";

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
let currentUser = null;
let currentBatchId = null; 
let pendingAction = null; 

// --- API Constants ---
const MD_GEODATA_URL = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query";
// Reverted back to the working MultiroleLocator since CompositeLocator is 404 on the new server
const MD_LOCATOR_URL = "https://mdgeodata.md.gov/imap/rest/services/GeocodeServices/MD_MultiroleLocator/GeocodeServer/findAddressCandidates";

// --- State Management ---
let groupedBatch = []; 
let currentTab = 'formatter';

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
 * Main execution function
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
    
    for (let i = 0; i < validAddresses.length; i++) {
        const item = validAddresses[i];
        updateProgress(i + 1, validAddresses.length, item.cleaned);
        
        try {
            const result = await fetchPropertyData(item.cleaned);
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
    showToast(`Found ${results.length} properties in ${groupedBatch.length} groups.`);
}

/**
 * Queries Maryland iMAP
 * Improvements: Prioritizes PRIN candidates, applies strict JURSCODE filter,
 * and fixes the Tax ID masking issue.
 */
async function fetchPropertyData(addressStr) {
    try {
        // Step 1: Geocode with local bias
        const biasedSearch = `${addressStr}, Prince George's County, MD`;
        const geocodeParams = new URLSearchParams({ 
            SingleLine: biasedSearch, 
            f: 'json', 
            outSR: 102100 
        });

        const geoRes = await fetch(`${MD_LOCATOR_URL}?${geocodeParams}`);
        const geoData = await geoRes.json();
        if (!geoData.candidates || geoData.candidates.length === 0) return null;
        
        // PRIORITIZATION LOGIC:
        let bestMatch = geoData.candidates.find(c => c.address.toUpperCase().includes("PRINCE GEORGE'S"));
        if (!bestMatch) bestMatch = geoData.candidates[0];
        
        let addressParts = bestMatch.address.split(',');
        let standardizedBase = addressParts[0].trim().toUpperCase();
        
        // FIX: If the Geocoder returns the 11-digit Tax ID first (e.g., "17113930070, 12600 ABERCORN PL")
        // we need to skip the Tax ID and grab the actual address string in the second part.
        if (/^\d{10,}$/.test(standardizedBase) && addressParts.length > 1) {
            standardizedBase = addressParts[1].trim().toUpperCase();
        }
        
        const addrTokens = standardizedBase.split(' ');
        const fuzzySearch = `%${addrTokens[0]}%${addrTokens[1] || ''}%`;

        // Step 2: Query Property DB with strict PRIN priority
        const queryParams = new URLSearchParams({
            where: `UPPER(ADDRESS) LIKE '${fuzzySearch}' AND JURSCODE = 'PRIN'`,
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
                sdat_url: attr.SDATWEBADR
            };
        }
    } catch (e) { throw e; }
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
                            ${group.items.map(item => `
                                <tr class="${isDone ? 'line-through text-gray-400' : ''}">
                                    <td class="p-4">
                                        <div class="text-sm font-bold">${item.full_address}</div>
                                        <div class="text-[10px] uppercase text-gray-400">${item.city}, MD ${item.zip}</div>
                                    </td>
                                    <td class="p-4">
                                        <span class="px-2 py-0.5 rounded text-[9px] font-black uppercase ${item.occupancy === 'Owner' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}">
                                            ${item.occupancy}
                                        </span>
                                    </td>
                                    <td class="p-4 text-right">
                                        <a href="${item.sdat_url}" target="_blank" class="text-[10px] font-black text-cardinal hover:underline ${isDone ? 'pointer-events-none text-gray-300' : ''}">
                                            SDAT LINK
                                        </a>
                                    </td>
                                </tr>
                            `).join('')}
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

window.shareGroup = async function(idx) {
    const group = groupedBatch[idx];
    const textContent = `Cardinal Property Group ${idx + 1}:\n` + 
        group.items.map(i => `- ${i.full_address}, ${i.city}, MD ${i.zip}\n  SDAT: ${i.sdat_url}`).join('\n\n');

    if (navigator.share) {
        try {
            await navigator.share({
                title: `Property Group ${idx + 1}`,
                text: textContent
            });
        } catch (e) {
            console.error("Share failed", e);
        }
    } else {
        const dummy = document.createElement("textarea");
        document.body.appendChild(dummy);
        dummy.value = textContent;
        dummy.select();
        document.execCommand("copy");
        document.body.removeChild(dummy);
        showToast("Group copied to clipboard!");
    }
};

window.toggleGroupComplete = async function(idx) {
    groupedBatch[idx].completed = !groupedBatch[idx].completed;
    renderResults(groupedBatch);

    if (currentBatchId) {
        try {
            const batchRef = doc(getCollectionRef(), currentBatchId);
            await updateDoc(batchRef, { data: groupedBatch });
            showToast("Status synced", "success");
        } catch (e) {
            showToast("Failed to sync", "error");
        }
    }
};

// --- Firebase Operations ---

function getCollectionRef() {
    return collection(db, 'artifacts', appId, 'users', currentUser.uid, 'batches');
}

window.saveOrUpdateBatch = function() {
    if (!currentUser || currentUser.isAnonymous) return showToast("Guests cannot save", "error");
    if (groupedBatch.length === 0) return showToast("No data to save", "error");

    const modal = document.getElementById('save-batch-modal');
    const input = document.getElementById('batch-name-input');
    if (modal && input) {
        input.value = `Batch ${new Date().toLocaleDateString()}`;
        modal.classList.remove('hidden');
    }
};

window.confirmSave = async function() {
    const batchName = document.getElementById('batch-name-input').value.trim();
    if (!batchName) return showToast("Enter a name", "error");

    try {
        const docRef = await addDoc(getCollectionRef(), {
            name: batchName,
            data: groupedBatch,
            timestamp: Date.now()
        });
        currentBatchId = docRef.id; 
        showToast("Batch saved!", "success");
        window.closeSaveModal();
    } catch (error) {
        showToast("Save failed", "error");
    }
};

async function loadHistory() {
    if (!currentUser || currentUser.isAnonymous) return;
    const tableBody = document.getElementById("db-table-body");
    tableBody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">Loading history...</td></tr>';

    try {
        const querySnapshot = await getDocs(getCollectionRef());
        let batches = [];
        querySnapshot.forEach((doc) => batches.push({ id: doc.id, ...doc.data() }));
        batches.sort((a, b) => b.timestamp - a.timestamp);

        if (batches.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-500">No batches found.</td></tr>';
            return;
        }

        tableBody.innerHTML = "";
        batches.forEach(batch => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="px-6 py-4">
                    <div class="font-bold text-gray-800">${batch.name}</div>
                    <div class="text-[10px] text-gray-400">${new Date(batch.timestamp).toLocaleString()} • ${batch.data.length} Groups</div>
                </td>
                <td class="px-6 py-4 text-right">
                    <div class="flex justify-end gap-3 items-center">
                        <button onclick="window.viewBatch('${batch.id}')" class="text-cardinal font-black hover:underline text-[10px] uppercase">View</button>
                        <button onclick="window.requestDeleteBatch('${batch.id}')" class="text-gray-300 hover:text-red-600 transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                </td>
            `;
            window[`batchData_${batch.id}`] = { data: batch.data, id: batch.id };
            tableBody.appendChild(tr);
        });
    } catch (error) {
        tableBody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-500">Error loading history</td></tr>';
    }
}

window.viewBatch = function(batchId) {
    const entry = window[`batchData_${batchId}`];
    if (entry) {
        groupedBatch = entry.data;
        currentBatchId = entry.id;
        renderResults(groupedBatch);
        window.switchTab('formatter');
        showToast("Batch loaded");
    }
};

window.requestDeleteBatch = function(id) {
    openConfirmModal("Delete this batch?", "This action cannot be undone.", async () => {
        try {
            await deleteDoc(doc(getCollectionRef(), id));
            showToast("Batch deleted");
            loadHistory();
        } catch (e) { showToast("Delete failed", "error"); }
    });
};

window.requestClearAllHistory = function() {
    openConfirmModal("Clear All History?", "This will permanently delete everything.", async () => {
        try {
            const querySnapshot = await getDocs(getCollectionRef());
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