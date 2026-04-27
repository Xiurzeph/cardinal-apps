/**
 * Cardinal Address Lookup - Core Logic
 * Focus: Maryland iMAP Property Data Integration & Firebase Storage
 */

import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc } from "firebase/firestore";

// --- Firebase Configuration ---
// Loaded securely from your .env file via Vite
const myFirebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Setup for both local/GitHub Pages and Canvas environment
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : myFirebaseConfig;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'cardinal-lookup';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let currentUser = null;

// --- Configuration & Constants ---
const MD_GEODATA_URL = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query";
const MD_LOCATOR_URL = "https://mdgeodata.md.gov/imap/rest/services/GeocodeServices/MD_MultiroleLocator/GeocodeServer/findAddressCandidates";

// --- State Management ---
let currentBatch = [];
let isProcessing = false;
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
 * Main execution function triggered by the "Fetch" button.
 */
async function runLookupAndFormat() {
    const input = document.getElementById('csvInput').value;
    const ownerOccupiedOnly = document.getElementById('chkOwnerOccupied').checked;
    
    if (!input.trim()) return showToast("Please enter at least one address.", "error");
    
    const rawAddresses = input.split('\n').map(a => a.trim()).filter(a => a.length > 0);
    if (rawAddresses.length === 0) return;

    startProgressModal(rawAddresses.length);
    currentBatch = [];
    
    for (let i = 0; i < rawAddresses.length; i++) {
        const address = rawAddresses[i];
        updateProgress(i + 1, rawAddresses.length, address);
        
        try {
            const result = await fetchPropertyData(address);
            
            if (result) {
                const isOwnerOcc = result.occ_status === "H"; // 'H' denotes Homestead/Owner Occupied
                
                if (!ownerOccupiedOnly || (ownerOccupiedOnly && isOwnerOcc)) {
                    // MASKING LEVEL 1: Overwrite the name before it ever touches currentBatch or Firebase
                    const maskedName = isOwnerOcc ? "Owner Occupied" : "Rental/Other";

                    currentBatch.push({
                        original: address,
                        full_address: result.address_full,
                        city: result.city,
                        state: result.state,
                        zip: result.zip,
                        owner_name: maskedName,
                        occupancy: isOwnerOcc ? "Owner" : "Rental/Other",
                        county: result.county_name,
                        legal_desc: result.legal_description
                    });
                }
            }
        } catch (err) {
            console.error(`Error processing ${address}:`, err);
        }
    }

    renderResults(currentBatch);
    hideProgressModal();
    showToast(`Processed ${rawAddresses.length} addresses. Found ${currentBatch.length} matches.`);
}

/**
 * Queries Maryland iMAP for property details based on a text address
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
        
        const geoCity = bestMatch.attributes?.City || '';
        const geoState = bestMatch.attributes?.Region || 'MD';
        const geoZip = bestMatch.attributes?.Postal || '';

        const queryParams = new URLSearchParams({
            where: `UPPER(address) LIKE UPPER('%${bestMatch.address.split(',')[0]}%')`,
            outFields: 'address,occ_status,county_name,legal_description',
            f: 'json',
            resultRecordCount: 1
        });

        const propRes = await fetch(`${MD_GEODATA_URL}?${queryParams}`);
        const propData = await propRes.json();

        if (propData.features && propData.features.length > 0) {
            const attr = propData.features[0].attributes;
            return {
                address_full: attr.address,
                city: geoCity,
                state: geoState,
                zip: geoZip,
                occ_status: attr.occ_status,
                county_name: attr.county_name,
                legal_description: attr.legal_description
            };
        }
    } catch (e) {
        throw e;
    }
    return null;
}

/**
 * UI Rendering logic for the output canvas
 */
function renderResults(data) {
    const canvas = document.getElementById('outputCanvas');
    if (data.length === 0) {
        canvas.innerHTML = `<div class="p-12 text-center text-gray-400 font-medium">No properties found matching your criteria.</div>`;
        document.getElementById('btn-save-container').classList.add('hidden');
        return;
    }

    let html = `
        <table class="w-full text-left border-collapse">
            <thead class="bg-gray-100 text-[10px] uppercase font-bold text-gray-500">
                <tr>
                    <th class="p-4 border-b">Input Address</th>
                    <th class="p-4 border-b">Standardized Address</th>
                    <th class="p-4 border-b">City, State, Zip</th>
                    <th class="p-4 border-b">Owner</th>
                    <th class="p-4 border-b">Status</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
    `;

    data.forEach(item => {
        const cityStateZip = item.city ? `${item.city}, ${item.state} ${item.zip}` : '---';
        
        // MASKING LEVEL 2: Force generic text in the UI even if viewing old unmasked data
        const isActuallyOwner = item.occupancy === 'Owner' || item.occ_status === 'H';
        const displayOwner = isActuallyOwner ? 'Owner Occupied' : 'Rental/Other';

        html += `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="p-4 text-xs font-mono text-gray-400">${item.original}</td>
                <td class="p-4 text-sm font-bold text-gray-800">${item.full_address || '---'}</td>
                <td class="p-4 text-sm text-gray-600">${cityStateZip}</td>
                <td class="p-4 text-sm text-gray-600 italic">${displayOwner}</td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${isActuallyOwner ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}">
                        ${isActuallyOwner ? 'Owner' : 'Rental'}
                    </span>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    canvas.innerHTML = html;
    
    if (currentUser) {
        document.getElementById('btn-save-container').classList.remove('hidden');
    }
}

// --- Firebase Operations ---

function getCollectionRef() {
    return collection(db, 'artifacts', appId, 'users', currentUser.uid, 'batches');
}

window.saveOrUpdateBatch = async function() {
    if (!currentUser) return showToast("Must be logged in to save", "error");
    if (currentBatch.length === 0) return showToast("No data to save", "error");

    const batchName = prompt("Enter a name for this batch:");
    if (!batchName) return;

    try {
        const batchData = {
            name: batchName,
            data: currentBatch,
            timestamp: Date.now()
        };
        await addDoc(getCollectionRef(), batchData);
        showToast("Batch saved to history!", "success");
    } catch (error) {
        console.error("Error saving document: ", error);
        showToast("Error saving batch", "error");
    }
};

async function loadHistory() {
    if (!currentUser) return;
    const tableBody = document.getElementById("db-table-body");
    tableBody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-gray-500">Loading history...</td></tr>';

    try {
        const querySnapshot = await getDocs(getCollectionRef());
        let batches = [];
        querySnapshot.forEach((doc) => {
            batches.push({ id: doc.id, ...doc.data() });
        });

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
                    <div class="text-[10px] text-gray-400 font-normal">${new Date(batch.timestamp).toLocaleString()} • ${batch.data.length} properties</div>
                </td>
                <td class="px-6 py-4 text-right flex justify-end gap-4">
                    <button onclick="window.viewBatch('${batch.id}')" class="text-cardinal font-bold hover:underline text-sm">View</button>
                    <button onclick="window.deleteBatch('${batch.id}')" class="text-gray-400 hover:text-red-600 transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </td>
            `;
            window[`batchData_${batch.id}`] = batch.data;
            tableBody.appendChild(tr);
        });
    } catch (error) {
        console.error("Error loading history: ", error);
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

window.deleteBatch = async function(batchId) {
    if (!currentUser) return;
    if (confirm("Are you sure you want to delete this batch?")) {
        try {
            await deleteDoc(doc(getCollectionRef(), batchId));
            showToast("Batch deleted", "success");
            loadHistory();
        } catch (error) {
            console.error("Error deleting doc: ", error);
            showToast("Failed to delete", "error");
        }
    }
};

window.googleLogin = async function() {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        showToast("Logged in successfully");
    } catch (error) {
        console.error(error);
        showToast("Login failed", "error");
    }
};

window.guestLogin = async function() {
    try {
        await signInAnonymously(auth);
        showToast("Continuing as guest");
    } catch (error) {
        console.error(error);
        showToast("Guest login failed", "error");
    }
};

window.logout = async function() {
    try {
        await signOut(auth);
        showToast("Logged out");
    } catch (error) {
        console.error(error);
    }
};

window.switchTab = function(tab) {
    currentTab = tab;
    document.getElementById("tab-formatter").classList.toggle("hidden", tab !== "formatter");
    document.getElementById("tab-database").classList.toggle("hidden", tab !== "database");
    
    document.getElementById("btn-tab-formatter").className = tab === "formatter" ? "tab-active py-1 transition-colors" : "text-gray-400 py-1 hover:text-gray-600 transition-colors";
    document.getElementById("btn-tab-database").className = tab === "database" ? "tab-active py-1 transition-colors" : "text-gray-400 py-1 hover:text-gray-600 transition-colors";

    if (tab === 'database') {
        loadHistory();
    }
};

function startProgressModal(total) {
    const modal = document.getElementById('search-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    updateProgress(0, total, "Starting...");
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
    
    setTimeout(() => {
        toast.classList.remove('translate-y-10', 'opacity-0');
    }, 10);
    
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

window.runLookupAndFormat = runLookupAndFormat;