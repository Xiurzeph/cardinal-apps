/**
 * Cardinal Address Lookup - Core Logic
 * Focus: Maryland iMAP Property Data Integration
 * Removes: Name lookup/formatting requirements
 */

// --- Configuration & Constants ---
const MD_GEODATA_URL = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query";
const MD_LOCATOR_URL = "https://mdgeodata.md.gov/imap/rest/services/GeocodeServices/MD_MultiroleLocator/GeocodeServer/findAddressCandidates";

// --- State Management ---
let currentBatch = [];
let isProcessing = false;

/**
 * Main execution function triggered by the "Fetch" button.
 * Cleans input, geocodes addresses, and fetches property data.
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
                // Logic: Only add if (Not filtering OR (filtering AND is owner occupied))
                const isOwnerOcc = result.occ_status === "H"; // 'H' usually denotes Homestead/Owner Occupied in MD iMAP
                
                if (!ownerOccupiedOnly || (ownerOccupiedOnly && isOwnerOcc)) {
                    currentBatch.push({
                        original: address,
                        full_address: result.address_full,
                        owner_name: result.owner_name, // Kept for reference but not enforced as a requirement
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
        // Step 1: Geocode the address to get coordinates or a standard format
        const geocodeParams = new URLSearchParams({
            SingleLine: addressStr,
            f: 'json',
            outSR: 102100
        });

        const geoRes = await fetch(`${MD_LOCATOR_URL}?${geocodeParams}`);
        const geoData = await geoRes.json();
        
        if (!geoData.candidates || geoData.candidates.length === 0) return null;
        
        // Use the best candidate
        const bestMatch = geoData.candidates[0];

        // Step 2: Query Property MapServer using the address or location
        // Here we use a 'where' clause on the standardized address field
        const queryParams = new URLSearchParams({
            where: `UPPER(address) LIKE UPPER('%${bestMatch.address.split(',')[0]}%')`,
            outFields: 'address,owner_name,occ_status,county_name,legal_description',
            f: 'json',
            resultRecordCount: 1
        });

        const propRes = await fetch(`${MD_GEODATA_URL}?${queryParams}`);
        const propData = await propRes.json();

        if (propData.features && propData.features.length > 0) {
            const attr = propData.features[0].attributes;
            return {
                address_full: attr.address,
                owner_name: attr.owner_name,
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
        return;
    }

    let html = `
        <table class="w-full text-left border-collapse">
            <thead class="bg-gray-100 text-[10px] uppercase font-bold text-gray-500">
                <tr>
                    <th class="p-4 border-b">Input Address</th>
                    <th class="p-4 border-b">Standardized Address</th>
                    <th class="p-4 border-b">Owner</th>
                    <th class="p-4 border-b">Status</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
    `;

    data.forEach(item => {
        html += `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="p-4 text-xs font-mono text-gray-400">${item.original}</td>
                <td class="p-4 text-sm font-bold text-gray-800">${item.full_address || '---'}</td>
                <td class="p-4 text-sm text-gray-600">${item.owner_name || 'N/A'}</td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${item.occupancy === 'Owner' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}">
                        ${item.occupancy}
                    </span>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    canvas.innerHTML = html;
    
    // Show save button if data exists
    document.getElementById('btn-save-container')?.classList.remove('hidden');
}

// --- UI Helpers ---

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
    
    // Animate in
    setTimeout(() => {
        toast.classList.remove('translate-y-10', 'opacity-0');
    }, 10);
    
    // Remove
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Expose to window for HTML onclick handlers
window.runLookupAndFormat = runLookupAndFormat;