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

A custom domain (e.g., cardinalcomputersystems.com).

2. Repository Structure

index.html: The main application file.

CNAME: Contains your custom domain (e.g., apps.cardinalcomputersystems.com).

README.md: This file.

3. Firebase Configuration (Critical)

To make the database and login work, you must set up a dedicated Firebase project.

Create Project: Go to the Firebase Console and create a project named cardinal-address.

Enable Authentication:

Go to Build > Authentication > Sign-in method.

Enable Google.

Enable Anonymous (for Guest mode).

Important: Under Settings > Authorized domains, add:

apps.cardinalcomputersystems.com (Your App)

auth.cardinalcomputersystems.com (Your Login Handler)

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

In index.html, locate the firebaseConfig object and ensure it uses your custom auth domain to fix Apple login issues:

let firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "auth.cardinalcomputersystems.com", // CRITICAL for Apple/Safari support
    projectId: "cardinal-address",
    // ... other keys
};


🌐 Deployment (GitHub Pages)

Upload Code: Push index.html and CNAME to your GitHub repository.

Enable Pages: Go to Settings > Pages.

Source: Select Deploy from a branch (usually main).

Custom Domain: Enter apps.cardinalcomputersystems.com.

DNS Setup (GoDaddy/Registrar):

App: CNAME record apps pointing to [username].github.io.

Login: CNAME record auth pointing to cardinal-address.firebaseapp.com.

❓ Troubleshooting Login Errors

Error 400: redirect_uri_mismatch

If you see this error, you need to whitelist your custom auth domain in the Google Cloud Console.

Step-by-Step Fix:

Open Google Cloud Console:

The easiest way: Go to Firebase Console -> Project Settings (Gear Icon) -> Users and permissions.

Click the blue link "Advanced permission settings". This opens Google Cloud.

Navigate to Credentials:

Click the Hamburger Menu (three lines, top left).

Hover over APIs & Services.

Click Credentials.

Edit Client:

Look under the section "OAuth 2.0 Client IDs".

Find the Web client (there may be more than one; check them all if unsure).

Click the Pencil Icon (Edit) on the right.

Add Redirect URI:

Scroll down to "Authorized redirect URIs".

Click ADD URI.

Paste this EXACT link: https://auth.cardinalcomputersystems.com/__/auth/handler

Save & Wait:

Click Save.

WAIT 5 MINUTES. Google servers take time to update globally.
