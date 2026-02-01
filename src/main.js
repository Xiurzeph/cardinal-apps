import './style.css'
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect, 
  signInAnonymously, 
  onAuthStateChanged, 
  signOut, 
  setPersistence, 
  browserLocalPersistence 
} from "firebase/auth";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  initializeFirestore 
} from "firebase/firestore";

// --- Configuration ---
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const appId = 'cardinal-address-lookup';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const API_URL = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query";

// --- State ---
let currentUser = null;
let currentBatchData = null; 
let currentGroupStrikes = []; 
let activeBatchId = null; 
let dbUnsubscribe = null;
let allBatches = [];

// --- Auth Listener ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-content').classList.remove('hidden');
        document.getElementById('user-display').innerText = user.email || "Guest User";
        if (!user.isAnonymous) {
            initDatabaseListener(user.uid);
            document.getElementById('btn-save-container').classList.remove('hidden');
        }
    } else {
        currentUser = null;
        if (dbUnsubscribe) dbUnsubscribe();
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('app-content').classList.add('hidden');
    }
});

// --- Core Functions ---
// We explicitly attach these to window so HTML onclicks work
window.googleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
        await setPersistence(auth, browserLocalPersistence);
        await signInWithPopup(auth, provider);
    } catch (error) {
        await signInWithRedirect(auth, provider);
    }
};

window.guestLogin = async () => { await signInAnonymously(auth); };
window.logout = () => { signOut(auth); };

function initDatabaseListener(userId) {
    if (dbUnsubscribe) dbUnsubscribe();
    const colRef = collection(db, 'artifacts', appId, 'users', userId, 'data_batches');
    dbUnsubscribe = onSnapshot(colRef, (snapshot) => {
        const batches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        batches.sort((a, b) => b.timestamp - a.timestamp);
        renderDatabaseTable(batches);
    });
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-emerald-600' : 'bg-cardinal';
    toast.className = `${bgColor} text-white px-6 py-3 rounded-lg shadow-xl mb-3 flex items-center gap-3 transform translate-y-10 opacity-0 transition-all duration-300`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove('translate-y-10', 'opacity-0'); }, 10);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateSaveButtonUI() {
    const btnText = document.getElementById('btn-save-text');
    if (btnText) btnText.innerText = activeBatchId ? "Update Batch" : "Save Batch";
}

window.saveOrUpdateBatch = async () => {
    if (!currentUser || !currentBatchData) return;
    const userId = currentUser.uid;
    if (activeBatchId) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'users', userId, 'data_batches', activeBatchId);
            await updateDoc(docRef, { records: currentBatchData, groupStrikes: currentGroupStrikes, lastUpdated: Date.now() });
            showToast("Batch updated!");
        } catch (e) { showToast("Update failed.", 'error'); }
    } else {
        const batchName = prompt("Enter a name for this batch:", `Batch ${new Date().toLocaleDateString()}`);
        if (!batchName) return;
        try {
            const colRef = collection(db, 'artifacts', appId, 'users', userId, 'data_batches');
            const docRef = await addDoc(colRef, { name: batchName, timestamp: Date.now(), records: currentBatchData, groupStrikes: currentGroupStrikes });
            activeBatchId = docRef.id;
            updateSaveButtonUI();
            showToast("Batch saved!");
        } catch (e) { showToast("Save failed.", 'error'); }
    }
};

window.deleteBatch = async (docId) => {
    if (!confirm("Delete this batch?")) return;
    try {
        const userId = currentUser.uid;
        await deleteDoc(doc(db, 'artifacts', appId, 'users', userId, 'data_batches', docId));
        if (activeBatchId === docId) { activeBatchId = null; updateSaveButtonUI(); }
        showToast("Deleted.");
    } catch (e) { showToast("Error deleting.", 'error'); }
};

window.runLookupAndFormat = async () => {
    const input = document.getElementById('csvInput').value.trim();
    if (!input) return;
    activeBatchId = null;
    updateSaveButtonUI();
    const lines = input.split('\n').filter(l => l.trim());
    const results = [];
    const isStrict = document.getElementById('chkOwnerOccupied').checked;
    
    const modal = document.getElementById('search-modal');
    const addrDisplay = document.getElementById('current-search-address');
    const bar = document.getElementById('modal-progress-bar');
    const text = document.getElementById('modal-progress-text');
    modal.classList.remove('hidden');

    for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].trim().split(/[\t\s]+/).filter(p => p.length > 0);
        if (parts.length >= 2) {
            const houseNum = parts[0];
            const streetName = parts[1];
            addrDisplay.innerText = `FETCHING: ${houseNum} ${streetName}`;
            const percent = Math.round(((i + 1) / lines.length) * 100);
            bar.style.width = `${percent}%`;
            text.innerText = `${percent}% DONE`;

            try {
                const params = new URLSearchParams({
                    where: `PREMSNUM = '${houseNum}' AND UPPER(PREMSNAM) LIKE UPPER('%${streetName.replace(/'/g, "''")}%') AND JURSCODE = 'PRIN'`,
                    outFields: 'OWNNAME1,OOI,PREMSNUM,PREMSNAM,PREMSTYP,PREMZIP,PREMCITY',
                    f: 'json',
                    resultRecordCount: '1'
                });
                const resp = await fetch(`${API_URL}?${params.toString()}`);
                const data = await resp.json();
                if (data.features?.length) {
                    const attr = isStrict ? data.features.find(f => f.attributes.OOI === 'H')?.attributes : data.features[0].attributes;
                    
                    if (attr) {
                        const rawName = attr.OWNNAME1 || "";
                        const isExcluded = /TRUST|REVOCABLE|REV\b|TRU\b|TR\b|TTEE|LLC|INC\b|CORP|L\.L\.C|PROPERTIES|LIVING|LVG|FAM|PARTNERSHIP|LTD\b/i.test(rawName);

                        if (!isExcluded) {
                            results.push(formatApiRecord(attr));
                        }
                    }
                }
            } catch (e) { console.error(e); }
        }
    }
    currentBatchData = results;
    currentGroupStrikes = new Array(Math.ceil(results.length / 5)).fill(false);
    renderResults(results);
    modal.classList.add('hidden');
}

function formatApiRecord(attr) {
    const rawName = attr.OWNNAME1 || "Unknown Owner";
    const fullAddr = `${attr.PREMSNUM || ''} ${attr.PREMSNAM || ''} ${attr.PREMSTYP || ''}`.trim();
    const isDeceased = /EST OF|ESTATE| DEC|DECD|DECEASED|ADMIN OF|EXEC OF/i.test(rawName);
    let status = "Active";
    if (isDeceased) status = "Deceased";

    return {
        name: cleanName(rawName),
        rawName: rawName,
        address: toTitleCase(fullAddr),
        city: toTitleCase(attr.PREMCITY || ""),
        state: "MD",
        zip: attr.PREMZIP || "",
        status: status
    };
}

function cleanName(n) {
    let res = n.split('&')[0]
               .replace(/ETAL|ET\sAL|EST OF|ESTATE| DEC|DECD|REVOCABLE|LIVING|TRUST/gi, '')
               .replace(/[^a-zA-Z,\s]/g, '')
               .trim();
    if (res.includes(',')) {
        const parts = res.split(',');
        res = `${parts[1].trim()} ${parts[0].trim()}`;
    } else {
        const parts = res.split(/\s+/);
        if (parts.length > 1) {
            const lastName = parts.shift(); 
            res = `${parts.join(' ')} ${lastName}`;
        }
    }
    return toTitleCase(res);
}

function toTitleCase(s) { return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }

function renderResults(data) {
    const canvas = document.getElementById('outputCanvas');
    canvas.innerHTML = '';
    if (!data || data.length === 0) { 
        canvas.innerHTML = '<div class="text-center text-gray-400 font-bold p-10 uppercase tracking-widest">0 RECORDS FOUND</div>'; 
        return; 
    }

    for (let i = 0; i < data.length; i += 5) {
        const groupIdx = i / 5;
        const group = data.slice(i, i + 5);
        const div = document.createElement('div');
        div.className = `mb-8 ${currentGroupStrikes[groupIdx] ? 'group-struck' : ''}`;
        
        const isStruck = currentGroupStrikes[groupIdx];
        
        div.innerHTML = `
            <div class="flex justify-between items-center border-b border-gray-200 pb-2 mb-2">
                <span class="text-xs font-bold text-gray-400 uppercase tracking-widest">GROUP ${groupIdx + 1}</span>
                <button onclick="window.toggleStrike(${groupIdx})" class="p-2 text-cardinal hover:text-red-800 transition-colors no-print">
                     ${isStruck 
                        ? `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"></path></svg>`
                        : `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>`
                    }
                </button>
            </div>
            <table class="w-full text-left border-collapse">
                ${group.map(item => {
                    let statusColor = '#22c55e';
                    let badgeColor = 'bg-emerald-500';
                    if (item.status === 'Deceased') { statusColor = '#ef4444'; badgeColor = 'bg-red-600'; }
                    return `
                    <tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                        <td class="py-2 px-4 border-l-4" style="border-left-color: ${statusColor}">
                            <div class="text-lg text-gray-800">
                                <span class="font-bold">${item.name || 'Unknown'}</span>, <span class="text-gray-600 text-base">${item.address || 'Unknown Address'}, ${item.city || ''} ${item.state || 'MD'} ${item.zip || ''}</span>
                                ${item.status !== 'Active' ? `<span class="ml-2 px-2 py-0.5 text-[10px] uppercase text-white rounded-full inline-block align-middle ${badgeColor}">${item.status}</span>` : ''}
                            </div>
                        </td>
                    </tr>`;
                }).join('')}
            </table>`;
        canvas.appendChild(div);
    }
}

window.toggleStrike = (idx) => { 
    currentGroupStrikes[idx] = !currentGroupStrikes[idx]; 
    renderResults(currentBatchData); 
};

window.switchTab = (t) => {
    document.getElementById('tab-formatter').classList.toggle('hidden', t !== 'formatter');
    document.getElementById('tab-database').classList.toggle('hidden', t !== 'database');
    document.getElementById('btn-tab-formatter').className = t === 'formatter' ? 'tab-active py-1' : 'text-gray-400 py-1';
    document.getElementById('btn-tab-database').className = t === 'database' ? 'tab-active py-1' : 'text-gray-400 py-1';
};

function renderDatabaseTable(batches) {
    allBatches = batches;
    document.getElementById('db-table-body').innerHTML = batches.map((b, i) => `<tr>
        <td class="px-6 py-4 font-bold text-gray-800">${b.name} <span class="text-[10px] text-gray-400 font-normal ml-2">${new Date(b.timestamp).toLocaleDateString()}</span></td>
        <td class="px-6 py-4 text-right flex justify-end gap-4">
            <button onclick="window.loadBatch(${i})" class="text-cardinal font-bold hover:underline">Load</button>
            <button onclick="window.deleteBatch('${b.id}')" class="text-gray-400 hover:text-red-600 transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
        </td></tr>`).join('');
}

window.loadBatch = (i) => {
    const b = allBatches[i];
    activeBatchId = b.id;
    currentBatchData = b.records;
    currentGroupStrikes = b.groupStrikes || new Array(Math.ceil(b.records.length / 5)).fill(false);
    renderResults(b.records);
    window.switchTab('formatter');
    updateSaveButtonUI();
};
