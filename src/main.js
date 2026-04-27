/**
 * Cardinal Address Lookup - Core Logic
 * Focus: Maryland iMAP Property Data Integration & Firebase Storage
 */

import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc } from "firebase/firestore";

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

// --- API Constants ---
const MD_GEODATA_URL = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query";
const MD_LOCATOR_URL = "https://mdgeodata.md.gov/imap/rest/services/GeocodeServices/MD_MultiroleLocator/GeocodeServer/findAddressCandidates";

// --- State Management ---
let currentBatch = [];
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
 * Main execution function
 */
async function runLookupAndFormat() {
    const input = document.getElementById('csvInput').value;
    const ownerOccupiedOnly = document.getElementById('chkOwnerOccupied').checked;
    
    if (!input.trim()) return showToast("Please enter at least one address.", "error");
    
    // --- DATA CLEANING STEP ---
    const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const validAddresses = [];
    for (let line of lines) {
        if (line.toLowerCase().includes("do not call")) continue;

        let cleanAddr = line.split(/Default|Never visited|\d{2}\/\d{2}\/\d{4}|R-\d+/i)[0].trim();
        cleanAddr = cleanAddr.replace(/^(\d+)([a-zA-Z])/, '$1 $2');

        if (cleanAddr) {
            validAddresses.push({
                original: line,
                cleaned: cleanAddr
            });
        }
    }

    if (validAddresses.length === 0) return showToast("No valid addresses found to process.", "error");

    startProgressModal(validAddresses.length);
    currentBatch = [];
    
    for (let i = 0; i < validAddresses.length; i++) {
        const item = validAddresses[i];
        updateProgress(i + 1, validAddresses.length, item.cleaned);
        
        try {
            const result = await fetchPropertyData(item.cleaned);
            
            if (result) {
                const isOwnerOcc = result.occ_status === "H";
                
                if (!ownerOccupiedOnly || (ownerOccupiedOnly && isOwnerOcc)) {
                    const maskedName = isOwnerOcc ? "Owner Occupied" : "Rental/Other";

                    currentBatch.push({
                        original: item.original,
                        search_term: item.cleaned,
                        full_address: result.address_full,
                        city: result.city,
                        state: result.state,
                        zip: result.zip,
                        owner_name: maskedName,
                        occupancy: isOwnerOcc ? "Owner" : "Rental/Other",
                        year_built: result.year_built,
                        sqft: result.sqft,
                        value: result.value,
                        sdat_url: result.sdat_url
                    });
                }
            }
        } catch (err) {
            console.error(`Error processing ${item.cleaned}:`, err);
        }
    }

    renderResults(currentBatch);
    hideProgressModal();
    showToast(`Processed ${validAddresses.length} lines. Found ${currentBatch.length} matches.`);
}

/**
 * Queries Maryland iMAP
 */
async function fetchPropertyData(addressStr) {
    try {
        const geocodeParams = new URLSearchParams({
            SingleLine: addressStr,
            f: 'json',
            outSR: 102100,
            outFields: 'City,Region,Postal'
        });

        const geoRes = await fetch(`${MD_LOCATOR_URL}?${geocodeParams}`);
        const geoData = await geoRes.json();
        
        if (!geoData.candidates || geoData.candidates.length === 0) return null;
        
        const bestMatch = geoData.candidates[0];
        const standardizedBase = bestMatch.address.split(',')[0].trim().toUpperCase();

        const queryParams = new URLSearchParams({
            where: `UPPER(ADDRESS) LIKE '${standardizedBase}%'`,
            outFields: 'ADDRESS,OOI,YEARBLT,SQFTSTRC,NFMTTLVL,SDATWEBADR',
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
                state: bestMatch.attributes?.Region || 'MD',
                zip: bestMatch.attributes?.Postal || '',
                occ_status: attr.OOI,
                year_built: attr.YEARBLT,
                sqft: attr.SQFTSTRC,
                value: attr.NFMTTLVL,
                sdat_url: attr.SDATWEBADR
            };
        }
    } catch (e) {
        throw e;
    }
    return null;
}

/**
 * UI Rendering logic
 */
function renderResults(data) {
    const canvas = document.getElementById('outputCanvas');
    if (data.length === 0) {
        canvas.innerHTML = `<div class="p-12 text-center text-gray-400 font-medium">No properties found matching your criteria.</div>`;
        document.getElementById('btn-save-container').classList.add('hidden');
        return;
    }

    let html = `
        <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[800px]">
            <thead class="bg-gray-100 text-[10px] uppercase font-bold text-gray-500">
                <tr>
                    <th class="p-4 border-b">Standardized Address</th>
                    <th class="p-4 border-b">Status</th>
                    <th class="p-4 border-b">Property Details</th>
                    <th class="p-4 border-b">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
    `;

    data.forEach(item => {
        const valueFormatted = item.value ? `$${Number(item.value).toLocaleString()}` : 'N/A';

        html += `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="p-4">
                    <div class="text-sm font-bold text-gray-800">${item.full_address || '---'}</div>
                    <div class="text-[10px] text-gray-400 uppercase">${item.city}, ${item.state} ${item.zip}</div>
                    <div class="text-[9px] text-gray-300 mt-1 italic">Searched: ${item.search_term}</div>
                </td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${item.occupancy === 'Owner' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}">
                        ${item.occupancy}
                    </span>
                </td>
                <td class="p-4">
                    <div class="text-[11px] text-gray-600">Built: <b>${item.year_built || 'N/A'}</b></div>
                    <div class="text-[11px] text-gray-600">Size: <b>${item.sqft || '0'} sqft</b></div>
                    <div class="text-[11px] text-gray-600">Value: <b>${valueFormatted}</b></div>
                </td>
                <td class="p-4">
                    <a href="${item.sdat_url}" target="_blank" class="bg-cardinal text-white px-3 py-1 rounded text-[10px] font-bold hover:bg-red-700 transition-colors inline-block">SDAT PORTAL ↗</a>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    canvas.innerHTML = html;
    
    if (currentUser && !currentUser.isAnonymous) {
        document.getElementById('btn-save-container').classList.remove('hidden');
    }
}

// --- Firebase Operations ---

function getCollectionRef() {
    return collection(db, 'artifacts', appId, 'users', currentUser.uid, 'batches');
}

// Opens the naming modal instead of a browser prompt
window.saveOrUpdateBatch = function() {
    if (!currentUser || currentUser.isAnonymous) return showToast("Must sign in with Google to save history", "error");
    if (currentBatch.length === 0) return showToast("No data to save", "error");

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

// The actual logic that runs when "Confirm Save" is clicked in the modal
window.confirmSave = async function() {
    const batchName = document.getElementById('batch-name-input').value.trim();
    if (!batchName) return showToast("Please enter a name", "error");

    try {
        await addDoc(getCollectionRef(), {
            name: batchName,
            data: currentBatch,
            timestamp: Date.now()
        });
        showToast("Batch saved to history!", "success");
        window.closeSaveModal();
    } catch (error) {
        showToast("Error saving batch", "error");
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
            tableBody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-gray-500">No saved batches found.</td></tr>';
            return;
        }

        tableBody.innerHTML = "";
        batches.forEach(batch => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="px-6 py-4">
                    <div class="font-bold text-gray-800">${batch.name}</div>
                    <div class="text-[10px] text-gray-400 font-normal">${new Date(batch.timestamp).toLocaleString()} • ${batch.data.length} items</div>
                </td>
                <td class="px-6 py-4 text-right">
                    <button onclick="window.viewBatch('${batch.id}')" class="text-cardinal font-bold hover:underline text-sm">View</button>
                </td>
            `;
            window[`batchData_${batch.id}`] = batch.data;
            tableBody.appendChild(tr);
        });
    } catch (error) {
        tableBody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-red-500">Error loading history</td></tr>';
    }
}

window.viewBatch = function(batchId) {
    const data = window[`batchData_${batchId}`];
    if (data) {
        currentBatch = data;
        renderResults(data);
        window.switchTab('formatter');
        showToast("Batch loaded successfully");
    }
};

// --- Auth Handlers ---

window.googleLogin = async function() {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        showToast("Logged in successfully");
    } catch (error) {
        showToast("Login failed", "error");
    }
};

window.guestLogin = async function() {
    try {
        await signInAnonymously(auth);
        showToast("Continuing as guest (Save disabled)");
    } catch (error) {
        showToast("Guest login failed", "error");
    }
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

// --- UI Progress Helpers ---

function startProgressModal(total) {
    const modal = document.getElementById('search-modal');
    const bar = document.getElementById('modal-progress-bar');
    const text = document.getElementById('modal-progress-text');
    if (modal) modal.classList.remove('hidden');
    if (bar) bar.style.width = '0%';
    if (text) text.innerText = `Starting... (0/${total})`;
}

function updateProgress(current, total, currentAddress) {
    const pct = Math.round((current / total) * 100);
    const bar = document.getElementById('modal-progress-bar');
    const text = document.getElementById('modal-progress-text');
    const addr = document.getElementById('current-search-address');
    if (bar) bar.style.width = `${pct}%`;
    if (text) text.innerText = `${pct}% Complete (${current}/${total})`;
    if (addr) addr.innerText = currentAddress;
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