import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc, doc } from "firebase/firestore";

// --- Firebase Configuration ---
// Ensure these environment variables are set in your .env file or replaced with strings
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- State Management ---
let currentUser = null;
let currentBatchData = [];
let isGuest = false;

// --- Auth Functions ---
const googleLogin = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    showApp();
  } catch (error) {
    console.error("Login failed:", error);
    showToast("Login failed. Please try again.", "error");
  }
};

const guestLogin = () => {
  isGuest = true;
  currentUser = { displayName: "Guest User", email: "guest@cardinal.local" };
  showApp();
};

const logout = async () => {
  await signOut(auth);
  location.reload();
};

// --- UI Logic ---
function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-content').classList.remove('hidden');
  document.getElementById('user-display').textContent = currentUser.displayName || currentUser.email;
  if (isGuest) document.getElementById('btn-save-container').classList.add('hidden');
}

const switchTab = (tabName) => {
  const tabs = ['formatter', 'database'];
  tabs.forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tabName);
    const btn = document.getElementById(`btn-tab-${t}`);
    if (t === tabName) {
      btn.classList.add('tab-active', 'text-gray-900');
      btn.classList.remove('text-gray-400');
    } else {
      btn.classList.remove('tab-active', 'text-gray-900');
      btn.classList.add('text-gray-400');
    }
  });
  if (tabName === 'database') loadHistory();
};

// --- Core Logic (Lookup & Format) ---
const runLookupAndFormat = async () => {
    const input = document.getElementById('csvInput').value;
    if (!input.trim()) return showToast("Please paste some addresses.", "error");

    const addresses = input.split('\n').filter(line => line.trim());
    const modal = document.getElementById('search-modal');
    const progressBar = document.getElementById('modal-progress-bar');
    const progressText = document.getElementById('modal-progress-text');
    const addressDisplay = document.getElementById('current-search-address');

    modal.classList.remove('hidden');
    currentBatchData = [];
    
    for (let i = 0; i < addresses.length; i++) {
        const addr = addresses[i].trim();
        addressDisplay.textContent = addr;
        
        // Mock API Call (Replace with your actual API logic)
        await new Promise(r => setTimeout(r, 600)); 
        
        currentBatchData.push({
            address: addr,
            owner: "John Doe", // Placeholder
            occupied: document.getElementById('chkOwnerOccupied').checked ? "Yes" : "N/A"
        });

        const percent = Math.round(((i + 1) / addresses.length) * 100);
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${percent}% Complete`;
    }

    modal.classList.add('hidden');
    renderOutput();
    document.getElementById('btn-save-container').classList.remove('hidden');
};

function renderOutput() {
    const canvas = document.getElementById('outputCanvas');
    canvas.innerHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Address</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${currentBatchData.map(row => `
                    <tr>
                        <td class="px-6 py-4 whitespace-nowrap text-sm">${row.address}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm">${row.owner}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// --- History/DB Functions ---
const saveOrUpdateBatch = async () => {
    if (isGuest) return;
    const batchName = prompt("Enter a name for this batch:");
    if (!batchName) return;

    try {
        await addDoc(collection(db, "batches"), {
            name: batchName,
            data: currentBatchData,
            userId: currentUser.uid,
            timestamp: serverTimestamp()
        });
        showToast("Batch saved to history!", "success");
    } catch (e) {
        showToast("Error saving batch.", "error");
    }
};

async function loadHistory() {
    const tbody = document.getElementById('db-table-body');
    tbody.innerHTML = '<tr><td colspan="2" class="p-4 text-center">Loading...</td></tr>';
    
    const q = query(collection(db, "batches"), orderBy("timestamp", "desc"));
    const querySnapshot = await getDocs(q);
    
    tbody.innerHTML = '';
    querySnapshot.forEach((doc) => {
        const batch = doc.data();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-6 py-4 text-sm font-medium text-gray-900">${batch.name}</td>
            <td class="px-6 py-4 text-right">
                <button class="text-cardinal hover:text-red-800 font-bold text-xs uppercase">View</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function showToast(msg, type = "success") {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `mb-2 px-6 py-3 rounded-lg shadow-lg text-white font-bold transition-all transform translate-y-0 ${type === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// --- GLOBAL EXPORT BRIDGE ---
// This part is critical for Vite modules to work with HTML onclick events
window.googleLogin = googleLogin;
window.guestLogin = guestLogin;
window.logout = logout;
window.switchTab = switchTab;
window.runLookupAndFormat = runLookupAndFormat;
window.saveOrUpdateBatch = saveOrUpdateBatch;
