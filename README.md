Cardinal Address Lookup

A secure, web-based utility for batch processing address lists, querying Maryland Property Data, and formatting results for print. This tool is designed for Cardinal Computer Systems to streamline property research and address verification.

🚀 Features

MD Property Data Integration: Automatically fetches Owner Name, Occupancy Status, and Zip Code from the Maryland iMAP API (geodata.md.gov) for Prince George's County.

Smart Cleaning: Handles raw text or tab-delimited inputs (e.g., from Excel), creates clean "First MI Last" name formats, and removes "ET AL".

Filtering: Automatically filters out businesses and non-owner-occupied properties.

Secure Cloud Storage: Uses Firebase Firestore to save batch history. Data is stored in private, user-specific paths (/users/{uid}/data), ensuring one user cannot see another's searches.

Print-Ready Layout: Generates an 8.5" x 11" formatted table with color-coded street groupings for easy physical review.

Authentication: Secure Google Sign-In and Guest Mode support.

🛠️ Setup & Configuration

This application is a Single Page Application (SPA) hosted on GitHub Pages, utilizing Firebase for backend services (Auth & Database).

1. Prerequisites

A GitHub Account.

A Firebase Account (Google Cloud).

A custom domain (optional, but recommended for Apple device compatibility).

2. Repository Structure

index.html: The main application file (rename address-formatter.html to this).

CNAME: Contains your custom domain (e.g., apps.cardinalcomputersystems.com).

README.md: This file.

3. Firebase Configuration (Critical)

To make the database and login work, you must set up a dedicated Firebase project.

Create Project: Go to the Firebase Console and create a project named cardinal-address.

Enable Authentication:

Go to Build > Authentication > Sign-in method.

Enable Google.

Enable Anonymous (for Guest mode).

Important: Under Settings > Authorized domains, add your custom domain (e.g., apps.cardinalcomputersystems.com) and your GitHub Pages domain (username.github.io).

Create Database:

Go to Build > Firestore Database.

Create a database in production mode.

Go to the Rules tab and paste the secure rules below.

Firestore Security Rules

These rules ensure data privacy. Only the user who created the data can read or write it.

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}


4. Code Configuration

In index.html, locate the firebaseConfig object and ensure it matches your project settings:

let firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "auth.cardinalcomputersystems.com", // Important for Apple devices
    projectId: "cardinal-address",
    // ... other keys
};


🌐 Deployment (GitHub Pages)

Upload Code: Push index.html and CNAME to your GitHub repository.

Enable Pages: Go to Settings > Pages.

Source: Select Deploy from a branch (usually main).

Custom Domain: Enter apps.cardinalcomputersystems.com (or your chosen subdomain).

DNS Setup:

In your Domain Registrar (e.g., GoDaddy), create a CNAME record for apps pointing to [username].github.io.

Apple Fix: Create a separate CNAME for auth pointing to [project-id].firebaseapp.com to handle secure logins on iOS.

🔒 Security Notes

Public API Keys: The Firebase API key visible in the code is safe to be public. It identifies your project but does not grant admin access.

Data Isolation: Security is enforced by the Firestore Rules. Even if someone has your API key, they cannot read your private data without logging into your specific Google Account.

PII: Personally Identifiable Information (Names/Addresses) is stored only in the user's private collection.

📝 Usage

Login: Sign in with your company Google Account.

Input: Paste a list of addresses (one per line) into the text area.

Process: Click Fetch & Format. The tool will query the MD database.

Save: Click Save to Private DB to store the batch.

History: Use the Saved Batches tab to reload previous work.

Print: Click Print PDF for a clean hard copy.

❓ Troubleshooting

Error 400: redirect_uri_mismatch

If you see this error when logging in, you must authorize your custom auth domain in the Google Cloud Console.

Go to the Google Cloud Console Credentials Page.

Under "OAuth 2.0 Client IDs", click the name of your client (usually "Web client").

Scroll down to "Authorized redirect URIs".

Click "ADD URI".

Paste: https://auth.cardinalcomputersystems.com/__/auth/handler

Click Save.
