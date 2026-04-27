/**
 * Cardinal Address Lookup - Core Logic
 * Focus: Grouping, Bulk Communication, and Persistence
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
let currentBatchId = null; // Tracks the ID of the batch currently being viewed

// --- API Constants ---
const MD_GEODATA_URL = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query";
const MD_LOCATOR_URL = "https://mdgeodata.md.gov/imap/rest/services/GeocodeServices/MD_MultiroleLocator/GeocodeServer/findAddressCandidates";

// --- State Management ---
let groupedBatch = []; // Stores data in chunks of 5
let currentTab = 'formatter';

// --- Auth State Listener ---
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-content').classList.remove('hidden');
        document.getElementById('user-display').innerText = user.isAnonymous ? "Guest Session" : (user.displayName || "Logged In");
        if (currentTab === 'database') loadHistory();
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
    currentBatchId = null; // New lookup, not associated with a doc yet
    
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
                        status_flag: result.raw_ooi || '---',
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

async function fetchPropertyData(addressStr) {
    try {
        const geocodeParams = new URLSearchParams({ SingleLine: addressStr, f: 'json', outSR: 102100, outFields: 'City,Region,Postal' });
        const geoRes = await fetch(`${MD_LOCATOR_URL}?${geocodeParams}`);
        const geoData = await geoRes.json();
        if (!geoData.candidates || geoData.candidates.length === 0) return null;
        
        const bestMatch = geoData.candidates[0];
        const standardizedBase = bestMatch.address.split(',')[0].trim().toUpperCase();

        const queryParams = new URLSearchParams({
            where: `UPPER(ADDRESS) LIKE '${standardizedBase}%'`,
            outFields: 'ADDRESS,OOI,SDATWEBADR',
            f: 'json',
            resultRecordCount: 1
        });

        const propRes = await fetch(`${MD_GEODATA_URL}?${queryParams}`);
        const propData = await propRes.json();

        if (propData.features && propData.features.length > 0) {
            const attr = propData.features[0].attributes;
            return {
                address_full: attr.ADDRESS,
                city: bestMatch.attributes?.City || '',
                zip: bestMatch.attributes?.Postal || '',
                raw_ooi: attr.OOI, 
                sdat_url: attr.SDATWEBADR
            };
        }
    } catch (e) { throw e; }
    return null;
}

function renderResults(groups) {
    const canvas = document.getElementById('outputCanvas');
    if (groups.length === 0) {
        canvas.innerHTML = `<div class="p-12 text-center text-gray-400 font-medium">No properties found.</div>`;
        document.getElementById('btn-save-container').classList.add('hidden');
        return;
    }

    let html = '';

    groups.forEach((group, gIdx) => {
        const isDone = group.completed;
        const compiledAddresses = group.items.map(item => item.full_address).join(', ');
        const smsLink = `sms:?body=Addresses: ${compiledAddresses}`;
        const mailLink = `mailto:?subject=Property Batch ${gIdx+1}&body=Property List: %0D%0A${group.items.map(item => '- ' + item.full_address).join('%0D%0A')}`;

        html += `
            <div class="mb-8 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden ${isDone ? 'opacity-50 grayscale' : ''}">
                <!-- Group Header -->
                <div class="bg-gray-50 px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4">
                    <div class="flex items-center gap-3">
                        <span class="bg-cardinal text-white text-[10px] font-black px-2 py-1 rounded uppercase tracking-tighter">Group ${gIdx + 1}</span>
                        <h3 class="text-sm font-bold text-gray-800 ${isDone ? 'line-through' : ''}">${group.items.length} Properties</h3>
                    </div>
                    
                    <div class="flex items-center gap-2">
                        <a href="${smsLink}" class="group-btn bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-blue-100 transition-all ${isDone ? 'pointer-events-none opacity-20' : ''}">SMS Group</a>
                        <a href="${mailLink}" class="group-btn bg-red-50 text-cardinal px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-red-100 transition-all ${isDone ? 'pointer-events-none opacity-20' : ''}">Email Group</a>
                        <button onclick="toggleGroupComplete(${gIdx})" class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${isDone ? 'bg-gray-800 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}">
                            ${isDone ? 'Undo Complete' : 'Complete Group'}
                        </button>
                    </div>
                </div>

                <!-- Table -->
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <tbody class="divide-y divide-gray-100">
                            ${group.items.map(item => `
                                <tr class="${isDone ? 'line-through text-gray-400' : ''}">
                                    <td class="p-4">
                                        <div class="text-sm font-bold">${item.full_address}</div>
                                        <div class="text-[10px] uppercase text-gray-400">${item.city} ${item.zip}</div>
                                    </td>
                                    <td class="p-4">
                                        <span class="px-2 py-0.5 rounded text-[9px] font-black uppercase ${item.occupancy === 'Owner' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}">
                                            ${item.occupancy}
                                        </span>
                                    </td>
                                    <td class="p-4 text-[10px] font-mono font-bold text-gray-400">${item.status_flag}</td>
                                    <td class="p-4 text-right">
                                        <div class="flex justify-end gap-2">
                                            <a href="${item.sdat_url}" target="_blank" class="p-1.5 bg-gray-50 rounded hover:bg-gray-100 ${isDone ? 'pointer-events-none' : ''}">
                                                <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                                            </a>
                                        </div>
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
    if (currentUser && !currentUser.isAnonymous) {
        document.getElementById('btn-save-container').classList.remove('hidden');
    }
}

/**
 * Persistence: Toggle completion state and save to Firebase
 */
window.toggleGroupComplete = async function(idx) {
    groupedBatch[idx].completed = !groupedBatch[idx].completed;
    
    // Update UI immediately
    renderResults(groupedBatch);

    // If we are currently viewing a saved batch from history, update it in Firebase too
    if (currentBatchId) {
        try {
            const batchRef = doc(getCollectionRef(), currentBatchId);
            await updateDoc(batchRef, { data: groupedBatch });
            showToast("Group status synced to cloud", "success");
        } catch (e) {
            console.error(e);
            showToast("Failed to sync status", "error");
        }
    }
};

// --- Firebase Operations ---

function getCollectionRef() {
    return collection(db, 'artifacts', appId, 'users', currentUser.uid, 'batches');
}

window.saveOrUpdateBatch = function() {
    if (!currentUser || currentUser.isAnonymous) return showToast("Must sign in with Google to save", "error");
    if (groupedBatch.length === 0) return showToast("No data to save", "error");

    const modal = document.getElementById('save-batch-modal');
    const input = document.getElementById('batch-name-input');
    if (modal && input) {
        input.value = `Batch ${new Date().toLocaleDateString()}`;
        modal.classList.remove('hidden');
    }
};

window.closeSaveModal = function() {
    const modal = document.getElementById('save-batch-modal');
    if (modal) modal.classList.add('hidden');
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
        currentBatchId = docRef.id; // Assign ID so future "Complete" clicks update this doc
        showToast("Batch saved!", "success");
        window.closeSaveModal();
    } catch (error) {
        showToast("Save failed", "error");
    }
};

async function loadHistory() {
    if (!currentUser) return;
    const tableBody = document.getElementById("db-table-body");
    tableBody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-gray-500 italic">Loading history...</td></tr>';

    try {
        const querySnapshot = await getDocs(getCollectionRef());
        let batches = [];
        querySnapshot.forEach((doc) => batches.push({ id: doc.id, ...doc.data() }));
        batches.sort((a, b) => b.timestamp - a.timestamp);

        if (batches.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-gray-500">No batches found.</td></tr>';
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
                    <button onclick="window.viewBatch('${batch.id}')" class="text-cardinal font-bold hover:underline text-sm uppercase">View</button>
                </td>
            `;
            window[`batchData_${batch.id}`] = { data: batch.data, id: batch.id };
            tableBody.appendChild(tr);
        });
    } catch (error) {
        tableBody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-red-500">Error loading history</td></tr>';
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

// --- Auth Handlers ---

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
        showToast("Continuing as guest (No Cloud Saving)");
    } catch (error) { showToast("Guest login failed", "error"); }
};

window.logout = async function() {
    await signOut(auth);
    location.reload();
};

window.switchTab = function(tab) {
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

// --- UI Helpers ---

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